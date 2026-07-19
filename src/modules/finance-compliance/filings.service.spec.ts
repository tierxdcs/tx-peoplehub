import { ComplianceReturnStatus } from '@prisma/client';
import { FilingsService } from './filings.service';

describe('FilingsService controls', () => {
  const access = { assertCanUseFinance: jest.fn(), assertAccountsHead: jest.fn() };
  const prisma = {
    gstReturn: { findUnique: jest.fn(), update: jest.fn() },
    tdsReturn: { findUnique: jest.fn(), update: jest.fn() },
    gstr2bLine: { createMany: jest.fn() },
    accountsPayableInvoice: { findUnique: jest.fn(), update: jest.fn() },
    tdsChallan: { findUnique: jest.fn() },
    tdsChallanAllocation: { upsert: jest.fn() },
  };
  const storage = { createUploadUrl: jest.fn(), headObject: jest.fn(), createDownloadUrl: jest.fn() };
  const service = new FilingsService(prisma as any, access as any, storage as any);
  const head = { id: 'head-1' } as any;
  beforeEach(() => jest.clearAllMocks());

  it('prevents a Finance Head from approving a GST return they prepared', async () => {
    prisma.gstReturn.findUnique.mockResolvedValue({ id: 'g1', status: ComplianceReturnStatus.PENDING_APPROVAL, preparedById: head.id });
    await expect(service.approveGst('g1', head)).rejects.toThrow('cannot approve a GST return they prepared');
  });

  it('prevents a Finance Head from approving a TDS return they prepared', async () => {
    prisma.tdsReturn.findUnique.mockResolvedValue({ id: 't1', status: ComplianceReturnStatus.PENDING_APPROVAL, preparedById: head.id });
    await expect(service.approveTds('t1', head)).rejects.toThrow('cannot approve a TDS return they prepared');
  });

  it('deduplicates imported GSTR-2B lines', async () => {
    prisma.gstr2bLine.createMany.mockResolvedValue({ count: 1 });
    const row = { supplierGstin: '29ABCDE1234F1Z5', invoiceNumber: 'INV-1', invoiceDate: '2026-04-01', taxableAmount: 1000 };
    await expect(service.importGstr2b({ taxPeriod: '2026-04', lines: [row, row] }, { id: 'user-1' } as any)).resolves.toEqual({ imported: 1, duplicates: 1 });
  });

  it('calculates invoice TDS from the classified taxable base', async () => {
    prisma.accountsPayableInvoice.findUnique.mockResolvedValue({ id: 'ap-1', status: 'DRAFT' });
    prisma.accountsPayableInvoice.update.mockImplementation(({ data }) => data);
    const result: any = await service.setInvoiceTds('ap-1', { sectionCode: '194C', ratePercent: 2, taxableBase: 12500 }, { id: 'user-1' } as any);
    expect(result.tdsAmount.toString()).toBe('250');
  });

  it('prevents challan allocation beyond the deposited total', async () => {
    prisma.tdsChallan.findUnique.mockResolvedValue({ id: 'c-1', totalAmount: '1000', allocations: [{ amount: '800' }] });
    prisma.tdsReturn.findUnique.mockResolvedValue({ id: 't-1', status: 'PREPARED' });
    await expect(service.allocateChallan('c-1', { tdsReturnId: 't-1', amount: 250 }, { id: 'user-1' } as any)).rejects.toThrow('exceeds unallocated challan balance');
  });
});
