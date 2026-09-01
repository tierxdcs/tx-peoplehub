import { Prisma } from '@prisma/client';
import { BomCostSnapshotService } from './bom-cost-snapshot.service';
import { ProductCatalogPriceService } from './product-catalog-price.service';

const D = (value: number) => new Prisma.Decimal(value);

/** The real catalog-price writer is wired in — the refresh must reprice too. */
const service = (prisma: any, costs: any) =>
  new BomCostSnapshotService(prisma, costs, new ProductCatalogPriceService());

describe('BomCostSnapshotService', () => {
  const releasedBom = {
    id: 'bom-1',
    itemId: 'fg-1',
    revisionNumber: 1,
    lines: [
      {
        itemId: 'cm-1',
        quantityPerUnit: D(2),
        wastagePercent: D(0),
        unitOfMeasure: 'pcs',
        makeBuy: 'BUY',
      },
      {
        itemId: 'cm-2',
        quantityPerUnit: D(1),
        wastagePercent: D(0),
        unitOfMeasure: 'pcs',
        makeBuy: 'BUY',
      },
    ],
  };

  it('returns an incomplete null snapshot instead of treating a missing cost as zero', async () => {
    const prisma: any = {
      bom: { findMany: jest.fn().mockResolvedValue([releasedBom]) },
    };
    const costs: any = {
      currentCost: jest
        .fn()
        .mockResolvedValueOnce({ amount: D(10), source: 'MANUAL_STANDARD' })
        .mockResolvedValueOnce({ amount: null, source: null }),
    };
    const snapshot = await service(prisma, costs).calculate('fg-1');
    expect(snapshot).toEqual({ amount: null, isComplete: false });
  });

  it('computes the same complete roll-up once every leaf has a cost', async () => {
    const prisma: any = {
      bom: { findMany: jest.fn().mockResolvedValue([releasedBom]) },
    };
    const costs: any = {
      currentCost: jest
        .fn()
        .mockResolvedValueOnce({ amount: D(10), source: 'MANUAL_STANDARD' })
        .mockResolvedValueOnce({ amount: D(5), source: 'LATEST_ACCEPTED_GRN' }),
    };
    const snapshot = await service(prisma, costs).calculate('fg-1');
    expect(snapshot.isComplete).toBe(true);
    expect(snapshot.amount?.toString()).toBe('25');
  });

  it('refreshes released BOM and existing resource-plan snapshots in place', async () => {
    const prisma: any = {
      bom: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([{ id: 'bom-1', itemId: 'fg-1' }])
          .mockResolvedValueOnce([releasedBom]),
        update: jest.fn(),
      },
      projectResourcePlanLine: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: 'plan-line-1', itemId: 'cm-2' }]),
        update: jest.fn(),
      },
      product: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn() },
    };
    const costs: any = {
      currentCost: jest
        .fn()
        .mockResolvedValueOnce({ amount: D(10), source: 'MANUAL_STANDARD' })
        .mockResolvedValueOnce({ amount: D(5), source: 'LATEST_ACCEPTED_GRN' })
        .mockResolvedValueOnce({ amount: D(5), source: 'LATEST_ACCEPTED_GRN' }),
    };

    await service(prisma, costs).refreshReleasedSnapshots();

    expect(prisma.bom.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'bom-1' },
        data: expect.objectContaining({
          rolledUpCostSnapshot: expect.any(Prisma.Decimal),
          isCostComplete: true,
        }),
      }),
    );
    expect(prisma.projectResourcePlanLine.update).toHaveBeenCalledWith({
      where: { id: 'plan-line-1' },
      data: { benchmarkCostPerUnit: D(5), isCostComplete: true },
    });
  });

  it('carries a cost that moved after release through to the catalog price', async () => {
    // A late GRN or a re-awarded RFQ moves the cost without any BOM revision,
    // so the sellable price has to follow it here too.
    const prisma: any = {
      bom: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([{ id: 'bom-1', itemId: 'fg-1' }])
          .mockResolvedValueOnce([releasedBom]),
        update: jest.fn(),
      },
      projectResourcePlanLine: {
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
      },
      product: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'prod-1',
            targetMarginPercent: D(20),
            unitPrice: D(0),
          },
        ]),
        update: jest.fn(),
      },
    };
    const costs: any = {
      currentCost: jest
        .fn()
        .mockResolvedValue({ amount: D(10), source: 'MANUAL_STANDARD' }),
    };

    await service(prisma, costs).refreshReleasedSnapshots();

    expect(prisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { itemId: 'fg-1', autoPricedFromBomCost: true },
      }),
    );
    // 2 × 10 + 1 × 10 = 30 cost at a 20% margin → 30 / 0.8.
    expect(prisma.product.update.mock.calls[0][0].data.unitPrice.toString()).toBe(
      '37.5',
    );
  });
});
