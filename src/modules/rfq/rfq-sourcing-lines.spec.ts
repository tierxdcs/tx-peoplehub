import { Prisma } from '@prisma/client';
import { RfqService } from './rfq.service';

const D = (value: string | number) => new Prisma.Decimal(value);

describe('RfqService.sourcingLines', () => {
  let prisma: any;
  let access: any;
  let service: RfqService;

  beforeEach(() => {
    prisma = {
      projectKickoff: { findUnique: jest.fn() },
      bom: { findMany: jest.fn() },
      item: { findMany: jest.fn() },
    };
    access = { assertCanReadRfqs: jest.fn() };
    service = new RfqService(
      prisma,
      access,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
  });

  function mockProject(excludedValidationIds = ['ol-1', 'ol-2']) {
    prisma.projectKickoff.findUnique
      .mockResolvedValueOnce({
        order: {
          lineItems: excludedValidationIds.map((id) => ({ id })),
        },
      })
      .mockResolvedValueOnce({
        order: {
          lineItems: [
            { id: 'ol-1', quantity: D(2), product: { itemId: 'fg-1' } },
            { id: 'ol-2', quantity: D(3), product: { itemId: 'fg-2' } },
          ],
        },
      });
    prisma.bom.findMany.mockResolvedValue([
      {
        itemId: 'fg-1',
        revisionNumber: 1,
        lines: [
          {
            itemId: 'sa-1',
            quantityPerUnit: D(2),
            wastagePercent: D(0),
            unitOfMeasure: 'ea',
            makeBuy: 'MAKE',
          },
        ],
      },
      {
        itemId: 'sa-1',
        revisionNumber: 1,
        lines: [
          {
            itemId: 'rm-1',
            quantityPerUnit: D(4),
            wastagePercent: D(0),
            unitOfMeasure: 'kg',
            makeBuy: 'BUY',
          },
        ],
      },
      {
        itemId: 'fg-2',
        revisionNumber: 1,
        lines: [
          {
            itemId: 'rm-1',
            quantityPerUnit: D(5),
            wastagePercent: D(0),
            unitOfMeasure: 'kg',
            makeBuy: 'BUY',
          },
        ],
      },
    ]);
    prisma.item.findMany.mockResolvedValue([
      {
        id: 'rm-1',
        itemCode: 'RM-0001',
        name: 'Steel',
        baseUnitOfMeasure: 'kg',
      },
    ]);
  }

  it('recurses MAKE lines, aggregates BUY requirements across order lines, and omits MAKE assemblies', async () => {
    mockProject();
    const result = await service.sourcingLines('kickoff-1', [], {
      id: 'u1',
    } as never);

    // fg-1: 2 ordered × 2 SA × 4 kg = 16; fg-2: 3 × 5 kg = 15.
    expect(result).toEqual([
      {
        itemId: 'rm-1',
        itemCode: 'RM-0001',
        itemName: 'Steel',
        requiredQuantity: '31',
        unitOfMeasure: 'kg',
      },
    ]);
    expect(result.some((line) => line.itemId === 'sa-1')).toBe(false);
  });

  it('removes an excluded order line contribution', async () => {
    mockProject();
    const result = await service.sourcingLines('kickoff-1', ['ol-2'], {
      id: 'u1',
    } as never);
    expect(result[0].requiredQuantity).toBe('16');
  });

  it('returns an empty recommendation when included products have no released BOM', async () => {
    mockProject(['ol-1', 'ol-2']);
    prisma.bom.findMany.mockResolvedValue([]);
    prisma.item.findMany.mockResolvedValue([]);
    await expect(
      service.sourcingLines('kickoff-1', [], { id: 'u1' } as never),
    ).resolves.toEqual([]);
  });
});
