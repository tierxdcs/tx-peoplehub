import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DesignProjectStatus,
  OrderLineDeliveryType,
  NotificationType,
  PlmDesignReviewStatus,
  PlmEventType,
  PlmStage,
  PlmTrackerStatus,
  PingRecipientStatus,
  Prisma,
} from '@prisma/client';
import { deriveProductionProgress } from './plm-production-progress';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../core/database/prisma.service';
import { StockReportService } from '../bom/stock-report.service';
import {
  AssignPlmOwnerDto,
  LinkPlmProductionBoardDto,
  PlmTransitionDto,
  RejectPlmDesignReviewDto,
} from './dto/plm.dto';
import { PlmAccessService } from './plm-access.service';
import { KanbanNotificationsService } from '../notifications/kanban-notifications.service';
import { deriveVendorCadence } from './plm-vendor-cadence';
import { wholeDaysUntil } from '../../common/utils/date.util';
import {
  IN_HOUSE_FACILITY_LABEL,
  IN_HOUSE_NPD_LABEL,
  UNNAMED_VENDOR_LABEL,
} from '../../common/constants/in-house-facility';

const INITIAL_STAGE: Record<OrderLineDeliveryType, PlmStage> = {
  NPD: PlmStage.DESIGN,
  IN_HOUSE: PlmStage.RELEASE_TO_SCM,
  VENDOR: PlmStage.RELEASE_TO_SCM,
};

// Design-project stage ladder, mirrored from the Design module, used to compare
// a linked project's progress against the PLM design-gate thresholds. ON_HOLD
// and CLOSED are off-ladder: they never block advancement here — the tracker UI
// surfaces them instead.
const DESIGN_STAGE_LADDER: DesignProjectStatus[] = [
  'REQUIREMENTS',
  'CONCEPT',
  'DETAILED_DESIGN',
  'INTERNAL_REVIEW',
  'CUSTOMER_APPROVAL',
  'RELEASED_FOR_PRODUCTION',
];

/** Who is executing a line: the in-house facility, or a genuine external vendor. */
export type PlmFacilityKind = 'IN_HOUSE' | 'IN_HOUSE_NPD' | 'EXTERNAL_VENDOR';

/**
 * The "who is building this" attribution every PLM dashboard row carries, so no
 * consumer has to re-derive it from flowType + vendor + split name.
 *
 * An external vendor is named by its Vendor Master `companyName`, or — when the
 * split records only free text and no Vendor row — by that text. An IN_HOUSE
 * line always reads as the fixed in-house facility, from the same constant
 * Kickoff writes onto the split, so the label can never drift from the data.
 * NPD is engineering-led in-house work and gets its own kind: it is deliberately
 * NOT counted as in-house *manufacturing*.
 */
function facilityOf(tracker: {
  flowType: OrderLineDeliveryType;
  vendor: { id: string; companyName: string } | null;
  split: { quantity: Prisma.Decimal; vendorName: string | null };
}): {
  facilityKind: PlmFacilityKind;
  facilityLabel: string;
  facilityVendorId: string | null;
  splitQuantity: string;
} {
  const named = tracker.vendor?.companyName ?? tracker.split.vendorName;
  const attribution =
    tracker.flowType === OrderLineDeliveryType.IN_HOUSE
      ? {
          facilityKind: 'IN_HOUSE' as const,
          facilityLabel: IN_HOUSE_FACILITY_LABEL,
          facilityVendorId: null,
        }
      : tracker.flowType === OrderLineDeliveryType.NPD && !named
        ? {
            facilityKind: 'IN_HOUSE_NPD' as const,
            facilityLabel: IN_HOUSE_NPD_LABEL,
            facilityVendorId: null,
          }
        : {
            facilityKind: 'EXTERNAL_VENDOR' as const,
            facilityLabel: named ?? UNNAMED_VENDOR_LABEL,
            facilityVendorId: tracker.vendor?.id ?? null,
          };
  return { ...attribution, splitQuantity: tracker.split.quantity.toFixed(2) };
}

