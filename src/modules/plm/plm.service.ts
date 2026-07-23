import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  OrderLineDeliveryType,
  NotificationType,
  PlmDesignReviewStatus,
  PlmEventType,
  PlmStage,
  PlmTrackerStatus,
  Prisma,
} from '@prisma/client';
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

const INITIAL_STAGE: Record<OrderLineDeliveryType, PlmStage> = {
  NPD: PlmStage.DESIGN,
  IN_HOUSE: PlmStage.RELEASE_TO_SCM,
  VENDOR: PlmStage.RELEASE_TO_SCM,
};

@Injectable()
export class PlmService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: PlmAccessService,
    private readonly stockReports: StockReportService,
    private readonly notifications: KanbanNotificationsService,
  ) {}

  /** Idempotently provision every classified line after kickoff completion. */
  async provisionForKickoff(kickoffId: string): Promise<number> {
    const kickoff = await this.prisma.projectKickoff.findUnique({
      where: { id: kickoffId },
      include: {
        order: { include: { lineItems: true } },
      },
    });
    if (!kickoff || kickoff.status !== 'COMPLETED') return 0;

    let created = 0;
    for (const line of kickoff.order.lineItems) {
      if (!line.deliveryType) continue;
      const vendor = line.vendorId
        ? { id: line.vendorId }
        : line.vendorName
          ? await this.prisma.vendor.findFirst({
              where: {
                companyName: { equals: line.vendorName, mode: 'insensitive' },
              },
              select: { id: true },
            })
          : null;
      const result = await this.prisma.plmTracker.upsert({
        where: { orderLineId: line.id },
        update: {},
        create: {
          orderLineId: line.id,
          orderId: kickoff.orderId,
          kickoffId: kickoff.id,
          flowType: line.deliveryType,
          currentStage: INITIAL_STAGE[line.deliveryType],
          ownerId: kickoff.order.ownerId,
          vendorId: vendor?.id ?? null,
          productionBoardId: kickoff.kanbanBoardId,
          events: {
            create: {
              type: PlmEventType.CREATED,
              toStage: INITIAL_STAGE[line.deliveryType],
              comment: 'Created automatically from completed Project Kickoff',
            },
          },
        },
        select: { createdAt: true, updatedAt: true },
      });
      if (result.createdAt.getTime() === result.updatedAt.getTime())
        created += 1;
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
            select: { isProductionHead: true, isInternalAuditor: true },
          });
    const privileged =
      user.role === 'SUPER_ADMIN' ||
      employee?.isProductionHead ||
      employee?.isInternalAuditor;
    const trackers = await this.prisma.plmTracker.findMany({
      where: {
        status: PlmTrackerStatus.ACTIVE,
        ...(privileged
          ? {}
          : {
              OR: [
                { ownerId: user.id },
                { order: { ownerId: user.id } },
                { kickoff: { attendees: { some: { employeeId: user.id } } } },
              ],
            }),
      },
      include: this.detailInclude(),
      orderBy: { updatedAt: 'desc' },
      take: 20,
    });
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
        } else if (tracker.currentStage === PlmStage.MATERIAL_PLANNING) {
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
        return {
          trackerId: tracker.id,
          orderId: tracker.orderId,
          orderNumber: tracker.order.orderNumber,
          productName: tracker.orderLine.product.name,
          productSku: tracker.orderLine.product.sku,
          flowType: tracker.flowType,
          currentStage: tracker.currentStage,
          ownerName: `${tracker.owner.firstName} ${tracker.owner.lastName}`.trim(),
          ageDays,
          blocker,
          health: blocker ? 'BLOCKED' : ageDays >= 7 ? 'AT_RISK' : 'ON_TRACK',
          production: derived.derived.production,
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
      message: `${tracker.order.orderNumber} · ${tracker.orderLine.product.name} advanced to ${to.replaceAll('_', ' ')}`,
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
      where: { status: 'ACTIVE', isProductionHead: true },
      select: { id: true },
    });
    await Promise.all(
      heads.map((head) =>
        this.notifications.notifyPlm({
          recipientId: head.id,
          actorId: user.id,
          type: NotificationType.PLM_DESIGN_REVIEW_REQUESTED,
          trackerId: tracker.id,
          message: `Design Review requested for ${tracker.order.orderNumber} · ${tracker.orderLine.product.name}`,
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
        if (!tracker.orderLine.product.item?.boms.length) {
          throw new BadRequestException(
            'Drawing Release is not satisfied: the line item has no RELEASED BOM',
          );
        }
        return PlmStage.RELEASE_TO_SCM;
      case PlmStage.RELEASE_TO_SCM:
        return PlmStage.MATERIAL_PLANNING;
      case PlmStage.MATERIAL_PLANNING: {
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
          message: `Design Review ${decision} for ${tracker.order.orderNumber} · ${tracker.orderLine.product.name}`,
        }),
      ),
    );
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
      vendor: { select: { id: true, companyName: true } },
      order: { select: { id: true, orderNumber: true, ownerId: true } },
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
    const productionTotal = tracker.productionCards.length;
    const productionDone = tracker.productionCards.filter(
      (card) => card.list.isDoneList,
    ).length;
    return {
      ...tracker,
      derived: {
        drawingReleased: !!tracker.orderLine.product.item?.boms.length,
        qcPassed: tracker.orderLine.qmsInspections.some((inspection) =>
          ['PASSED', 'CONDITIONAL_PASS'].includes(inspection.status),
        ),
        dispatched: tracker.orderLine.deliveryChallanLines.some((line) =>
          ['DISPATCHED', 'IN_TRANSIT', 'DELIVERED'].includes(
            line.deliveryChallan.status,
          ),
        ),
        production: { done: productionDone, total: productionTotal },
      },
    };
  }
}
