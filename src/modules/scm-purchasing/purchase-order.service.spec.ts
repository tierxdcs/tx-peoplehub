import { BadRequestException, ForbiddenException } from '@nestjs/common';
import {
  PurchaseOrderApprovalLevel,
  PurchaseOrderApprovalStatus,
  PurchaseOrderStatus,
  Prisma,
  Role,
} from '@prisma/client';
import { PurchaseOrderService } from './purchase-order.service';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreatePurchaseOrderDto } from './dto/purchase-order.dto';

const ceo = {
  id: 'ceo-1',
  email: 'ceo@example.com',
  role: Role.SUPER_ADMIN,
  verticalId: null,
};

function poRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'po-1',
    poNumber: 'PO-2026-0001',
    status: PurchaseOrderStatus.PENDING_CEO_APPROVAL,
    supplierId: null,
    supplier: null,
    vendorId: null,
    vendor: null,
    adHocPartyName: 'One-off Fabricator',
    adHocContactInfo: 'contact@example.com',
    adHocPartyAddress: 'Bengaluru',
    ceoApprovedById: null,
    ceoApprovedAt: null,
    rejectedById: null,
    rejectedAt: null,
    rejectionComment: null,
    orderDate: new Date('2026-08-22'),
    expectedDeliveryDate: null,
    notes: null,
    createdById: 'scm-1',
    createdBy: { firstName: 'SCM', lastName: 'User' },
    issuedAt: null,
    cancelledAt: null,
    approvalAmount: null,
    advancePercent: null,
    advanceAmount: null,
    advancePayments: [],
    approvals: [],
    lastEmailedAt: null,
    lastEmailedTo: null,
    lines: [],
    createdAt: new Date('2026-08-22'),
    updatedAt: new Date('2026-08-22'),
    ...overrides,
  };
}

