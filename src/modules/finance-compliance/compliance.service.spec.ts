import { BadRequestException } from '@nestjs/common';
import {
  FinanceNoteStatus,
  GstItcStatus,
  ApInvoiceStatus,
} from '@prisma/client';
import { ComplianceService } from './compliance.service';

describe('ComplianceService controls', () => {
  const access = {
    assertCanUseFinance: jest.fn(),
    assertAccountsHead: jest.fn(),
  };
  const prisma = {
    financeAdjustmentNote: { findUnique: jest.fn() },
    accountsPayableInvoice: { findUnique: jest.fn(), update: jest.fn() },
    tdsSection: { create: jest.fn() },
  };
  const service = new ComplianceService(prisma as any, access as any);
  const head = { id: 'head-1' } as any;

  beforeEach(() => jest.clearAllMocks());

  it('prevents self-approval of an adjustment note', async () => {
    prisma.financeAdjustmentNote.findUnique.mockResolvedValue({
      id: 'note-1',
      status: FinanceNoteStatus.PENDING_APPROVAL,
      createdById: head.id,
    });
    await expect(service.approveNote('note-1', head)).rejects.toThrow(
      'Finance Head cannot approve a note they created',
    );
  });

  it('requires a reason for an ITC mismatch', async () => {
    prisma.accountsPayableInvoice.findUnique.mockResolvedValue({
      id: 'bill-1',
      status: ApInvoiceStatus.APPROVED,
    });
    await expect(
      service.setItcStatus('bill-1', { status: GstItcStatus.MISMATCHED }, head),
    ).rejects.toThrow('A mismatch reason is required');
  });

  it('requires a reason when placing a payment hold', async () => {
    await expect(
      service.setPaymentHold('bill-1', { hold: true }, head),
    ).rejects.toThrow('A payment-hold reason is required');
  });

  it('rejects an invalid TDS effective date range', async () => {
    await expect(
      service.createTdsSection(
        {
          sectionCode: '194C',
          description: 'Contractor',
          ratePercent: 2,
          effectiveFrom: '2026-04-01',
          effectiveTo: '2026-03-31',
        },
        head,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.tdsSection.create).not.toHaveBeenCalled();
  });
});
