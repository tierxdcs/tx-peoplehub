import { Prisma } from '@prisma/client';
import { TreasuryService } from './treasury.service';

describe('TreasuryService accounting controls', () => {
  const access = { assertCanUseFinance: jest.fn(), assertAccountsHead: jest.fn() };
  const prisma = { fxRevaluationRun: { findUnique: jest.fn(), update: jest.fn() } };
  const service = new TreasuryService(prisma as any, access as any);
  beforeEach(() => jest.clearAllMocks());

  it('recognizes an AR gain when the closing rate rises', () => {
    const line = (service as any).fxLine('AR','i1','INV-1','Customer','USD',new Prisma.Decimal(100),new Prisma.Decimal(80),new Prisma.Decimal(82),false);
    expect(line.carryingAmountInr.toString()).toBe('8000');
    expect(line.revaluedAmountInr.toString()).toBe('8200');
    expect(line.gainLossInr.toString()).toBe('200');
  });

  it('recognizes an AP loss when the closing rate rises', () => {
    const line = (service as any).fxLine('AP','i1','BILL-1','Vendor','EUR',new Prisma.Decimal(100),new Prisma.Decimal(90),new Prisma.Decimal(92),true);
    expect(line.gainLossInr.toString()).toBe('-200');
  });

  it('prevents self-approval of an FX run', async () => {
    prisma.fxRevaluationRun.findUnique.mockResolvedValue({ id:'fx-1', status:'PENDING_APPROVAL', createdById:'head-1', lines:[] });
    await expect(service.approveFx('fx-1',{id:'head-1'} as any)).rejects.toThrow('cannot approve an FX run they created');
  });
});
