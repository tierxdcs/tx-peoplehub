import { PlmStage } from '@prisma/client';
import {
  CustomerOrderProgressService,
  deliveryCountdown,
  productionPercent,
} from './customer-order-progress.service';

describe('CustomerOrderProgressService', () => {
  it('uses the done-list calculation for production percentage', () => {
    expect(
      productionPercent([
        { list: { isDoneList: true } },
        { list: { isDoneList: false } },
      ]),
    ).toBe(50);
    expect(productionPercent([])).toBe(0);
  });

  it('switches delivery countdown into a distinct overdue state', () => {
    expect(
      deliveryCountdown(
        new Date('2026-07-25T00:00:00.000Z'),
        false,
        new Date('2026-07-28T12:00:00.000Z'),
      ),
    ).toEqual({ state: 'OVERDUE', days: 3 });
  });

  it('returns a clean password challenge instead of a 403 on initial entry', async () => {
    const prisma = {
      orderCustomerProgressInvite: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'invite-1',
          orderId: 'order-1',
          revokedAt: null,
          expiresAt: new Date('2027-07-28T00:00:00.000Z'),
          passwordHash: 'stored-hash',
          order: { ownerId: 'owner-1', orderNumber: 'ORD-1' },
        }),
      },
    };
    const service = new CustomerOrderProgressService(prisma as never);
    await expect(service.resolvePublic('opaque-token')).resolves.toEqual({
      requiresPassword: true,
    });
  });

  it('returns only allow-listed customer-safe fields and universal stages', async () => {
    const prisma = {
      orderCustomerProgressInvite: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'invite-1',
          orderId: 'order-1',
          revokedAt: null,
          expiresAt: new Date('2027-07-28T00:00:00.000Z'),
          passwordHash: null,
          order: {
            ownerId: 'private-owner-id',
            orderNumber: 'ORD-2026-0001',
          },
        }),
      },
      order: {
        findUnique: jest.fn().mockResolvedValue({
          orderNumber: 'ORD-2026-0001',
          customer: { name: 'Customer ABC' },
          customerSignoff: null,
          confirmationSheets: [{ deliveryDate: new Date('2026-08-10T00:00:00Z') }],
          lineItems: [
            {
              id: 'line-1',
              product: { name: 'Rack System' },
              deliveryChallanLines: [],
              plmTracker: {
                currentStage: PlmStage.PRODUCTION,
                createdAt: new Date('2026-07-01T00:00:00Z'),
                kickoff: { meetingDate: new Date('2026-07-01T00:00:00Z') },
                productionCards: [
                  { list: { isDoneList: true } },
                  { list: { isDoneList: false } },
                ],
              },
            },
          ],
        }),
      },
    };
    const service = new CustomerOrderProgressService(prisma as never);
    const response = await service.resolvePublic('opaque-token');
    if ('requiresPassword' in response) {
      throw new Error('Unexpected password challenge');
    }
    const serialized = JSON.stringify(response);

    expect(response.lines[0].currentStage.label).toBe('Production');
    expect(response.lines[0].productionPercent).toBe(50);
    expect(response.lines[0].stages).toHaveLength(6);
    for (const forbidden of [
      'owner',
      'employee',
      'vendor',
      'supplier',
      'flowType',
      'deliveryType',
      'price',
      'cost',
      'comment',
      'private-owner-id',
    ]) {
      expect(serialized.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });
});
