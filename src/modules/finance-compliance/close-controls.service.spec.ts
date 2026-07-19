import { Prisma, ReconciliationSeverity } from '@prisma/client';
import { CloseControlsService } from './close-controls.service';

describe('CloseControlsService', () => {
  const access = { assertCanUseFinance: jest.fn(), assertAccountsHead: jest.fn() };
  const prisma = {
    periodClose: { findUnique: jest.fn() }, periodCloseTask: { findFirst: jest.fn(), update: jest.fn() },
    reconciliationException: { findUnique: jest.fn(), update: jest.fn() },
  };
  const service = new CloseControlsService(prisma as any, access as any);
  beforeEach(() => jest.clearAllMocks());

  it('passes a reconciliation inside the one-paisa tolerance', () => {
    const result = (service as any).result('TEST', 'Test', new Prisma.Decimal('100.00'), new Prisma.Decimal('99.995'), ReconciliationSeverity.BLOCKING);
    expect(result.ok).toBe(true);
  });

  it('marks a material variance as a failed control', () => {
    const result = (service as any).result('TEST', 'Test', new Prisma.Decimal('100'), new Prisma.Decimal('99.98'));
    expect(result.ok).toBe(false);
    expect(result.variance.toString()).toBe('0.02');
  });

  it('allows only the Finance Head to waive an exception', async () => {
    prisma.reconciliationException.findUnique.mockResolvedValue({ id: 'e-1', assignedToId: null, run: { periodClose: { status: 'PREPARING' } } });
    prisma.reconciliationException.update.mockResolvedValue({ id: 'e-1', status: 'WAIVED' });
    await service.resolve('e-1', { status: 'WAIVED', resolutionNote: 'Reviewed and immaterial' }, { id: 'head-1' } as any);
    expect(access.assertAccountsHead).toHaveBeenCalled();
    expect(access.assertCanUseFinance).not.toHaveBeenCalled();
  });
});
