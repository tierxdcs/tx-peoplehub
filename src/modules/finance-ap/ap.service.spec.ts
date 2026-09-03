import { BadRequestException } from '@nestjs/common';
import { ApInvoiceStatus, ApPaymentStatus, Prisma } from '@prisma/client';
import { ApService } from './ap.service';

describe('ApService approval controls', () => {
  const access = {
    assertAccountsHead: jest.fn(),
    assertCanUseFinance: jest.fn(),
  };
  const prisma = {
    accountsPayableInvoice: { findUnique: jest.fn() },
    accountsPayablePayment: { findUnique: jest.fn(), update: jest.fn() },
  };
  const service = new ApService(
    prisma as any,
    access as any,
    {} as any,
    {} as any,
    {} as any,
  );
  const head = { id: 'head-1' } as any;

  beforeEach(() => jest.clearAllMocks());

  it('requires an INR exchange rate for supported foreign currencies', () => {
    expect(() => (service as any).currency('USD')).toThrow(BadRequestException);
    expect((service as any).currency('EUR', 92.5)).toBe('EUR');
  });

  it('prevents a Finance Head from approving their own AP invoice', async () => {
    prisma.accountsPayableInvoice.findUnique.mockResolvedValue({
      id: 'invoice-1',
      status: ApInvoiceStatus.PENDING_APPROVAL,
      createdById: head.id,
      lines: [],
      paymentAllocations: [],
    });
    await expect(service.approveInvoice('invoice-1', {}, head)).rejects.toThrow(
      'Finance Head cannot approve an invoice they created',
    );
  });

  it('requires a reason before overriding a three-way match exception', async () => {
    prisma.accountsPayableInvoice.findUnique.mockResolvedValue({
      id: 'invoice-2',
      status: ApInvoiceStatus.MATCH_EXCEPTION,
      createdById: 'finance-user',
      lines: [],
      paymentAllocations: [],
    });
    await expect(service.approveInvoice('invoice-2', {}, head)).rejects.toThrow(
      'A match override reason is required',
    );
  });

  it('prevents a Finance Head from approving their own payment proposal', async () => {
    prisma.accountsPayablePayment.findUnique.mockResolvedValue({
      id: 'payment-1',
      status: ApPaymentStatus.PENDING_APPROVAL,
      createdById: head.id,
    });
    await expect(service.approvePayment('payment-1', head)).rejects.toThrow(
      'Finance Head cannot approve a payment they created',
    );
    expect(prisma.accountsPayablePayment.update).not.toHaveBeenCalled();
  });
});

/**
 * The PO advance's two ends inside AP: raising the request when Stores issues the
 * order, and telling Stores what became of it. The request is a real AP payment
 * with no allocations, which is what keeps a single record of whether the party
 * has actually been paid.
 */