describe('PurchaseOrderService value-based approval', () => {
  function setup(rows: ReturnType<typeof poRow>[] = []) {
    const tx = {
      purchaseOrder: {
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      purchaseOrderApproval: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const prisma = {
      purchaseOrder: {
        findUnique: jest
          .fn()
          .mockImplementation(() => Promise.resolve(rows.shift())),
        update: jest.fn().mockResolvedValue({}),
      },
      employee: {
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      $transaction: jest.fn().mockImplementation((fn) => fn(tx)),
    };
    const service = new PurchaseOrderService(
      prisma as never,
      { assertCanManagePurchaseOrders: jest.fn() } as never,
      {} as never,
      { approvalRequired: jest.fn() } as never,
      { createPurchaseOrderAdvanceTx: jest.fn() } as never,
    );
    return { service, prisma, tx };
  }

  it.each([
    [2_500_000, [PurchaseOrderApprovalLevel.CSCO]],
    [
      2_500_001,
      [PurchaseOrderApprovalLevel.CSCO, PurchaseOrderApprovalLevel.COO],
    ],
    [
      5_000_000,
      [PurchaseOrderApprovalLevel.CSCO, PurchaseOrderApprovalLevel.COO],
    ],
    [
      5_000_001,
      [
        PurchaseOrderApprovalLevel.CSCO,
        PurchaseOrderApprovalLevel.COO,
        PurchaseOrderApprovalLevel.CEO,
      ],
    ],
  ])('routes ₹%s through the correct ladder', async (amount, levels) => {
    const draft = poRow({
      status: PurchaseOrderStatus.DRAFT,
      supplierId: 'supplier-1',
      lines: [{ lineTotal: new Prisma.Decimal(amount) }],
    });
    const result = poRow({ status: PurchaseOrderStatus.PENDING_CSCO_APPROVAL });
    const { service, tx } = setup([draft, result]);

    await service.submitForApproval('po-1', {
      ...ceo,
      role: Role.MANAGER,
    });

    expect(tx.purchaseOrderApproval.createMany).toHaveBeenCalledWith({
      data: levels.map((level, index) =>
        expect.objectContaining({
          level,
          sequence: index + 1,
          status:
            index === 0
              ? PurchaseOrderApprovalStatus.PENDING
              : PurchaseOrderApprovalStatus.WAITING,
        }),
      ),
    });
  });

  it('always adds CEO approval for an ad-hoc party', async () => {
    const draft = poRow({
      status: PurchaseOrderStatus.DRAFT,
      lines: [{ lineTotal: new Prisma.Decimal(100) }],
    });
    const { service, tx } = setup([
      draft,
      poRow({ status: PurchaseOrderStatus.PENDING_CSCO_APPROVAL }),
    ]);

    await service.submitForApproval('po-1', { ...ceo, role: Role.MANAGER });

    expect(tx.purchaseOrderApproval.createMany.mock.calls[0][0].data).toEqual([
      expect.objectContaining({ level: PurchaseOrderApprovalLevel.CSCO }),
      expect.objectContaining({ level: PurchaseOrderApprovalLevel.CEO }),
    ]);
  });

  it('restricts COO approval to an active Production Head', async () => {
    const pending = poRow({
      status: PurchaseOrderStatus.PENDING_COO_APPROVAL,
      approvals: [
        {
          id: 'approval-2',
          level: PurchaseOrderApprovalLevel.COO,
          sequence: 2,
          status: PurchaseOrderApprovalStatus.PENDING,
        },
      ],
    });
    const { service, prisma } = setup([pending]);
    prisma.employee.findUnique.mockResolvedValue({
      status: 'ACTIVE',
      isScmHead: true,
      isProductionHead: false,
    });

    await expect(
      service.approve('po-1', { ...ceo, role: Role.MANAGER }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('advances CSCO approval to the waiting COO step', async () => {
    const pending = poRow({
      status: PurchaseOrderStatus.PENDING_CSCO_APPROVAL,
      approvals: [
        {
          id: 'approval-1',
          level: PurchaseOrderApprovalLevel.CSCO,
          sequence: 1,
          status: PurchaseOrderApprovalStatus.PENDING,
        },
        {
          id: 'approval-2',
          level: PurchaseOrderApprovalLevel.COO,
          sequence: 2,
          status: PurchaseOrderApprovalStatus.WAITING,
        },
      ],
    });
    const { service, prisma, tx } = setup([
      pending,
      poRow({ status: PurchaseOrderStatus.PENDING_COO_APPROVAL }),
    ]);
    prisma.employee.findUnique.mockResolvedValue({
      status: 'ACTIVE',
      isScmHead: true,
      isProductionHead: false,
    });

    await service.approve('po-1', { ...ceo, role: Role.MANAGER });

    expect(tx.purchaseOrderApproval.update).toHaveBeenCalledWith({
      where: { id: 'approval-2' },
      data: { status: PurchaseOrderApprovalStatus.PENDING },
    });
    expect(tx.purchaseOrder.update).toHaveBeenCalledWith({
      where: { id: 'po-1' },
      data: { status: PurchaseOrderStatus.PENDING_COO_APPROVAL },
    });
  });

  it('does not issue a PO before the entire approval ladder is complete', async () => {
    const { service } = setup([
      poRow({ status: PurchaseOrderStatus.PENDING_COO_APPROVAL }),
    ]);

    await expect(service.issue('po-1', ceo)).rejects.toThrow(
      'until every required approval is complete',
    );
  });

  it('requires a rejection reason', async () => {
    const { service } = setup();
    await expect(
      service.rejectApproval('po-1', { comment: '   ' }, ceo),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('CreatePurchaseOrderDto ad-hoc contract', () => {
  it('accepts the ad-hoc party fields under whitelist validation', async () => {
    const dto = plainToInstance(CreatePurchaseOrderDto, {
      adHocPartyName: 'One-off Fabricator',
      adHocContactInfo: 'buyer@example.com',
      adHocPartyAddress: 'Bengaluru',
      lines: [{ itemId: 'item-1', orderedQuantity: 1, unitPrice: 100 }],
    });
    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    expect(errors).toEqual([]);
  });

  it('accepts a free-text line without an Item Master id', async () => {
    const dto = plainToInstance(CreatePurchaseOrderDto, {
      adHocPartyName: 'One-off Fabricator',
      lines: [
        {
          adHocItemName: 'Site installation service',
          adHocDescription: 'Installation and commissioning at customer site',
          unitOfMeasure: 'job',
          orderedQuantity: 1,
          unitPrice: 25000,
        },
      ],
    });
    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    expect(errors).toEqual([]);
  });
});

describe('PurchaseOrderService deletion', () => {
  function deletionService(row: unknown) {
    const prisma = {
      purchaseOrder: {
        findUnique: jest.fn().mockResolvedValue(row),
        delete: jest.fn().mockResolvedValue({}),
      },
    };
    const access = { assertCanDeletePurchaseOrders: jest.fn() };
    return {
      prisma,
      access,
      service: new PurchaseOrderService(
        prisma as never,
        access as never,
        {} as never,
        {} as never,
        {} as never,
      ),
    };
  }

  it.each([PurchaseOrderStatus.ISSUED, PurchaseOrderStatus.FULLY_RECEIVED])(
    'never deletes a %s PO',
    async (status) => {
      const { service, prisma } = deletionService({
        poNumber: 'PO-2026-0001',
        status,
        _count: { goodsReceiptNotes: 0, apInvoices: 0 },
      });
      await expect(service.remove('po-1', ceo)).rejects.toThrow(
        'purchase orders cannot be deleted',
      );
      expect(prisma.purchaseOrder.delete).not.toHaveBeenCalled();
    },
  );

  it('preserves a PO with GRN or AP audit records', async () => {
    const { service, prisma } = deletionService({
      poNumber: 'PO-2026-0001',
      status: PurchaseOrderStatus.PARTIALLY_RECEIVED,
      _count: { goodsReceiptNotes: 1, apInvoices: 0 },
    });
    await expect(service.remove('po-1', ceo)).rejects.toThrow(
      'linked GRN or Accounts Payable records',
    );
    expect(prisma.purchaseOrder.delete).not.toHaveBeenCalled();
  });

  it('preserves a cancelled PO whose advance already moved cash', async () => {
    const { service, prisma } = deletionService({
      poNumber: 'PO-2026-0001',
      status: PurchaseOrderStatus.CANCELLED,
      _count: { goodsReceiptNotes: 0, apInvoices: 0, advancePayments: 1 },
    });
    await expect(service.remove('po-1', ceo)).rejects.toThrow(
      'linked GRN or Accounts Payable records',
    );
    expect(prisma.purchaseOrder.delete).not.toHaveBeenCalled();
  });

  it('deletes an eligible PO without downstream records', async () => {
    const { service, prisma, access } = deletionService({
      poNumber: 'PO-2026-0001',
      status: PurchaseOrderStatus.CANCELLED,
      _count: { goodsReceiptNotes: 0, apInvoices: 0 },
    });
    await expect(service.remove('po-1', ceo)).resolves.toEqual({
      id: 'po-1',
      poNumber: 'PO-2026-0001',
      deleted: true,
    });
    expect(access.assertCanDeletePurchaseOrders).toHaveBeenCalledWith(ceo);
    expect(prisma.purchaseOrder.delete).toHaveBeenCalledWith({
      where: { id: 'po-1' },
    });
  });
});

/**
 * The PO advance. Two things are worth pinning down: that the rupee figure is
 * derived with Decimal arithmetic and frozen at issue (the party, Accounts and
 * the screen must all see one number), and that issuing is the single moment the
 * request reaches Accounts — an ISSUED PO promising an advance nobody was told
 * about is the failure this feature exists to remove.
 */
describe('PurchaseOrderService advance payment', () => {
  const scm = {
    id: 'scm-1',
    email: 'scm@example.com',
    role: Role.MANAGER,
    verticalId: 'v-scm',
  };

  function line(lineTotal: string) {
    return {
      id: 'pol-1',
      itemId: null,
      item: null,
      adHocItemName: 'Fabricated frame',
      adHocDescription: null,
      orderedQuantity: new Prisma.Decimal(1),
      unitPrice: new Prisma.Decimal(lineTotal),
      unitOfMeasure: 'NOS',
      lineTotal: new Prisma.Decimal(lineTotal),
      notes: null,
      sequence: 0,
    };
  }

  function setup(rows: unknown[]) {
    const tx = {
      purchaseOrder: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    const prisma = {
      purchaseOrder: {
        findUnique: jest
          .fn()
          .mockImplementation(() => Promise.resolve(rows.shift())),
        update: jest.fn().mockResolvedValue({}),
      },
      employee: {
        findMany: jest.fn().mockResolvedValue([{ id: 'acct-1' }]),
      },
      notification: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
      $transaction: jest.fn().mockImplementation((fn) => fn(tx)),
    };
    const ap = {
      createPurchaseOrderAdvanceTx: jest
        .fn()
        .mockResolvedValue({ id: 'pay-1', paymentNumber: 'PAY-2026-00001' }),
    };
    const service = new PurchaseOrderService(
      prisma as never,
      { assertCanManagePurchaseOrders: jest.fn() } as never,
      {} as never,
      {} as never,
      ap as never,
    );
    return { service, prisma, tx, ap };
  }

  it('refuses an advance on an ad-hoc PO — there is no party to pay', async () => {
    const { service, prisma } = setup([]);
    await expect(
      service.create(
        {
          adHocPartyName: 'One-off Fabricator',
          advancePercent: 30,
          lines: [{ orderedQuantity: 1, unitPrice: 1000 }],
        } as never,
        scm,
      ),
    ).rejects.toThrow('registered supplier or vendor');
    expect(prisma.purchaseOrder.findUnique).not.toHaveBeenCalled();
  });

  it('refuses to strand an existing advance by switching the PO to ad-hoc', async () => {
    const { service } = setup([
      poRow({
        status: PurchaseOrderStatus.DRAFT,
        supplierId: 'sup-1',
        advancePercent: new Prisma.Decimal('30.00'),
      }),
    ]);
    await expect(
      service.update('po-1', { supplierId: null } as never, scm),
    ).rejects.toThrow('registered supplier or vendor');
  });

  it('freezes the advance with Decimal arithmetic and raises exactly one request', async () => {
    const issued = poRow({
      status: PurchaseOrderStatus.ISSUED,
      supplierId: 'sup-1',
      supplier: { companyName: 'Acme', status: 'APPROVED', contactEmail: null },
      advancePercent: new Prisma.Decimal('30.00'),
      advanceAmount: new Prisma.Decimal('10000.00'),
      advancePayments: [
        {
          id: 'pay-1',
          paymentNumber: 'PAY-2026-00001',
          status: 'DRAFT',
          plannedDate: new Date('2026-09-02'),
          executedDate: null,
          bankReference: null,
          rejectionComment: null,
        },
      ],
    });
    const { service, prisma, tx, ap } = setup([
      poRow({
        status: PurchaseOrderStatus.APPROVED,
        supplierId: 'sup-1',
        advancePercent: new Prisma.Decimal('30.00'),
        // 30% of 33,333.33 is 9,999.999 — it has to land on 10,000.00, not on
        // whatever a float would truncate to.
        lines: [line('33333.3300')],
      }),
      issued,
    ]);

    const entity = await service.issue('po-1', scm);

    expect(ap.createPurchaseOrderAdvanceTx).toHaveBeenCalledTimes(1);
    const args = ap.createPurchaseOrderAdvanceTx.mock.calls[0][1];
    expect(args.amount.toFixed(2)).toBe('10000.00');
    expect(args.purchaseOrderId).toBe('po-1');
    expect(args.supplierId).toBe('sup-1');
    // Same transaction as the status change: no ISSUED PO without its request.
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.purchaseOrder.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'po-1', status: PurchaseOrderStatus.APPROVED },
        data: expect.objectContaining({
          status: PurchaseOrderStatus.ISSUED,
          advanceAmount: expect.anything(),
        }),
      }),
    );
    // Accounts is told, and told what for.
    expect(prisma.employee.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: 'ACTIVE', vertical: { code: 'ACCOUNTS' } },
      }),
    );
    const notified = prisma.notification.createMany.mock.calls[0][0].data;
    expect(notified).toHaveLength(1);
    expect(notified[0]).toMatchObject({
      employeeId: 'acct-1',
      type: 'PO_ADVANCE_PAYMENT_REQUESTED',
      relatedPurchaseOrderId: 'po-1',
    });
    expect(notified[0].message).toContain('PO-2026-0001');
    expect(notified[0].message).toContain('30.00%');
    expect(notified[0].message).toContain('10,000.00');
    // …and the entity reports the frozen figure, not a live one.
    expect(entity.advance).toMatchObject({
      percent: '30.00',
      amount: '10000.00',
      indicativeAmount: null,
      paymentNumber: 'PAY-2026-00001',
      status: 'DRAFT',
    });
  });

  it('issues a PO with no advance without touching Accounts', async () => {
    const { service, prisma, ap } = setup([
      poRow({
        status: PurchaseOrderStatus.APPROVED,
        supplierId: 'sup-1',
        lines: [line('50000.0000')],
      }),
      poRow({ status: PurchaseOrderStatus.ISSUED, supplierId: 'sup-1' }),
    ]);

    const entity = await service.issue('po-1', scm);

    expect(ap.createPurchaseOrderAdvanceTx).not.toHaveBeenCalled();
    expect(prisma.notification.createMany).not.toHaveBeenCalled();
    expect(entity.advance).toBeNull();
  });

  it('will not re-raise the advance on an already-issued PO', async () => {
    const { service, ap } = setup([
      poRow({
        status: PurchaseOrderStatus.ISSUED,
        supplierId: 'sup-1',
        advancePercent: new Prisma.Decimal('30.00'),
        lines: [line('50000.0000')],
      }),
    ]);
    await expect(service.issue('po-1', scm)).rejects.toThrow(
      BadRequestException,
    );
    expect(ap.createPurchaseOrderAdvanceTx).not.toHaveBeenCalled();
  });

  it('rejects an advance that rounds away to nothing', async () => {
    const { service, ap } = setup([
      poRow({
        status: PurchaseOrderStatus.APPROVED,
        supplierId: 'sup-1',
        advancePercent: new Prisma.Decimal('0.01'),
        lines: [line('0.0100')],
      }),
    ]);
    await expect(service.issue('po-1', scm)).rejects.toThrow(
      'works out to zero',
    );
    expect(ap.createPurchaseOrderAdvanceTx).not.toHaveBeenCalled();
  });

  it('shows a DRAFT advance as indicative, since editing the lines moves it', async () => {
    const { service } = setup([
      poRow({
        status: PurchaseOrderStatus.DRAFT,
        supplierId: 'sup-1',
        advancePercent: new Prisma.Decimal('25.00'),
        lines: [line('80000.0000')],
      }),
    ]);
    const entity = await service.get('po-1');
    expect(entity.advance).toMatchObject({
      percent: '25.00',
      amount: null,
      indicativeAmount: '20000.00',
      paymentNumber: null,
      status: null,
    });
  });
});
