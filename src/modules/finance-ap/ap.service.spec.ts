import { BadRequestException } from '@nestjs/common';
import { ApInvoiceStatus, ApPaymentStatus } from '@prisma/client';
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
  const service = new ApService(prisma as any, access as any, {} as any);
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
