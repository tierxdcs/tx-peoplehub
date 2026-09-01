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
          confirmationSheets: [
            { deliveryDate: new Date('2026-08-10T00:00:00Z') },
          ],
          lineItems: [
            {
              id: 'line-1',
              product: { name: 'Rack System' },
              deliveryChallanLines: [],
              plmTrackers: [
                {
                  currentStage: PlmStage.PRODUCTION,
                  flowType: 'VENDOR',
                  createdAt: new Date('2026-07-01T00:00:00Z'),
                  kickoff: {
                    meetingDate: new Date('2026-07-01T10:30:00Z'),
                    status: 'COMPLETED',
                  },
                  events: [
                    {
                      toStage: PlmStage.RELEASE_TO_SCM,
                      createdAt: new Date('2026-07-01T11:00:00Z'),
                    },
                    {
                      toStage: PlmStage.PRODUCTION,
                      createdAt: new Date('2026-07-03T09:15:00Z'),
                    },
                  ],
                  productionCards: [
                    { list: { isDoneList: true } },
                    { list: { isDoneList: false } },
                  ],
                },
              ],
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
    // Customer portal adds Kickoff before the internal standard flow.
    expect(response.lines[0].stages.map((s) => s.label)).toEqual([
      'Project Kickoff',
      'Release to SCM',
      'Material Planning',
      'Production',
      'QC',
      'Dispatch',
      'Completed',
    ]);
    expect(response.lines[0].stages[0]).toMatchObject({
      state: 'DONE',
      changedAt: '2026-07-01T10:30:00.000Z',
    });
    expect(response.lines[0].currentStage.changedAt).toBe(
      '2026-07-03T09:15:00.000Z',
    );
    for (const forbidden of [
      'owner',
      'employee',
      'vendor',
      'supplier',
      'flowtype',
      'deliverytype',
      'price',
      'cost',
      'comment',
      'private-owner-id',
    ]) {
      expect(serialized.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });

  it('mirrors the full 9-stage NPD flow for a new-product line', async () => {
    const prisma = {
      orderCustomerProgressInvite: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'invite-1',
          orderId: 'order-1',
          revokedAt: null,
          expiresAt: new Date('2027-07-28T00:00:00.000Z'),
          passwordHash: null,
          order: { ownerId: 'owner-1', orderNumber: 'ORD-2026-0002' },
        }),
      },
      order: {
        findUnique: jest.fn().mockResolvedValue({
          orderNumber: 'ORD-2026-0002',
          customer: { name: 'Customer XYZ' },
          customerSignoff: null,
          confirmationSheets: [],
          lineItems: [
            {
              id: 'line-1',
              product: { name: 'New Rack' },
              deliveryChallanLines: [],
              plmTrackers: [
                {
                  currentStage: PlmStage.DESIGN_REVIEW,
                  flowType: 'NPD',
                  createdAt: new Date('2026-07-01T00:00:00Z'),
                  kickoff: {
                    meetingDate: new Date('2026-07-01T10:30:00Z'),
                    status: 'COMPLETED',
                  },
                  events: [
                    {
                      toStage: PlmStage.DESIGN,
                      createdAt: new Date('2026-07-01T11:00:00Z'),
                    },
                    {
                      toStage: PlmStage.DESIGN_REVIEW,
                      createdAt: new Date('2026-07-02T08:00:00Z'),
                    },
                  ],
                  productionCards: [],
                },
              ],
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
    expect(response.lines[0].stages.map((s) => s.label)).toEqual([
      'Project Kickoff',
      'Design',
      'Design Review',
      'Drawing Release',
      'Release to SCM',
      'Material Planning',
      'Production',
      'QC',
      'Dispatch',
      'Completed',
    ]);
    // Kickoff and Design are done; DESIGN_REVIEW is current.
    expect(response.lines[0].currentStage.label).toBe('Design Review');
    expect(response.lines[0].stages[0].state).toBe('DONE');
    expect(response.lines[0].stages[1].state).toBe('DONE');
    expect(response.lines[0].stages[2].state).toBe('CURRENT');
    expect(response.lines[0].stages[3].state).toBe('UPCOMING');
  });

  it('represents a split line by its least-advanced vendor tracker', async () => {
    const prisma = {
      orderCustomerProgressInvite: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'invite-1',
          orderId: 'order-1',
          revokedAt: null,
          expiresAt: new Date('2027-07-28T00:00:00.000Z'),
          passwordHash: null,
          order: { ownerId: 'owner-1', orderNumber: 'ORD-2026-0003' },
        }),
      },
      order: {
        findUnique: jest.fn().mockResolvedValue({
          orderNumber: 'ORD-2026-0003',
          customer: { name: 'Customer LMN' },
          customerSignoff: null,
          confirmationSheets: [],
          lineItems: [
            {
              id: 'line-1',
              product: { name: 'Split Rack' },
              deliveryChallanLines: [],
              // Same line, two vendor splits at different stages. The line is
              // only as far along as its slowest vendor portion.
              plmTrackers: [
                {
                  currentStage: PlmStage.DISPATCH,
                  flowType: 'VENDOR',
                  createdAt: new Date('2026-07-01T00:00:00Z'),
                  kickoff: {
                    meetingDate: new Date('2026-07-01T10:30:00Z'),
                    status: 'COMPLETED',
                  },
                  events: [],
                  productionCards: [],
                },
                {
                  currentStage: PlmStage.RELEASE_TO_SCM,
                  flowType: 'VENDOR',
                  createdAt: new Date('2026-07-01T00:00:00Z'),
                  kickoff: {
                    meetingDate: new Date('2026-07-01T10:30:00Z'),
                    status: 'COMPLETED',
                  },
                  events: [],
                  productionCards: [],
                },
              ],
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
    // Least-advanced split is at Release to SCM, so the whole line reads there
    // — not at the further-along Dispatch split.
    expect(response.lines[0].currentStage.label).toBe('Release to SCM');
    expect(response.canSignoff).toBe(false);
  });

  /**
   * COMPLETED is terminal: nothing happens *in* it. The final node used to be
   * capped at CURRENT, so a finished order showed every earlier stage ticked and
   * left "Completed" sitting as an unticked, in-progress step forever.
   */
  describe('a finished line ticks its final stage', () => {
    const finishedOrder = (overrides: {
      currentStage: PlmStage;
      deliveryChallanLines?: unknown[];
    }) => ({
      orderCustomerProgressInvite: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'invite-1',
          orderId: 'order-1',
          revokedAt: null,
          expiresAt: new Date('2027-07-28T00:00:00.000Z'),
          passwordHash: null,
          order: { ownerId: 'owner-1', orderNumber: 'ORD-2026-0002' },
        }),
      },
      order: {
        findUnique: jest.fn().mockResolvedValue({
          orderNumber: 'ORD-2026-0002',
          customer: { name: 'Company ABC' },
          customerSignoff: null,
          confirmationSheets: [],
          lineItems: [
            {
              id: 'line-1',
              product: { name: 'Customer PO name' },
              deliveryChallanLines: overrides.deliveryChallanLines ?? [],
              plmTrackers: [
                {
                  currentStage: overrides.currentStage,
                  flowType: 'VENDOR',
                  createdAt: new Date('2026-09-01T10:17:31Z'),
                  kickoff: {
                    meetingDate: new Date('2026-09-01T10:17:31Z'),
                    status: 'COMPLETED',
                  },
                  events: [],
                  productionCards: [],
                },
              ],
            },
          ],
        }),
      },
    });

    const resolve = async (prisma: unknown) => {
      const response = await new CustomerOrderProgressService(
        prisma as never,
      ).resolvePublic('opaque-token');
      if ('requiresPassword' in response) {
        throw new Error('Unexpected password challenge');
      }
      return response;
    };

    it('marks every stage DONE — including Completed — and nothing CURRENT', async () => {
      const response = await resolve(
        finishedOrder({ currentStage: PlmStage.COMPLETED }),
      );
      const stages = response.lines[0].stages;
      expect(stages.at(-1)?.label).toBe('Completed');
      expect(stages.map((s) => s.state)).toEqual(stages.map(() => 'DONE'));
      // The header chip still reads Completed, and sign-off still opens.
      expect(response.lines[0].currentStage.label).toBe('Completed');
      expect(response.canSignoff).toBe(true);
    });

    it('does the same for a shipped line whose tracker has not caught up', async () => {
      const response = await resolve(
        finishedOrder({
          currentStage: PlmStage.DISPATCH,
          deliveryChallanLines: [{ id: 'dcl-1' }],
        }),
      );
      expect(response.lines[0].stages.map((s) => s.state)).not.toContain(
        'CURRENT',
      );
      expect(response.lines[0].stages.at(-1)?.state).toBe('DONE');
    });

    it('still leaves Completed UPCOMING while the line is mid-flow', async () => {
      const response = await resolve(
        finishedOrder({ currentStage: PlmStage.DISPATCH }),
      );
      const stages = response.lines[0].stages;
      expect(stages.at(-1)?.state).toBe('UPCOMING');
      expect(stages.filter((s) => s.state === 'CURRENT')).toHaveLength(1);
      expect(response.lines[0].currentStage.label).toBe('Dispatch');
    });
  });
});
