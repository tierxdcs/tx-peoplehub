import {
  OrderLineDeliveryType,
  PlmStage,
  PlmTrackerStatus,
} from '@prisma/client';
import { PlmVendorCadenceSweepService } from './plm-vendor-cadence-sweep.service';

const DAY_MS = 86_400_000;
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000);

/**
 * A tracker in production with a 2-day cadence. `productionUpdates` is the
 * cadence clock's reset point, so each test sets it to place the tracker on the
 * green / amber / red side of the same threshold the PLM board uses.
 */
function tracker(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tracker-1',
    ownerId: 'owner-1',
    createdAt: new Date(Date.now() - 30 * DAY_MS),
    vendor: { companyName: 'Ashoka Fabricators' },
    split: { vendorName: 'Ashoka Fab (as typed)' },
    order: { orderNumber: 'ORD-2026-0011' },
    kickoff: { vendorUpdateCadenceDays: 2 },
    orderLine: {
      customerFacingProductName: 'Platform Emergency Kiosk',
      adHocProductName: null,
      product: { name: 'PEK-Mk2' },
    },
    productionUpdates: [{ createdAt: hoursAgo(1) }],
    events: [{ createdAt: hoursAgo(200) }],
    ...overrides,
  };
}

describe('PlmVendorCadenceSweepService', () => {
  let prisma: any;
  let pushEvents: any;
  let service: PlmVendorCadenceSweepService;

  beforeEach(() => {
    prisma = { plmTracker: { findMany: jest.fn().mockResolvedValue([]) } };
    pushEvents = {
      plmVendorCadenceBreach: jest.fn().mockResolvedValue(undefined),
    };
    service = new PlmVendorCadenceSweepService(prisma, pushEvents);
  });

  it('looks only at vendor trackers that are active and in production', async () => {
    await service.notifyVendorCadenceBreaches();
    // A vendor cannot be late on a portion they have not been asked to build
    // yet, or on a tracker that is finished or on hold.
    expect(prisma.plmTracker.findMany.mock.calls[0][0].where).toEqual({
      flowType: OrderLineDeliveryType.VENDOR,
      status: PlmTrackerStatus.ACTIVE,
      currentStage: PlmStage.PRODUCTION,
    });
  });

  it('pushes to the owner when the cadence has lapsed', async () => {
    prisma.plmTracker.findMany.mockResolvedValue([
      tracker({ productionUpdates: [{ createdAt: hoursAgo(60) }] }),
    ]);
    await service.notifyVendorCadenceBreaches();
    expect(pushEvents.plmVendorCadenceBreach).toHaveBeenCalledWith({
      trackerId: 'tracker-1',
      ownerId: 'owner-1',
      // The approved-vendor record wins over the name typed on the split.
      vendorName: 'Ashoka Fabricators',
      orderNumber: 'ORD-2026-0011',
      productName: 'Platform Emergency Kiosk',
      cadenceDays: 2,
    });
  });

  it('stays quiet while an update is merely due soon', async () => {
    // 39h of a 48h cadence is AMBER on the board — visible there, not a buzz.
    prisma.plmTracker.findMany.mockResolvedValue([
      tracker({ productionUpdates: [{ createdAt: hoursAgo(39) }] }),
    ]);
    await service.notifyVendorCadenceBreaches();
    expect(pushEvents.plmVendorCadenceBreach).not.toHaveBeenCalled();
  });

  it('stays quiet for a vendor reporting on time', async () => {
    prisma.plmTracker.findMany.mockResolvedValue([tracker()]);
    await service.notifyVendorCadenceBreaches();
    expect(pushEvents.plmVendorCadenceBreach).not.toHaveBeenCalled();
  });

  it('measures a vendor who has never reported from when production started', async () => {
    // No updates at all: 60h since the PRODUCTION event is late on a 2-day
    // cadence. They are overdue relative to being asked, not to nothing.
    prisma.plmTracker.findMany.mockResolvedValue([
      tracker({ productionUpdates: [], events: [{ createdAt: hoursAgo(60) }] }),
    ]);
    await service.notifyVendorCadenceBreaches();
    expect(pushEvents.plmVendorCadenceBreach).toHaveBeenCalledTimes(1);
  });

  it('falls back to the tracker itself when there is no production event either', async () => {
    prisma.plmTracker.findMany.mockResolvedValue([
      tracker({
        productionUpdates: [],
        events: [],
        createdAt: hoursAgo(2),
        kickoff: { vendorUpdateCadenceDays: 1 },
      }),
    ]);
    await service.notifyVendorCadenceBreaches();
    // 2h into a 1-day cadence — the last fallback must not read as "overdue
    // since the epoch" and buzz every owner on a fresh tracker.
    expect(pushEvents.plmVendorCadenceBreach).not.toHaveBeenCalled();
  });

  it('names the vendor from the split when no vendor record is linked', async () => {
    prisma.plmTracker.findMany.mockResolvedValue([
      tracker({
        vendor: null,
        productionUpdates: [{ createdAt: hoursAgo(60) }],
      }),
    ]);
    await service.notifyVendorCadenceBreaches();
    expect(pushEvents.plmVendorCadenceBreach.mock.calls[0][0].vendorName).toBe(
      'Ashoka Fab (as typed)',
    );
  });

  it('keeps sweeping the rest when one tracker is unnameable', async () => {
    prisma.plmTracker.findMany.mockResolvedValue([
      tracker({
        id: 'tracker-1',
        vendor: null,
        split: { vendorName: null },
        orderLine: {
          customerFacingProductName: null,
          adHocProductName: null,
          product: null,
        },
        productionUpdates: [{ createdAt: hoursAgo(60) }],
      }),
      tracker({
        id: 'tracker-2',
        productionUpdates: [{ createdAt: hoursAgo(60) }],
      }),
    ]);
    await service.notifyVendorCadenceBreaches();
    const first = pushEvents.plmVendorCadenceBreach.mock.calls[0][0];
    expect(first.vendorName).toBe('the vendor');
    expect(first.productName).toBe('Unnamed product');
    expect(pushEvents.plmVendorCadenceBreach).toHaveBeenCalledTimes(2);
  });

  it('logs and returns rather than throwing out of the cron', async () => {
    // Nothing is awaiting a cron, so a rejection here would surface as an
    // unhandled rejection. A missed reminder is not worth a noisy process.
    prisma.plmTracker.findMany.mockRejectedValue(new Error('connection reset'));
    await expect(
      service.notifyVendorCadenceBreaches(),
    ).resolves.toBeUndefined();
  });
});
