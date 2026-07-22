import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../core/database/prisma.service';
import { SalesNumberingService } from './sales-numbering.service';

describe('SalesNumberingService', () => {
  let service: SalesNumberingService;
  let tx: { $queryRaw: jest.Mock };
  let prisma: { salesSequence: { findUnique: jest.Mock } };

  beforeEach(async () => {
    prisma = { salesSequence: { findUnique: jest.fn() } };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SalesNumberingService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = module.get(SalesNumberingService);
    tx = { $queryRaw: jest.fn() };
  });

  it('formats the number as PREFIX-YEAR-#### zero-padded to 4', async () => {
    tx.$queryRaw.mockResolvedValue([{ lastValue: 1 }]);
    const num = await service.nextNumber('LD', 'lead', 2026, tx as any);
    expect(num).toBe('LD-2026-0001');
  });

  it('does not pad beyond 4 digits once the counter exceeds 9999', async () => {
    tx.$queryRaw.mockResolvedValue([{ lastValue: 12345 }]);
    const num = await service.nextNumber('BID', 'bid', 2026, tx as any);
    expect(num).toBe('BID-2026-12345');
  });

  it('uses the provided year in the prefix (annual reset comes from the (entity,year) key)', async () => {
    tx.$queryRaw.mockResolvedValue([{ lastValue: 1 }]);
    const num = await service.nextNumber('ORD', 'order', 2027, tx as any);
    // A fresh year returns lastValue 1 again from the counter table — the
    // year segment differentiates it from 2026's ORD-2026-0001.
    expect(num).toBe('ORD-2027-0001');
  });

  it('runs the atomic upsert on the passed transaction client', async () => {
    tx.$queryRaw.mockResolvedValue([{ lastValue: 7 }]);
    await service.nextNumber('LD', 'lead', 2026, tx as any);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
  });

  describe('nextContinuousNumber', () => {
    it('formats the number as PREFIX-##### zero-padded to 5, no year segment', async () => {
      tx.$queryRaw.mockResolvedValue([{ lastValue: 1 }]);
      const num = await service.nextContinuousNumber('RM', 'item_raw_material', tx as any);
      expect(num).toBe('RM-00001');
    });

    it('does not pad beyond 5 digits once the counter exceeds 99999', async () => {
      tx.$queryRaw.mockResolvedValue([{ lastValue: 123456 }]);
      const num = await service.nextContinuousNumber('CM', 'item_component', tx as any);
      expect(num).toBe('CM-123456');
    });

    it('runs the atomic upsert on the passed transaction client', async () => {
      tx.$queryRaw.mockResolvedValue([{ lastValue: 3 }]);
      await service.nextContinuousNumber('SA', 'item_subassembly', tx as any);
      expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    });
  });

  describe('peekNextContinuousNumber', () => {
    it('previews lastValue + 1 without consuming a sequence value', async () => {
      prisma.salesSequence.findUnique.mockResolvedValue({ lastValue: 5 });
      const preview = await service.peekNextContinuousNumber('FG', 'item_finished_good');
      expect(preview).toBe('FG-00006');
      // A read-only preview must never touch the atomic-increment path.
      expect(tx.$queryRaw).not.toHaveBeenCalled();
    });

    it('previews 1 when no sequence row exists yet (first item of this type)', async () => {
      prisma.salesSequence.findUnique.mockResolvedValue(null);
      const preview = await service.peekNextContinuousNumber('CN', 'item_consumable');
      expect(preview).toBe('CN-00001');
    });

    it('does not mutate state between repeated previews', async () => {
      prisma.salesSequence.findUnique.mockResolvedValue({ lastValue: 10 });
      const first = await service.peekNextContinuousNumber('RM', 'item_raw_material');
      const second = await service.peekNextContinuousNumber('RM', 'item_raw_material');
      expect(first).toBe(second);
    });
  });
});
