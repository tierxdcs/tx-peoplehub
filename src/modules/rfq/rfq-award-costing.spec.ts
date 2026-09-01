import { Prisma } from '@prisma/client';
import { RfqService } from './rfq.service';

const D = (value: string | number) => new Prisma.Decimal(value);

/**
 * Awarding an RFQ is the moment the cost of a bought-out item is settled, and
 * that cost is what the product catalog prices against. So the award has to
 * carry through: record the quoted cost, then re-roll the released BOMs that
 * consume the item. Without the second half the catalog keeps showing the old
 * cost (and the price derived from it) until something unrelated happens to
 * touch the item.
 */
describe('RfqService.award — carrying the awarded cost to the catalog', () => {
  function setup() {
    const order: string[] = [];
    const tx = {
      rfq: { update: jest.fn() },
      itemQuotedCost: {
        createMany: jest.fn(() => {
          order.push('itemQuotedCost.createMany');
          return Promise.resolve({});
        }),
      },
    };
    const prisma: any = {
      rfq: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'rfq-1',
          rfqNumber: 'RFQ-2026-0004',
          status: 'CLOSED',
          lines: [
            {
              id: 'rl-1',
              itemId: 'cm-1',
              quantity: D(10),
              unitOfMeasure: 'NOS',
            },
          ],
        }),
      },
      rfqInvitee: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'invitee-1',
          rfqId: 'rfq-1',
          quoteStatus: 'SUBMITTED',
          supplierId: 'sup-1',
          supplier: { id: 'sup-1' },
          vendorId: null,
          vendor: null,
          quotes: [
            {
              id: 'quote-1',
              revisionNumber: 2,
              totalQuotedValue: D(1750),
              lines: [{ id: 'ql-1', rfqLineId: 'rl-1', unitPrice: D(175) }],
            },
          ],
        }),
        findMany: jest
          .fn()
          .mockResolvedValue([{ quotes: [{ totalQuotedValue: D(1750) }] }]),
      },
      $transaction: jest.fn(async (cb: any) => cb(tx)),
    };
    const access: any = { assertCanAward: jest.fn(), assertCanReadRfqs: jest.fn() };
    const purchaseOrders: any = {
      create: jest.fn().mockResolvedValue({ id: 'po-1' }),
    };
    const costSnapshots: any = {
      refreshReleasedSnapshots: jest.fn(() => {
        order.push('refreshReleasedSnapshots');
        return Promise.resolve();
      }),
    };
    const service = new RfqService(
      prisma,
      access,
      {} as never,
      purchaseOrders,
      {} as never,
      {} as never,
      costSnapshots,
      {} as never,
      {} as never,
      {} as never,
      { approvalRequired: jest.fn() } as never,
    );
    jest.spyOn(service, 'get').mockResolvedValue({ id: 'rfq-1' } as never);
    return { service, prisma, tx, costSnapshots, order };
  }

  const user = { id: 'scm-1' } as never;

  it('records the quoted cost and then re-rolls the released BOMs that use the item', async () => {
    const { service, tx, costSnapshots, order } = setup();

    await service.award('rfq-1', { inviteeId: 'invitee-1' } as never, user);

    expect(tx.itemQuotedCost.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            itemId: 'cm-1',
            rfqId: 'rfq-1',
            quoteLineId: 'ql-1',
            unitPrice: D(175),
          }),
        ],
      }),
    );
    expect(costSnapshots.refreshReleasedSnapshots).toHaveBeenCalledTimes(1);
    // Order matters: re-costing before the cost is committed would roll up the
    // old price and leave the catalog one award behind.
    expect(order).toEqual([
      'itemQuotedCost.createMany',
      'refreshReleasedSnapshots',
    ]);
  });

  it('does not re-cost anything when the award is refused', async () => {
    const { service, prisma, costSnapshots } = setup();
    prisma.rfq.findUnique.mockResolvedValue({
      id: 'rfq-1',
      rfqNumber: 'RFQ-2026-0004',
      status: 'ISSUED',
      lines: [],
    });

    await expect(
      service.award('rfq-1', { inviteeId: 'invitee-1' } as never, user),
    ).rejects.toThrow(/Only a CLOSED RFQ can be awarded/);
    expect(costSnapshots.refreshReleasedSnapshots).not.toHaveBeenCalled();
  });
});
