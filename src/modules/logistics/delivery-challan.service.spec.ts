import { OrderFinalQcStatus, Role } from '@prisma/client';
import { DeliveryChallanService } from './delivery-challan.service';

describe('DeliveryChallanService final QC clearance', () => {
  it('returns success without rewriting an order that is already cleared', async () => {
    const prisma = {
      order: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'order-1',
          finalQcStatus: OrderFinalQcStatus.CLEARED,
        }),
        update: jest.fn(),
      },
    };
    const access = {
      assertCanClearFinalQc: jest.fn().mockResolvedValue(undefined),
    };
    const service = new DeliveryChallanService(
      prisma as never,
      access as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(
      service.clearFinalQc('order-1', {
        id: 'admin-1',
        email: 'admin@example.com',
        role: Role.SUPER_ADMIN,
        verticalId: null,
      }),
    ).resolves.toEqual({
      orderId: 'order-1',
      finalQcStatus: OrderFinalQcStatus.CLEARED,
    });
    expect(prisma.order.update).not.toHaveBeenCalled();
  });
});

describe('DeliveryChallanService eligible dispatch orders', () => {
  it('returns operational order fields through the dedicated Quality-safe read', async () => {
    const prisma = {
      order: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'order-1',
            orderNumber: 'ORD-2026-0001',
            status: 'CONFIRMED',
            fulfilmentStatus: 'NOT_DISPATCHED',
            finalQcStatus: 'PENDING',
            lineItems: [
              {
                id: 'line-1', quantity: { toString: () => '2' }, productId: 'product-1',
                adHocProductName: null, product: { name: 'Rack', sku: 'RACK-1' },
              },
            ],
          },
        ]),
      },
    };
    const access = {
      assertCanViewDispatchOrders: jest.fn().mockResolvedValue(undefined),
    };
    const service = new DeliveryChallanService(
      prisma as never, access as never, {} as never, {} as never, {} as never, {} as never,
    );
    const result = await service.eligibleOrders({
      id: 'quality-1', email: 'quality@example.com', role: Role.EMPLOYEE, verticalId: 'quality',
    });
    expect(access.assertCanViewDispatchOrders).toHaveBeenCalled();
    expect(result[0]).toMatchObject({
      id: 'order-1', dispatchReady: true,
      lineItems: [{ id: 'line-1', quantity: '2', productName: 'Rack', productSku: 'RACK-1' }],
    });
  });
});