@Injectable()
export class PlmService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: PlmAccessService,
    private readonly stockReports: StockReportService,
    private readonly notifications: KanbanNotificationsService,
  ) {}

  /** Idempotently provision a tracker per classified delivery split after
   * kickoff completion. A line sourced from N vendors yields N trackers. */
  async provisionForKickoff(kickoffId: string): Promise<number> {
    const kickoff = await this.prisma.projectKickoff.findUnique({
      where: { id: kickoffId },
      include: {
        order: {
          include: { lineItems: { include: { deliverySplits: true } } },
        },
      },
    });
    if (!kickoff || kickoff.status !== 'COMPLETED') return 0;

    let created = 0;
    for (const line of kickoff.order.lineItems) {
      for (const split of line.deliverySplits) {
        if (!split.deliveryType) continue;
        const vendor = split.vendorId
          ? { id: split.vendorId }
          : split.vendorName
            ? await this.prisma.vendor.findFirst({
                where: {
                  companyName: {
                    equals: split.vendorName,
                    mode: 'insensitive',
                  },
                },
                select: { id: true },
              })
            : null;
        const result = await this.prisma.plmTracker.upsert({
          where: { splitId: split.id },
          // Backfill the vendor link onto an existing tracker: a split often
          // gets its approved Vendor Master assigned in Kickoff *after* the
          // tracker is provisioned, and vendor update links require it. Only
          // mirror when the split resolves to a vendor so we never wipe a link.
          update: vendor?.id ? { vendorId: vendor.id } : {},
          create: {
            splitId: split.id,
            orderLineId: line.id,
            orderId: kickoff.orderId,
            kickoffId: kickoff.id,
            flowType: split.deliveryType,
            currentStage: INITIAL_STAGE[split.deliveryType],
            ownerId: kickoff.order.ownerId,
            vendorId: vendor?.id ?? null,
            productionBoardId: kickoff.kanbanBoardId,
            events: {
              create: {
                type: PlmEventType.CREATED,
                toStage: INITIAL_STAGE[split.deliveryType],
                comment: 'Created automatically from completed Project Kickoff',
              },
            },
          },
          select: { createdAt: true, updatedAt: true },
        });
        if (result.createdAt.getTime() === result.updatedAt.getTime())
          created += 1;
      }
    }
    return created;
  }

  async listForOrder(orderId: string, user: AuthenticatedUser) {
    await this.access.assertCanViewOrder(user, orderId);
    const trackers = await this.prisma.plmTracker.findMany({
      where: { orderId },
      include: this.detailInclude(),
      orderBy: { createdAt: 'asc' },
    });
    return Promise.all(trackers.map((tracker) => this.withDerived(tracker)));
  }

  async get(id: string, user: AuthenticatedUser) {
    await this.access.assertCanViewTracker(user, id);
    const tracker = await this.getRaw(id);
    return this.withDerived(tracker);
  }

  async dashboardForUser(user: AuthenticatedUser) {
    const employee =
      user.role === 'SUPER_ADMIN'
        ? null
        : await this.prisma.employee.findUnique({
            where: { id: user.id },
            select: {
              isProductionHead: true,
              isInternalAuditor: true,
              isProjectManager: true,
            },
          });
    const privileged =
      user.role === 'SUPER_ADMIN' ||
      employee?.isProductionHead ||
      employee?.isInternalAuditor ||
      employee?.isProjectManager;
    return this.dashboardItems(
      privileged
        ? {}
        : {
            OR: [
              { ownerId: user.id },
              { order: { ownerId: user.id } },
              { kickoff: { attendees: { some: { employeeId: user.id } } } },
            ],
          },
      user.id,
    );
  }

  /**
   * Every active tracker in the company, for the Executive Operations dashboard.
   * Deliberately the SAME builder as the personal PLM workspace above — the
   * blocker reasons, health, delivery countdown and production counts are one
   * computation with a wider `where`, so the COO's rollup can never disagree
   * with what the owning team sees on /plm.
   *
   * Access is checked by ExecutiveAccessService at that controller, not here.
   */
  async dashboardCompanyWide(user: AuthenticatedUser) {
    return this.dashboardItems({}, user.id);
  }

  /**
   * @param scope  extra tracker filter (visibility); ACTIVE is always applied.
   * @param viewerId whose unresolved pings light up the row's ping flag.
   */
  private async dashboardItems(
    scope: Prisma.PlmTrackerWhereInput,
    viewerId: string,
  ) {
    const trackers = await this.prisma.plmTracker.findMany({
      where: { status: PlmTrackerStatus.ACTIVE, ...scope },
      include: this.detailInclude(),
      orderBy: { updatedAt: 'desc' },
    });
    const trackerIds = trackers.map((tracker) => tracker.id);
    const relevantPingRows = trackerIds.length
      ? await this.prisma.pingRecipient.findMany({
          where: {
            status: { not: PingRecipientStatus.RESOLVED },
            AND: [
              {
                ping: {
                  linkedRecordType: 'PLM_TRACKER',
                  linkedRecordId: { in: trackerIds },
                },
              },
              {
                OR: [
                  { employeeId: viewerId },
                  { ping: { fromEmployeeId: viewerId } },
                ],
              },
            ],
          },
          select: { ping: { select: { linkedRecordId: true } } },
        })
      : [];
    const trackerIdsWithPendingPings = new Set(
      relevantPingRows
        .map((row) => row.ping.linkedRecordId)
        .filter((id): id is string => Boolean(id)),
    );
    return Promise.all(
      trackers.map(async (tracker) => {
        const derived = await this.withDerived(tracker);
        const lastStageEvent = [...tracker.events]
          .reverse()
          .find((event) => event.toStage === tracker.currentStage);
        const stageSince = lastStageEvent?.createdAt ?? tracker.updatedAt;
        const ageDays = Math.max(
          0,
          Math.floor((Date.now() - stageSince.getTime()) / 86_400_000),
        );
        let blocker: string | null = null;
        if (
          tracker.currentStage === PlmStage.DRAWING_RELEASE &&
          !derived.derived.drawingReleased
        ) {
          blocker = 'Released BOM required';
        } else if (
          tracker.currentStage === PlmStage.MATERIAL_PLANNING &&
          tracker.kickoff.supplyInScope
        ) {
          const report = await this.stockReports.computeReport(
            tracker.kickoffId,
            tracker.orderLineId,
          );
          if (!report || report.bomSelections.length === 0) {
            blocker = 'Line-level stock report required';
          } else if (report.summary.shortage || report.summary.unknown) {
            blocker = 'Material shortage or unknown stock';
          }
        } else if (
          tracker.currentStage === PlmStage.QC &&
          !derived.derived.qcPassed
        ) {
          blocker = 'Passed QC inspection required';
        } else if (
          tracker.currentStage === PlmStage.DISPATCH &&
          !derived.derived.dispatched
        ) {
          blocker = 'Dispatched challan required';
        }
        if (!blocker && derived.derived.vendorCadence?.status === 'RED') {
          blocker = `Vendor update overdue (expected every ${derived.derived.vendorCadence.cadenceDays} day(s))`;
        }
        const cadenceAtRisk = derived.derived.vendorCadence?.status === 'AMBER';
        const promisedDeliveryDate =
          tracker.order.confirmationSheets[0]?.deliveryDate ?? null;
        const daysUntilDue = promisedDeliveryDate
          ? wholeDaysUntil(promisedDeliveryDate, new Date())
          : null;
        return {
          trackerId: tracker.id,
          orderId: tracker.orderId,
          orderNumber: tracker.order.orderNumber,
          customerName: tracker.order.customer?.name ?? null,
          // Customer-facing override first — PLM rows reference the order.
          productName:
            tracker.orderLine.customerFacingProductName ??
            tracker.orderLine.product?.name ??
            tracker.orderLine.adHocProductName ??
            'Unnamed product',
          productSku: tracker.orderLine.product?.sku ?? 'Ad-hoc',
          flowType: tracker.flowType,
          currentStage: tracker.currentStage,
          ownerName:
            `${tracker.owner.firstName} ${tracker.owner.lastName}`.trim(),
          ageDays,
          promisedDeliveryDate: promisedDeliveryDate?.toISOString() ?? null,
          daysUntilDue,
          blocker,
          health: blocker
            ? 'BLOCKED'
            : cadenceAtRisk || ageDays >= 7
              ? 'AT_RISK'
              : 'ON_TRACK',
          // Who is actually executing this line. Carried on every row so no
          // consumer has to re-derive it from flowType + vendor + split name.
          ...facilityOf(tracker),
          vendorCadenceStatus: derived.derived.vendorCadence?.status ?? null,
          // When the next self-report is due and when the last one arrived —
          // already derived above, surfaced so a consumer can say "quiet since
          // Tuesday" instead of only "overdue". Null whenever no cadence runs.
          vendorCadenceDueAt:
            derived.derived.vendorCadence?.dueAt.toISOString() ?? null,
          lastVendorUpdateAt:
            derived.derived.lastVendorUpdateAt?.toISOString() ?? null,
          production: derived.derived.production,
          hasPendingPing: trackerIdsWithPendingPings.has(tracker.id),
          updatedAt: tracker.updatedAt.toISOString(),
        };
      }),
    );
  }

  async confirmStage(
    id: string,
    dto: PlmTransitionDto,
    user: AuthenticatedUser,
  ) {
    const tracker = await this.getRaw(id);
    await this.access.assertCanOperate(user, tracker.ownerId);
    const from = tracker.currentStage;
    const to = await this.nextStage(tracker);

    const updated = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.plmTracker.update({
        where: { id },
        data: {
          currentStage: to,
          status:
            to === PlmStage.COMPLETED
              ? PlmTrackerStatus.COMPLETED
              : PlmTrackerStatus.ACTIVE,
        },
      });
      await tx.plmTrackerEvent.create({
        data: {
          trackerId: id,
          type: this.isDerivedStage(from)
            ? PlmEventType.DERIVED_SIGNAL_CONFIRMED
            : PlmEventType.STAGE_CONFIRMED,
          fromStage: from,
          toStage: to,
          actorId: user.id,
          comment: dto.comment?.trim() || null,
        },
      });
      return updated;
    });
    await this.notifications.notifyPlm({
      recipientId: tracker.ownerId,
      actorId: user.id,
      type: NotificationType.PLM_STAGE_ADVANCED,
      trackerId: tracker.id,
      message: `${tracker.order.orderNumber} · ${tracker.orderLine.customerFacingProductName ?? tracker.orderLine.product?.name ?? tracker.orderLine.adHocProductName ?? 'Unnamed product'} advanced to ${to.replaceAll('_', ' ')}`,
    });
    return updated;
  }

  async submitDesignReview(id: string, user: AuthenticatedUser) {
    const tracker = await this.getRaw(id);
    if (
      tracker.flowType !== 'NPD' ||
      tracker.currentStage !== PlmStage.DESIGN
    ) {
      throw new BadRequestException(
        'Only an NPD tracker in Design can be submitted',
      );
    }
    await this.access.assertCanCompleteDesign(user);
    await this.assertLinkedDesignProjectAtLeast(
      tracker,
      'DETAILED_DESIGN',
      'Design can be submitted for review',
    );
    const updated = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.plmTracker.update({
        where: { id },
        data: {
          currentStage: PlmStage.DESIGN_REVIEW,
          designReviewStatus: PlmDesignReviewStatus.PENDING,
          designSubmittedById: user.id,
          designSubmittedAt: new Date(),
          designReviewedById: null,
          designReviewedAt: null,
          designReviewComment: null,
        },
      });
      await tx.plmTrackerEvent.create({
        data: {
          trackerId: id,
          type: PlmEventType.DESIGN_REVIEW_SUBMITTED,
          fromStage: PlmStage.DESIGN,
          toStage: PlmStage.DESIGN_REVIEW,
          actorId: user.id,
        },
      });
      return updated;
    });
    const heads = await this.prisma.employee.findMany({
      where: {
        status: 'ACTIVE',
        OR: [{ isProductionHead: true }, { isProjectManager: true }],
      },
      select: { id: true },
    });
    await Promise.all(
      heads.map((head) =>
        this.notifications.notifyPlm({
          recipientId: head.id,
          actorId: user.id,
          type: NotificationType.PLM_DESIGN_REVIEW_REQUESTED,
          trackerId: tracker.id,
          message: `Design Review requested for ${tracker.order.orderNumber} · ${tracker.orderLine.customerFacingProductName ?? tracker.orderLine.product?.name ?? tracker.orderLine.adHocProductName ?? 'Unnamed product'}`,
        }),
      ),
    );
    return updated;
  }

  async approveDesignReview(id: string, user: AuthenticatedUser) {
    await this.access.assertProductionHead(user);
    const tracker = await this.getRaw(id);
    this.assertPendingReview(tracker);
    if (tracker.designSubmittedById === user.id) {
      throw new ForbiddenException('You cannot approve your own Design Review');
    }
    await this.assertLinkedDesignProjectAtLeast(
      tracker,
      'CUSTOMER_APPROVAL',
      'the Design Review can be approved',
    );
    const updated = await this.review(id, user, true, null);
    await this.notifyDesignDecision(tracker, user, 'approved');
    return updated;
  }

  async rejectDesignReview(
    id: string,
    dto: RejectPlmDesignReviewDto,
    user: AuthenticatedUser,
  ) {
    await this.access.assertProductionHead(user);
    const tracker = await this.getRaw(id);
    this.assertPendingReview(tracker);
    if (tracker.designSubmittedById === user.id) {
      throw new ForbiddenException('You cannot review your own Design Review');
    }
    const updated = await this.review(id, user, false, dto.comment.trim());
    await this.notifyDesignDecision(tracker, user, 'rejected');
    return updated;
  }

  async linkProductionBoard(
    id: string,
    dto: LinkPlmProductionBoardDto,
    user: AuthenticatedUser,
  ) {
    const tracker = await this.getRaw(id);
    await this.access.assertCanOperate(user, tracker.ownerId);
    const board = await this.prisma.kanbanBoard.findUnique({
      where: { id: dto.boardId },
      select: { id: true },
    });
    if (!board) throw new NotFoundException('Kanban board not found');
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.plmTracker.update({
        where: { id },
        data: { productionBoardId: dto.boardId },
      });
      await tx.plmTrackerEvent.create({
        data: {
          trackerId: id,
          type: PlmEventType.PRODUCTION_BOARD_LINKED,
          actorId: user.id,
          metadata: { boardId: dto.boardId },
        },
      });
      return updated;
    });
  }

  async assignOwner(
    id: string,
    dto: AssignPlmOwnerDto,
    user: AuthenticatedUser,
  ) {
    await this.access.assertProductionHead(user);
    await this.getRaw(id);
    const owner = await this.prisma.employee.findUnique({
      where: { id: dto.ownerId },
      select: { id: true, status: true },
    });
    if (!owner || owner.status !== 'ACTIVE') {
      throw new BadRequestException('PLM owner must be an active employee');
    }
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.plmTracker.update({
        where: { id },
        data: { ownerId: owner.id },
      });
      await tx.plmTrackerEvent.create({
        data: {
          trackerId: id,
          type: PlmEventType.OWNER_CHANGED,
          actorId: user.id,
          metadata: { ownerId: owner.id },
        },
      });
      return updated;
    });
  }

  private async nextStage(tracker: Awaited<ReturnType<PlmService['getRaw']>>) {
    switch (tracker.currentStage) {
      case PlmStage.DESIGN:
        throw new BadRequestException('Submit Design for review instead');
      case PlmStage.DESIGN_REVIEW:
        throw new BadRequestException(
          'Design Review requires Production Head approval',
        );
      case PlmStage.DRAWING_RELEASE:
        if (
          tracker.orderLine.product &&
          !tracker.orderLine.product.item?.boms.length
        ) {
          throw new BadRequestException(
            'Drawing Release is not satisfied: the line item has no RELEASED BOM',
          );
        }
        return PlmStage.RELEASE_TO_SCM;
      case PlmStage.RELEASE_TO_SCM:
        return PlmStage.MATERIAL_PLANNING;
      case PlmStage.MATERIAL_PLANNING: {
        // An unresolved internal-order prototype has no catalog Item/BOM yet.
        // Its PLM work may proceed; formal Product resolution is enforced only
        // when the internal order is promoted to a customer order.
        if (!tracker.orderLine.product) return PlmStage.PRODUCTION;
        // Material supply is out of scope for this project (e.g. a vendor is
        // supplying the finished item under a turnkey arrangement) — the
        // Kickoff Stock Availability Report never runs, so there is nothing
        // for this gate to check. Fall back to simple manual confirmation
        // rather than permanently blocking the tracker.
        if (!tracker.kickoff.supplyInScope) {
          return PlmStage.PRODUCTION;
        }
        const report = await this.stockReports.computeReport(
          tracker.kickoffId,
          tracker.orderLineId,
        );
        if (!report) {
          throw new BadRequestException(
            'Generate the Kickoff Stock Availability Report before completing Material Planning',
          );
        }
        if (report.bomSelections.length === 0) {
          throw new BadRequestException(
            'Material Planning cannot complete because this order line is not included in the Kickoff Stock Availability Report',
          );
        }
        if (report.summary.shortage > 0 || report.summary.unknown > 0) {
          throw new BadRequestException(
            'Material Planning cannot complete while the Kickoff Stock Availability Report has unresolved shortages or unknown stock',
          );
        }
        return PlmStage.PRODUCTION;
      }
      case PlmStage.PRODUCTION:
        return PlmStage.QC;
      case PlmStage.QC:
        if (
          !tracker.orderLine.qmsInspections.some((inspection) =>
            ['PASSED', 'CONDITIONAL_PASS'].includes(inspection.status),
          )
        ) {
          throw new BadRequestException(
            'QC is not satisfied: no passed inspection is linked to this order line',
          );
        }
        return PlmStage.DISPATCH;
      case PlmStage.DISPATCH:
        if (
          !tracker.orderLine.deliveryChallanLines.some((line) =>
            ['DISPATCHED', 'IN_TRANSIT', 'DELIVERED'].includes(
              line.deliveryChallan.status,
            ),
          )
        ) {
          throw new BadRequestException(
            'Dispatch is not satisfied: no dispatched challan line exists',
          );
        }
        return PlmStage.COMPLETED;
      default:
        throw new BadRequestException('This PLM tracker is already completed');
    }
  }

  private async review(
    id: string,
    user: AuthenticatedUser,
    approved: boolean,
    comment: string | null,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.plmTracker.update({
        where: { id },
        data: {
          currentStage: approved ? PlmStage.DRAWING_RELEASE : PlmStage.DESIGN,
          designReviewStatus: approved
            ? PlmDesignReviewStatus.APPROVED
            : PlmDesignReviewStatus.REJECTED,
          designReviewedById: user.id,
          designReviewedAt: new Date(),
          designReviewComment: comment,
        },
      });
      await tx.plmTrackerEvent.create({
        data: {
          trackerId: id,
          type: approved
            ? PlmEventType.DESIGN_REVIEW_APPROVED
            : PlmEventType.DESIGN_REVIEW_REJECTED,
          fromStage: PlmStage.DESIGN_REVIEW,
          toStage: approved ? PlmStage.DRAWING_RELEASE : PlmStage.DESIGN,
          actorId: user.id,
          comment,
        },
      });
      return updated;
    });
  }

  private async notifyDesignDecision(
    tracker: Awaited<ReturnType<PlmService['getRaw']>>,
    user: AuthenticatedUser,
    decision: 'approved' | 'rejected',
  ) {
    const recipients = new Set(
      [tracker.designSubmittedById, tracker.ownerId].filter(
        (id): id is string => !!id,
      ),
    );
    await Promise.all(
      [...recipients].map((recipientId) =>
        this.notifications.notifyPlm({
          recipientId,
          actorId: user.id,
          type: NotificationType.PLM_DESIGN_REVIEW_DECIDED,
          trackerId: tracker.id,
          message: `Design Review ${decision} for ${tracker.order.orderNumber} · ${tracker.orderLine.customerFacingProductName ?? tracker.orderLine.product?.name ?? tracker.orderLine.adHocProductName ?? 'Unnamed product'}`,
        }),
      ),
    );
  }

  /** The DesignProject behind a tracker, matched on (orderId, productId). Null
   * when the order line has no catalog product or no design project links back
   * to this order/product pair. Most recently updated wins if several match. */
  private async linkedDesignProject(tracker: {
    orderId: string;
    orderLine: { productId: string | null };
  }) {
    if (!tracker.orderLine.productId) return null;
    return this.prisma.designProject.findFirst({
      where: {
        orderId: tracker.orderId,
        productId: tracker.orderLine.productId,
      },
      orderBy: { updatedAt: 'desc' },
      select: { id: true, projectNumber: true, name: true, status: true },
    });
  }

  /** Additional design-engineering gate on top of the existing Production Head
   * approval: blocks when the linked DesignProject is on the stage ladder but
   * hasn't reached `threshold`. No linked project, or an off-ladder status
   * (ON_HOLD / CLOSED), never blocks — the tracker UI surfaces those states
   * instead of silently gating on them. */
  private async assertLinkedDesignProjectAtLeast(
    tracker: { orderId: string; orderLine: { productId: string | null } },
    threshold: DesignProjectStatus,
    action: string,
  ) {
    const project = await this.linkedDesignProject(tracker);
    if (!project) return;
    const current = DESIGN_STAGE_LADDER.indexOf(project.status);
    if (current === -1) return;
    if (current < DESIGN_STAGE_LADDER.indexOf(threshold)) {
      throw new BadRequestException(
        `Design project ${project.projectNumber} is at ${project.status.replaceAll('_', ' ')}; it must reach at least ${threshold.replaceAll('_', ' ')} before ${action}`,
      );
    }
  }

  private assertPendingReview(tracker: {
    currentStage: PlmStage;
    designReviewStatus: PlmDesignReviewStatus;
  }) {
    if (
      tracker.currentStage !== PlmStage.DESIGN_REVIEW ||
      tracker.designReviewStatus !== PlmDesignReviewStatus.PENDING
    ) {
      throw new BadRequestException('This Design Review is not pending');
    }
  }

  private isDerivedStage(stage: PlmStage) {
    return (
      stage === PlmStage.DRAWING_RELEASE ||
      stage === PlmStage.QC ||
      stage === PlmStage.DISPATCH
    );
  }

  private detailInclude() {
    return {
      owner: { select: { id: true, firstName: true, lastName: true } },
      // contactEmail so the vendor-update-link UI can say who the email will go
      // to (and disable the button when there is nobody on file) without a
      // second round-trip to the Vendor Master.
      vendor: {
        select: { id: true, companyName: true, contactEmail: true },
      },
      // The portion of the order line this tracker covers, plus the vendor name
      // captured at classification — the fallback when no Vendor row is linked.
      split: { select: { quantity: true, vendorName: true } },
      order: {
        select: {
          id: true,
          orderNumber: true,
          ownerId: true,
          customer: { select: { name: true } },
          confirmationSheets: {
            where: { status: 'EXECUTED' as const },
            orderBy: { revisionNumber: 'desc' as const },
            take: 1,
            select: { deliveryDate: true },
          },
        },
      },
      kickoff: {
        select: {
          supplyInScope: true,
          vendorUpdateCadenceDays: true,
        },
      },
      events: {
        include: { actor: { select: { firstName: true, lastName: true } } },
        orderBy: { createdAt: 'asc' as const },
      },
      productionUpdates: {
        include: { photos: true },
        orderBy: { createdAt: 'desc' as const },
      },
      orderLine: {
        include: {
          product: {
            include: {
              item: {
                include: {
                  boms: {
                    where: { status: 'RELEASED' as const },
                    select: { id: true },
                  },
                },
              },
            },
          },
          qmsInspections: { select: { id: true, status: true } },
          deliveryChallanLines: {
            include: { deliveryChallan: { select: { status: true } } },
          },
        },
      },
      productionCards: {
        where: { status: 'ACTIVE' as const },
        select: { id: true, list: { select: { isDoneList: true } } },
      },
    } satisfies Prisma.PlmTrackerInclude;
  }

  private async getRaw(id: string) {
    const tracker = await this.prisma.plmTracker.findUnique({
      where: { id },
      include: this.detailInclude(),
    });
    if (!tracker) throw new NotFoundException('PLM tracker not found');
    return tracker;
  }

  private async withDerived(
    tracker: Awaited<ReturnType<PlmService['getRaw']>>,
  ) {
    const production = deriveProductionProgress(tracker.productionCards);
    const latestVendorUpdateAt =
      tracker.flowType === OrderLineDeliveryType.VENDOR
        ? (tracker.productionUpdates[0]?.createdAt ?? null)
        : null;
    const productionStartedAt = [...tracker.events]
      .reverse()
      .find((event) => event.toStage === PlmStage.PRODUCTION)?.createdAt;
    const vendorCadence =
      tracker.flowType === OrderLineDeliveryType.VENDOR &&
      tracker.status === PlmTrackerStatus.ACTIVE &&
      tracker.currentStage === PlmStage.PRODUCTION
        ? {
            ...deriveVendorCadence(
              latestVendorUpdateAt ?? productionStartedAt ?? tracker.createdAt,
              tracker.kickoff.vendorUpdateCadenceDays,
            ),
            lastVendorUpdateAt: latestVendorUpdateAt,
          }
        : null;
    // Only NPD trackers pass through DESIGN/DESIGN_REVIEW, so only they carry
    // the linked design-project state (null on an NPD tracker = "not linked").
    const designProject =
      tracker.flowType === OrderLineDeliveryType.NPD
        ? await this.linkedDesignProject(tracker)
        : null;
    return {
      ...tracker,
      derived: {
        designProject,
        drawingReleased:
          !tracker.orderLine.product ||
          !!tracker.orderLine.product.item?.boms.length,
        qcPassed: tracker.orderLine.qmsInspections.some((inspection) =>
          ['PASSED', 'CONDITIONAL_PASS'].includes(inspection.status),
        ),
        dispatched: tracker.orderLine.deliveryChallanLines.some((line) =>
          ['DISPATCHED', 'IN_TRANSIT', 'DELIVERED'].includes(
            line.deliveryChallan.status,
          ),
        ),
        production: { done: production.done, total: production.total },
        lastVendorUpdateAt: latestVendorUpdateAt,
        vendorCadence,
      },
    };
  }
}