describe('ApService purchase-order advance', () => {
  function setup() {
    const prisma = {
      purchaseOrder: { findUnique: jest.fn() },
      employee: { findMany: jest.fn().mockResolvedValue([]) },
      notification: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
      accountsPayablePayment: { findUnique: jest.fn(), update: jest.fn() },
    };
    const access = {
      assertAccountsHead: jest.fn(),
      assertCanUseFinance: jest.fn(),
    };
    const tx = {
      financeSequence: {
        upsert: jest.fn().mockResolvedValue({ lastValue: 7 }),
      },
      accountsPayablePayment: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(({ data }) => ({
          id: 'pay-1',
          ...data,
        })),
      },
    };
    const service = new ApService(
      prisma as any,
      access as any,
      {} as any,
      {} as any,
      {} as any,
    );
    return { service, prisma, tx };
  }

  const input = {
    purchaseOrderId: 'po-1',
    poNumber: 'PO-2026-0001',
    supplierId: 'sup-1',
    vendorId: null,
    amount: new Prisma.Decimal('41100.00'),
    advancePercent: new Prisma.Decimal('30.00'),
    plannedDate: new Date('2026-09-02T00:00:00.000Z'),
    createdById: 'scm-1',
  };

  it('raises the advance as an unallocated DRAFT payment against the PO', async () => {
    const { service, tx } = setup();

    const created = await (service as any).createPurchaseOrderAdvanceTx(
      tx,
      input,
    );

    expect(created.paymentNumber).toBe('PAY-2026-00007');
    const data = tx.accountsPayablePayment.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      purchaseOrderId: 'po-1',
      partyType: 'SUPPLIER',
      supplierId: 'sup-1',
      partyId: 'sup-1',
      currencyCode: 'INR',
      paymentMethod: 'BANK_TRANSFER',
      createdById: 'scm-1',
    });
    // DRAFT, not PENDING_APPROVAL: Accounts still owns submit → approve →
    // execute, which is the compensating control for an advance that has no
    // three-way match behind it.
    expect(data.status).toBeUndefined();
    // No allocations — that is precisely what makes this an advance, and what
    // makes postPayment book it to "Advances to vendors" rather than against AP.
    expect(data.allocations).toBeUndefined();
    expect(data.notes).toContain('30.00%');
    expect(data.notes).toContain('PO-2026-0001');
  });

  it('refuses a second live request for the same PO', async () => {
    const { service, tx } = setup();
    tx.accountsPayablePayment.findFirst.mockResolvedValue({
      paymentNumber: 'PAY-2026-00003',
    });

    await expect(
      (service as any).createPurchaseOrderAdvanceTx(tx, input),
    ).rejects.toThrow('PAY-2026-00003 already exists');
    expect(tx.accountsPayablePayment.create).not.toHaveBeenCalled();
    // A rejected or reversed advance must stay re-raisable, so only live
    // statuses count against the PO.
    expect(tx.accountsPayablePayment.findFirst.mock.calls[0][0].where).toEqual({
      purchaseOrderId: 'po-1',
      status: {
        notIn: [ApPaymentStatus.REJECTED, ApPaymentStatus.REVERSED],
      },
    });
  });

  it('tells the PO raiser and SCM heads when Accounts refuses the advance', async () => {
    const { service, prisma } = setup();
    prisma.accountsPayablePayment.findUnique.mockResolvedValue({
      id: 'pay-1',
      status: ApPaymentStatus.PENDING_APPROVAL,
      createdById: 'scm-1',
    });
    prisma.accountsPayablePayment.update.mockResolvedValue({
      id: 'pay-1',
      purchaseOrderId: 'po-1',
      amount: new Prisma.Decimal('41100.00'),
      bankReference: null,
      rejectionComment: 'Cash position — revisit next week',
    });
    prisma.purchaseOrder.findUnique.mockResolvedValue({
      poNumber: 'PO-2026-0001',
      createdById: 'scm-1',
    });
    prisma.employee.findMany.mockResolvedValue([
      { id: 'scm-head' },
      // The raiser is also an SCM head here — they must not be told twice.
      { id: 'scm-1' },
    ]);

    await service.rejectPayment('pay-1', 'Cash position — revisit next week', {
      id: 'head-1',
    } as any);

    const rows = prisma.notification.createMany.mock.calls[0][0].data;
    expect(rows.map((r: any) => r.employeeId).sort()).toEqual([
      'scm-1',
      'scm-head',
    ]);
    expect(rows[0]).toMatchObject({
      type: 'PO_ADVANCE_PAYMENT_REJECTED',
      relatedPurchaseOrderId: 'po-1',
    });
    expect(rows[0].message).toContain('41,100.00');
    expect(rows[0].message).toContain('Cash position');
  });

  it('stays silent on a payment that has nothing to do with a PO', async () => {
    const { service, prisma } = setup();
    prisma.accountsPayablePayment.findUnique.mockResolvedValue({
      id: 'pay-2',
      status: ApPaymentStatus.PENDING_APPROVAL,
      createdById: 'finance-1',
    });
    prisma.accountsPayablePayment.update.mockResolvedValue({
      id: 'pay-2',
      purchaseOrderId: null,
      amount: new Prisma.Decimal('5000.00'),
      bankReference: null,
      rejectionComment: 'Duplicate',
    });

    await service.rejectPayment('pay-2', 'Duplicate', { id: 'head-1' } as any);

    expect(prisma.purchaseOrder.findUnique).not.toHaveBeenCalled();
    expect(prisma.notification.createMany).not.toHaveBeenCalled();
  });
});
