import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../core/database/prisma.service';
import { SalesNumberingService } from './sales-numbering.service';

describe('SalesNumberingService', () => {
  let service: SalesNumberingService;
  let tx: { $queryRaw: jest.Mock };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SalesNumberingService,
        { provide: PrismaService, useValue: {} },
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
});
