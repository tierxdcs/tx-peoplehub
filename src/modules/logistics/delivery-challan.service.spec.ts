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
