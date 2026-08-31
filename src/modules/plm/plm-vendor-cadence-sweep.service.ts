import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  OrderLineDeliveryType,
  PlmStage,
  PlmTrackerStatus,
} from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { PushEventsService } from '../notifications/push-events.service';
import { deriveVendorCadence } from './plm-vendor-cadence';

/**
 * Pushes "this vendor is overdue an update" to the tracker owner, once a day.
 *
 * Why a sweep and not a trigger, unlike every other push in the app: a cadence
 * breach is not an action anyone takes. `deriveVendorCadence` is a pure function
 * of (last update, cadence days, now), evaluated when a screen is read — the RED
 * state arrives by the clock moving, and there is no write, no request and no
 * actor at the moment it happens. Nothing exists to hook, so something has to
 * look. This mirrors `QmsService.notifyOverdueActions`, the same shape for the
 * same reason (an overdue date is also just the clock).
 *
 * The evaluation itself is NOT re-implemented here: the same
 * `deriveVendorCadence` and the same reference-date fallback chain that
 * `PlmService.withDerived` uses decide RED, so a tracker that shows red on the
 * PLM board is exactly the one that pushes.
 */
@Injectable()
export class PlmVendorCadenceSweepService {
  private readonly logger = new Logger(PlmVendorCadenceSweepService.name);

  constructor(
    private readonly prisma: PrismaService,
    // PushEventsModule is @Global, so this needs no import edge here.
    private readonly pushEvents: PushEventsService,
  ) {}

  /**
   * 09:00 IST daily — the start of the working day, when chasing a vendor is
   * something the owner can actually do.
   *
   * Runs every morning while a tracker stays overdue rather than once on the
   * crossing. That is deliberate: an un-chased vendor is still a problem on day
   * three, and the push `tag` is keyed to the tracker, so each morning REPLACES
   * the standing notification instead of stacking another one.
   */
  @Cron('0 9 * * *', { timeZone: 'Asia/Kolkata' })
  async notifyVendorCadenceBreaches(): Promise<void> {
    let breached = 0;
    try {
      const trackers = await this.prisma.plmTracker.findMany({
        // The same three conditions under which the PLM board computes a cadence
        // at all: a vendor is only late once they are actually building.
        where: {
          flowType: OrderLineDeliveryType.VENDOR,
          status: PlmTrackerStatus.ACTIVE,
          currentStage: PlmStage.PRODUCTION,
        },
        select: {
          id: true,
          ownerId: true,
          createdAt: true,
          vendor: { select: { companyName: true } },
          split: { select: { vendorName: true } },
          order: { select: { orderNumber: true } },
          kickoff: { select: { vendorUpdateCadenceDays: true } },
          orderLine: {
            select: {
              customerFacingProductName: true,
              adHocProductName: true,
              product: { select: { name: true } },
            },
          },
          // Newest vendor update — the cadence clock's reset point.
          productionUpdates: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { createdAt: true },
          },
          // When production started, the fallback for a vendor who has never
          // reported: they are late relative to being asked, not to nothing.
          events: {
            where: { toStage: PlmStage.PRODUCTION },
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { createdAt: true },
          },
        },
      });

      for (const tracker of trackers) {
        const referenceAt =
          tracker.productionUpdates[0]?.createdAt ??
          tracker.events[0]?.createdAt ??
          tracker.createdAt;
        const cadence = deriveVendorCadence(
          referenceAt,
          tracker.kickoff.vendorUpdateCadenceDays,
        );
        // AMBER is "due soon" — visible on the board, not worth a phone buzz.
        if (cadence.status !== 'RED') continue;
        breached += 1;
        await this.pushEvents.plmVendorCadenceBreach({
          trackerId: tracker.id,
          ownerId: tracker.ownerId,
          vendorName:
            tracker.vendor?.companyName ??
            tracker.split.vendorName ??
            'the vendor',
          orderNumber: tracker.order.orderNumber,
          // Customer-facing override first, matching the PLM board's own label.
          productName:
            tracker.orderLine.customerFacingProductName ??
            tracker.orderLine.product?.name ??
            tracker.orderLine.adHocProductName ??
            'Unnamed product',
          cadenceDays: cadence.cadenceDays,
        });
      }
      if (breached > 0) {
        this.logger.log(
          `Vendor cadence sweep: ${breached} of ${trackers.length} in-production vendor tracker(s) overdue an update`,
        );
      }
    } catch (err) {
      // A cron that throws is an unhandled rejection with nobody to report to.
      // A missed reminder is not worth a noisy process.
      const detail = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Vendor cadence sweep skipped: ${detail}`);
    }
  }
}
