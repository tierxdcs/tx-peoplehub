import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  KanbanCardStatus,
  OrderLineDeliveryType,
  OrderType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { ConfirmationSheetsService } from '../sales/confirmation-sheets.service';
import { KanbanBoardsService } from '../kanban/kanban-boards.service';
import { PlmService } from '../plm/plm.service';
import { ProjectKickoffAccessService } from './project-kickoff-access.service';
import {
  CreateActionItemDto,
  CreateAttendeeDto,
  CreateKickoffDto,
  CreateMilestoneDto,
  CreateRiskDto,
  UpdateActionItemDto,
  UpdateKickoffDto,
  UpdateMilestoneDto,
  UpdateRiskDto,
} from './dto/project-kickoff.dto';
import {
  ActionItemComputedStatus,
  KickoffActionItemEntity,
  KickoffAttendeeEntity,
  KickoffConfirmationSheetEntity,
  KickoffDeliveryItemEntity,
  KickoffDeliverySplitEntity,
  KickoffMilestoneEntity,
  KickoffMilestoneTemplateEntity,
  KickoffRiskEntity,
  ProjectKickoffEntity,
} from './entities/project-kickoff.entity';
import {
  DeliverySplitInputDto,
  UpdateDeliveryItemDto,
} from './dto/project-kickoff.dto';
import {
  deriveProjectProgress,
  type ProjectProgressView,
} from './project-progress';
import { deriveVendorCadence } from '../plm/plm-vendor-cadence';

/** Employee shape needed to render an owner/attendee name. */
type EmployeeName = { firstName: string; lastName: string } | null;
function fullName(e: EmployeeName): string | null {
  return e ? `${e.firstName} ${e.lastName}` : null;
}

/**
 * IN_HOUSE work always goes to this fixed manufacturing partner. Hardcoded for
 * now (per business confirmation) — kept as one named constant so it's trivial
 * to relocate to company-config if it ever needs to be configurable.
 */
const IN_HOUSE_VENDOR_NAME = 'Balaji MetalTech, Bengaluru';

@Injectable()
export class ProjectKickoffService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectKickoffAccessService,
    private readonly confirmationSheets: ConfirmationSheetsService,
    private readonly boards: KanbanBoardsService,
    private readonly plm: PlmService,
  ) {}

  // ── Create ───────────────────────────────────────────────────────────
  /**
   * Create a kickoff for an Order whose latest Confirmation Sheet is EXECUTED
   * (reusing ConfirmationSheetsService.latestIsExecutedFor — the identical gate
   * as the Order's CONFIRMED→IN_PRODUCTION transition). Side effect: provisions
   * a project Kanban board (3 default lists + membership) via the privileged
   * internal path, so the PM doesn't need Scrum Master rights.
   */
  async create(
    dto: CreateKickoffDto,
    user: AuthenticatedUser,
  ): Promise<ProjectKickoffEntity> {
    await this.access.assertCanCreate(user);

    const order = await this.prisma.order.findUnique({
      where: { id: dto.orderId },
      include: {
        bid: true,
        customer: { select: { name: true } },
        lineItems: { select: { deliveryType: true } },
      },
    });
    if (!order) {
      throw new NotFoundException('Order not found');
    }

    // Internal orders have no bid/OCS, so the executed-Confirmation-Sheet gate
    // doesn't apply to them — they may kick off straight away. Customer orders
    // are unchanged: still require the latest OCS to be EXECUTED.
    if (order.orderType !== OrderType.INTERNAL) {
      const executed = await this.confirmationSheets.latestIsExecutedFor(
        dto.orderId,
      );
      if (!executed) {
        throw new BadRequestException(
          'A project kickoff can only be created once the order’s Confirmation Sheet is executed (internal orders are exempt)',
        );
      }
    }

    const projectName =
      dto.projectName?.trim() ||
      `${order.customer?.name ?? 'Internal'} — ${order.orderNumber}`;
    const overview =
      dto.overviewAndScope ??
      order.bid?.quotationSubject ??
      order.bid?.technicalSpecification ??
      null;
    // Material supply is out of scope only when every classified line is
    // VENDOR — a mix of NPD/IN_HOUSE lines (or no lines classified yet) keeps
    // it in scope by default. Purely a convenience default; always overridable
    // afterwards via update().
    const supplyInScope = !(
      order.lineItems.length > 0 &&
      order.lineItems.every((li) => li.deliveryType === 'VENDOR')
    );

    // Privileged board provisioning (creator is the sole initial member; more
    // members join as internal attendees are added).
    const { boardId } = await this.boards.provisionProjectBoard({
      name: projectName,
      createdById: user.id,
      memberEmployeeIds: [],
    });

    const kickoff = await this.prisma.projectKickoff.create({
      data: {
        orderId: dto.orderId,
        projectName,
        meetingDate: new Date(dto.meetingDate),
        meetingMode: dto.meetingMode ?? undefined,
        meetingLocation: dto.meetingLocation ?? null,
        overviewAndScope: overview,
        minutesNotes: dto.minutesNotes ?? null,
        supplyInScope,
        vendorUpdateCadenceDays: dto.vendorUpdateCadenceDays ?? 1,
        kanbanBoardId: boardId,
        createdById: user.id,
      },
    });
    return this.findOne(kickoff.id, user);
  }

  /**
   * Orders a Project Manager may start a kickoff for — the PM picks from these
   * on the Project Kickoff landing page, since they may have no Sales access to
   * browse orders directly. Eligible = latest Confirmation Sheet EXECUTED AND
   * no kickoff exists yet. PM/SUPER_ADMIN only.
   */
  async eligibleOrders(
    user: AuthenticatedUser,
  ): Promise<
    { id: string; orderNumber: string; customerName: string | null }[]
  > {
    await this.access.assertCanCreate(user);

    // Orders that don't already have a kickoff.
    const orders = await this.prisma.order.findMany({
      where: { projectKickoffs: { none: {} } },
      select: {
        id: true,
        orderNumber: true,
        orderType: true,
        customer: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Keep internal orders (exempt from the OCS gate) plus any customer order
    // whose latest confirmation sheet is EXECUTED (the same gate create()
    // enforces). Checked per-order to reuse the one source of truth.
    const eligible = await Promise.all(
      orders.map(async (o) => ({
        order: o,
        ok:
          o.orderType === OrderType.INTERNAL ||
          (await this.confirmationSheets.latestIsExecutedFor(o.id)),
      })),
    );
    return eligible
      .filter((e) => e.ok)
      .map((e) => ({
        id: e.order.id,
        orderNumber: e.order.orderNumber,
        customerName: e.order.customer?.name ?? null,
      }));
  }

  // ── Read ─────────────────────────────────────────────────────────────
  async findAll(user: AuthenticatedUser): Promise<ProjectKickoffEntity[]> {
    // Visible kickoffs: created by me, or I'm an internal attendee — or all for
    // SUPER_ADMIN. Filtered in the query so we never over-fetch.
    const where: Prisma.ProjectKickoffWhereInput = this.access.isSuperAdmin(
      user,
    )
      ? {}
      : {
          OR: [
            { createdById: user.id },
            { attendees: { some: { employeeId: user.id } } },
          ],
        };
    const rows = await this.prisma.projectKickoff.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: this.fullInclude(),
    });
    return Promise.all(rows.map((r) => this.toEntity(r)));
  }

  /**
   * Lightweight dashboard projection for projects the caller participates in.
   * Visibility exactly matches kickoff access: creator, internal attendee, or
   * SUPER_ADMIN. Stage lamps are derived from source records, never edited.
   */
  async progressForUser(
    user: AuthenticatedUser,
  ): Promise<ProjectProgressView[]> {
    const where: Prisma.ProjectKickoffWhereInput = this.access.isSuperAdmin(
      user,
    )
      ? {}
      : {
          OR: [
            { createdById: user.id },
            { attendees: { some: { employeeId: user.id } } },
          ],
        };
    const kickoffs = await this.prisma.projectKickoff.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        projectName: true,
        status: true,
        meetingDate: true,
        vendorUpdateCadenceDays: true,
        updatedAt: true,
        orderId: true,
        order: {
          select: {
            id: true,
            orderNumber: true,
            status: true,
            finalQcStatus: true,
            fulfilmentStatus: true,
            updatedAt: true,
            deliveryChallans: {
              select: { status: true, updatedAt: true },
              where: { status: { not: 'CANCELLED' } },
            },
          },
        },
        milestones: {
          select: { status: true, targetDate: true, updatedAt: true },
        },
        actionItems: {
          select: {
            dueDate: true,
            updatedAt: true,
            kanbanCard: {
              select: {
                status: true,
                list: { select: { isDoneList: true } },
              },
            },
          },
        },
        risks: {
          select: {
            status: true,
            likelihood: true,
            impact: true,
            updatedAt: true,
          },
        },
        rfqs: { select: { status: true, updatedAt: true } },
        plmTrackers: {
          select: {
            createdAt: true,
            updatedAt: true,
            flowType: true,
            status: true,
            currentStage: true,
            events: {
              where: { toStage: 'PRODUCTION' },
              select: { createdAt: true },
              orderBy: { createdAt: 'desc' },
              take: 1,
            },
            productionUpdates: {
              select: { createdAt: true },
              orderBy: { createdAt: 'desc' },
              take: 1,
            },
          },
        },
      },
    });
    if (!kickoffs.length) return [];

    const kickoffIds = kickoffs.map((kickoff) => kickoff.id);
    const orderIds = kickoffs.map((kickoff) => kickoff.orderId);
    const [designProjects, inspections] = await Promise.all([
      this.prisma.designProject.findMany({
        where: { projectKickoffId: { in: kickoffIds } },
        select: {
          id: true,
          projectKickoffId: true,
          status: true,
          updatedAt: true,
        },
        orderBy: { updatedAt: 'desc' },
      }),
      this.prisma.qmsInspection.findMany({
        where: {
          OR: [
            { projectKickoffId: { in: kickoffIds } },
            { orderId: { in: orderIds } },
          ],
          status: { not: 'CANCELLED' },
        },
        select: {
          projectKickoffId: true,
          orderId: true,
          status: true,
          updatedAt: true,
        },
      }),
    ]);
    const now = Date.now();

    return kickoffs.map((kickoff) => {
      const designProject = designProjects.find(
        (project) => project.projectKickoffId === kickoff.id,
      );
      const relatedInspections = inspections.filter(
        (inspection) =>
          inspection.projectKickoffId === kickoff.id ||
          inspection.orderId === kickoff.orderId,
      );
      const timestamps = [
        kickoff.updatedAt,
        kickoff.order.updatedAt,
        ...kickoff.milestones.map((item) => item.updatedAt),
        ...kickoff.actionItems.map((item) => item.updatedAt),
        ...kickoff.risks.map((item) => item.updatedAt),
        ...kickoff.rfqs.map((item) => item.updatedAt),
        ...kickoff.plmTrackers.map((item) => item.updatedAt),
        ...kickoff.order.deliveryChallans.map((item) => item.updatedAt),
        ...relatedInspections.map((item) => item.updatedAt),
        ...(designProject ? [designProject.updatedAt] : []),
      ];
      const updatedAt = new Date(
        Math.max(...timestamps.map((value) => value.getTime())),
      );
      const vendorCadenceStatuses = kickoff.plmTrackers
        .filter(
          (tracker) =>
            tracker.flowType === 'VENDOR' &&
            tracker.status === 'ACTIVE' &&
            tracker.currentStage === 'PRODUCTION',
        )
        .map((tracker) =>
          deriveVendorCadence(
            tracker.productionUpdates[0]?.createdAt ??
              tracker.events[0]?.createdAt ??
              tracker.createdAt,
            kickoff.vendorUpdateCadenceDays,
            new Date(now),
          ),
        );

      return deriveProjectProgress({
        kickoffId: kickoff.id,
        projectName: kickoff.projectName,
        kickoffStatus: kickoff.status,
        meetingDate: kickoff.meetingDate,
        updatedAt,
        order: kickoff.order,
        designProject: designProject
          ? { id: designProject.id, status: designProject.status }
          : null,
        rfqStatuses: kickoff.rfqs.map((rfq) => rfq.status),
        inspectionStatuses: relatedInspections.map(
          (inspection) => inspection.status,
        ),
        dispatchStatuses: kickoff.order.deliveryChallans.map(
          (challan) => challan.status,
        ),
        plmStages: kickoff.plmTrackers.map(
          (tracker) => tracker.currentStage,
        ),
        overdueMilestones: kickoff.milestones.filter(
          (milestone) =>
            milestone.status !== 'COMPLETED' &&
            (milestone.status === 'DELAYED' ||
              milestone.targetDate.getTime() < now),
        ).length,
        overdueActions: kickoff.actionItems.filter(
          (action) =>
            !!action.dueDate &&
            action.dueDate.getTime() < now &&
            action.kanbanCard?.status === KanbanCardStatus.ACTIVE &&
            !action.kanbanCard.list.isDoneList,
        ).length,
        openHighRisks: kickoff.risks.filter(
          (risk) =>
            risk.status === 'OPEN' &&
            (risk.impact === 'HIGH' || risk.likelihood === 'HIGH'),
        ).length,
        overdueVendorUpdates: vendorCadenceStatuses.filter(
          (cadence) => cadence.status === 'RED',
        ).length,
        approachingVendorUpdates: vendorCadenceStatuses.filter(
          (cadence) => cadence.status === 'AMBER',
        ).length,
        nextDueDate:
          kickoff.milestones
            .filter((milestone) => milestone.status !== 'COMPLETED')
            .sort(
              (left, right) =>
                left.targetDate.getTime() - right.targetDate.getTime(),
            )[0]?.targetDate ?? null,
      });
    });
  }

  async findOne(
    id: string,
    user: AuthenticatedUser,
  ): Promise<ProjectKickoffEntity> {
    await this.access.assertCanAccess(user, id);
    const row = await this.prisma.projectKickoff.findUniqueOrThrow({
      where: { id },
      include: this.fullInclude(),
    });
    return this.toEntity(row);
  }

  /**
   * The linked Order's current EXECUTED confirmation sheet + a presigned
   * download URL for its signed copy, for in-meeting reference on the kickoff
   * page. Access is the same as viewing the kickoff itself. Returns null if the
   * order's latest sheet is not (or no longer) EXECUTED — the page then shows
   * the true current state rather than a stale document.
   */
  async getConfirmationSheet(
    id: string,
    user: AuthenticatedUser,
  ): Promise<KickoffConfirmationSheetEntity | null> {
    await this.access.assertCanAccess(user, id);
    const kickoff = await this.prisma.projectKickoff.findUniqueOrThrow({
      where: { id },
      select: { orderId: true },
    });
    const sheet = await this.confirmationSheets.getExecutedSheetForOrder(
      kickoff.orderId,
    );
    if (!sheet) return null;
    return new KickoffConfirmationSheetEntity({
      id: sheet.id,
      confirmationNumber: sheet.confirmationNumber,
      revisionNumber: sheet.revisionNumber,
      executedAt: sheet.executedAt ? sheet.executedAt.toISOString() : null,
      hasSignedCopy: sheet.hasSignedCopy,
      downloadUrl: sheet.downloadUrl,
      expiresInSeconds: sheet.expiresInSeconds,
    });
  }

  async update(
    id: string,
    dto: UpdateKickoffDto,
    user: AuthenticatedUser,
  ): Promise<ProjectKickoffEntity> {
    await this.access.assertCanManage(user, id);
    await this.prisma.projectKickoff.update({
      where: { id },
      data: {
        ...(dto.projectName !== undefined
          ? { projectName: dto.projectName }
          : {}),
        ...(dto.meetingDate !== undefined
          ? { meetingDate: new Date(dto.meetingDate) }
          : {}),
        ...(dto.meetingMode !== undefined
          ? { meetingMode: dto.meetingMode }
          : {}),
        ...(dto.meetingLocation !== undefined
          ? { meetingLocation: dto.meetingLocation }
          : {}),
        ...(dto.overviewAndScope !== undefined
          ? { overviewAndScope: dto.overviewAndScope }
          : {}),
        ...(dto.minutesNotes !== undefined
          ? { minutesNotes: dto.minutesNotes }
          : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
        ...(dto.supplyInScope !== undefined
          ? { supplyInScope: dto.supplyInScope }
          : {}),
        ...(dto.vendorUpdateCadenceDays !== undefined
          ? { vendorUpdateCadenceDays: dto.vendorUpdateCadenceDays }
          : {}),
      },
    });
    if (dto.status === 'COMPLETED') {
      await this.plm.provisionForKickoff(id);
    }
    return this.findOne(id, user);
  }

  // ── Attendees ──────────────────────────────────────────────────────
  async addAttendee(
    kickoffId: string,
    dto: CreateAttendeeDto,
    user: AuthenticatedUser,
  ): Promise<KickoffAttendeeEntity> {
    const kickoff = await this.access.assertCanManage(user, kickoffId);

    const hasEmployee = !!dto.employeeId;
    const hasExternal = !!dto.externalName?.trim();
    if (hasEmployee === hasExternal) {
      throw new BadRequestException(
        'Provide exactly one of employeeId (internal) or externalName (external)',
      );
    }

    const attendee = await this.prisma.kickoffAttendee.create({
      data: {
        kickoffId,
        employeeId: dto.employeeId ?? null,
        externalName: dto.externalName ?? null,
        externalOrganization: dto.externalOrganization ?? null,
        designation: dto.designation ?? null,
        department: dto.department ?? null,
      },
      include: {
        employee: {
          select: {
            firstName: true,
            lastName: true,
            designation: true,
            vertical: { select: { name: true } },
          },
        },
      },
    });

    // An internal attendee also joins the project board (idempotent), so they
    // can see action-item cards and be assigned them.
    if (dto.employeeId) {
      await this.boards.ensureMember(kickoff.kanbanBoardId, dto.employeeId);
    }
    return this.toAttendee(attendee);
  }

  async removeAttendee(
    kickoffId: string,
    attendeeId: string,
    user: AuthenticatedUser,
  ): Promise<void> {
    await this.access.assertCanManage(user, kickoffId);
    const attendee = await this.prisma.kickoffAttendee.findFirst({
      where: { id: attendeeId, kickoffId },
      select: { id: true },
    });
    if (!attendee) throw new NotFoundException('Attendee not found');
    // Board membership is intentionally left intact — removing someone from the
    // attendance record shouldn't silently strip their board access.
    await this.prisma.kickoffAttendee.delete({ where: { id: attendeeId } });
  }

  // ── Milestones (standalone CRUD, not Kanban-linked) ─────────────────
  async addMilestone(
    kickoffId: string,
    dto: CreateMilestoneDto,
    user: AuthenticatedUser,
  ): Promise<KickoffMilestoneEntity> {
    await this.access.assertCanManage(user, kickoffId);
    const m = await this.prisma.kickoffMilestone.create({
      data: {
        kickoffId,
        name: dto.name,
        targetDate: new Date(dto.targetDate),
        ownerId: dto.ownerId ?? null,
        status: dto.status ?? undefined,
      },
      include: { owner: { select: { firstName: true, lastName: true } } },
    });
    return this.toMilestone(m);
  }

  /**
   * Standard-milestone suggestions for this kickoff's Add-milestone dropdown:
   * the union of active MilestoneTemplates across every distinct delivery type
   * present on the kickoff's order lines, deduplicated by name and ordered.
   * Read access is enough — this only reveals the catalogue, not project data.
   * Lines with no delivery type yet contribute nothing; a kickoff with no
   * classified lines simply returns an empty list (UI falls back to free-text).
   */
  async milestoneTemplates(
    kickoffId: string,
    user: AuthenticatedUser,
  ): Promise<KickoffMilestoneTemplateEntity[]> {
    await this.access.assertCanAccess(user, kickoffId);
    const kickoff = await this.prisma.projectKickoff.findUnique({
      where: { id: kickoffId },
      select: {
        order: {
          select: {
            lineItems: {
              select: { deliverySplits: { select: { deliveryType: true } } },
            },
          },
        },
      },
    });
    if (!kickoff) throw new NotFoundException('Kickoff not found');

    const flowTypes = [
      ...new Set(
        kickoff.order.lineItems
          .flatMap((li) => li.deliverySplits)
          .map((s) => s.deliveryType)
          .filter((t): t is OrderLineDeliveryType => t !== null),
      ),
    ];
    if (flowTypes.length === 0) return [];

    const templates = await this.prisma.milestoneTemplate.findMany({
      where: { isActive: true, flowType: { in: flowTypes } },
      orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
    });

    // Deduplicate by name, keeping first-seen order (templates come pre-sorted
    // by displayOrder), and record which flow types contributed each name.
    const byName = new Map<string, KickoffMilestoneTemplateEntity>();
    for (const t of templates) {
      const existing = byName.get(t.name);
      if (existing) existing.flowTypes.push(t.flowType);
      else
        byName.set(
          t.name,
          new KickoffMilestoneTemplateEntity({
            name: t.name,
            flowTypes: [t.flowType],
          }),
        );
    }
    return [...byName.values()];
  }

  async updateMilestone(
    kickoffId: string,
    milestoneId: string,
    dto: UpdateMilestoneDto,
    user: AuthenticatedUser,
  ): Promise<KickoffMilestoneEntity> {
    await this.access.assertCanManage(user, kickoffId);
    await this.getSubOrThrow('kickoffMilestone', milestoneId, kickoffId);
    const m = await this.prisma.kickoffMilestone.update({
      where: { id: milestoneId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.targetDate !== undefined
          ? { targetDate: new Date(dto.targetDate) }
          : {}),
        ...(dto.ownerId !== undefined ? { ownerId: dto.ownerId } : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
      },
      include: { owner: { select: { firstName: true, lastName: true } } },
    });
    return this.toMilestone(m);
  }

  async removeMilestone(
    kickoffId: string,
    milestoneId: string,
    user: AuthenticatedUser,
  ): Promise<void> {
    await this.access.assertCanManage(user, kickoffId);
    await this.getSubOrThrow('kickoffMilestone', milestoneId, kickoffId);
    await this.prisma.kickoffMilestone.delete({ where: { id: milestoneId } });
  }

  // ── Action items (each mirrored to a Kanban card) ───────────────────
  async addActionItem(
    kickoffId: string,
    dto: CreateActionItemDto,
    user: AuthenticatedUser,
  ): Promise<KickoffActionItemEntity> {
    const kickoff = await this.access.assertCanManage(user, kickoffId);

    // Resolve the board's "To Do" list (lowest position, not a done-list).
    const todo = await this.prisma.kanbanList.findFirst({
      where: { boardId: kickoff.kanbanBoardId, isDoneList: false },
      orderBy: { position: 'asc' },
      select: { id: true },
    });
    if (!todo) {
      throw new BadRequestException(
        'The project board has no open list to place the action item on',
      );
    }

    // The owner must be a board member before we can assign the card to them.
    await this.boards.ensureMember(kickoff.kanbanBoardId, dto.ownerId);
    const cardId = await this.boards.provisionActionCard({
      listId: todo.id,
      title: dto.description,
      assigneeId: dto.ownerId,
      createdById: user.id,
      dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
    });

    const item = await this.prisma.kickoffActionItem.create({
      data: {
        kickoffId,
        description: dto.description,
        ownerId: dto.ownerId,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
        kanbanCardId: cardId,
      },
      include: this.actionItemInclude(),
    });
    return this.toActionItem(item);
  }

  async updateActionItem(
    kickoffId: string,
    actionItemId: string,
    dto: UpdateActionItemDto,
    user: AuthenticatedUser,
  ): Promise<KickoffActionItemEntity> {
    await this.access.assertCanManage(user, kickoffId);
    const existing = await this.prisma.kickoffActionItem.findFirst({
      where: { id: actionItemId, kickoffId },
      select: { id: true, kanbanCardId: true },
    });
    if (!existing) throw new NotFoundException('Action item not found');

    const dueDate =
      dto.dueDate !== undefined
        ? dto.dueDate
          ? new Date(dto.dueDate)
          : null
        : undefined;

    const item = await this.prisma.kickoffActionItem.update({
      where: { id: actionItemId },
      data: {
        ...(dto.description !== undefined
          ? { description: dto.description }
          : {}),
        ...(dueDate !== undefined ? { dueDate } : {}),
      },
      include: this.actionItemInclude(),
    });

    // Keep the linked card's title/due date in sync with the action item.
    if (
      existing.kanbanCardId &&
      (dto.description !== undefined || dueDate !== undefined)
    ) {
      await this.prisma.kanbanCard.update({
        where: { id: existing.kanbanCardId },
        data: {
          ...(dto.description !== undefined ? { title: dto.description } : {}),
          ...(dueDate !== undefined ? { dueDate } : {}),
        },
      });
    }
    return this.toActionItem(item);
  }

  async removeActionItem(
    kickoffId: string,
    actionItemId: string,
    user: AuthenticatedUser,
  ): Promise<void> {
    await this.access.assertCanManage(user, kickoffId);
    const existing = await this.prisma.kickoffActionItem.findFirst({
      where: { id: actionItemId, kickoffId },
      select: { id: true, kanbanCardId: true },
    });
    if (!existing) throw new NotFoundException('Action item not found');
    // Archive the linked card (soft-delete), matching the Kanban delete rule,
    // then remove the action item.
    if (existing.kanbanCardId) {
      await this.prisma.kanbanCard.update({
        where: { id: existing.kanbanCardId },
        data: { status: KanbanCardStatus.ARCHIVED },
      });
    }
    await this.prisma.kickoffActionItem.delete({ where: { id: actionItemId } });
  }

  // ── Risks (standalone CRUD) ─────────────────────────────────────────
  async addRisk(
    kickoffId: string,
    dto: CreateRiskDto,
    user: AuthenticatedUser,
  ): Promise<KickoffRiskEntity> {
    await this.access.assertCanManage(user, kickoffId);
    const r = await this.prisma.kickoffRisk.create({
      data: {
        kickoffId,
        description: dto.description,
        likelihood: dto.likelihood ?? undefined,
        impact: dto.impact ?? undefined,
        mitigationPlan: dto.mitigationPlan ?? null,
        ownerId: dto.ownerId ?? null,
      },
      include: { owner: { select: { firstName: true, lastName: true } } },
    });
    return this.toRisk(r);
  }

  async updateRisk(
    kickoffId: string,
    riskId: string,
    dto: UpdateRiskDto,
    user: AuthenticatedUser,
  ): Promise<KickoffRiskEntity> {
    await this.access.assertCanManage(user, kickoffId);
    await this.getSubOrThrow('kickoffRisk', riskId, kickoffId);
    const r = await this.prisma.kickoffRisk.update({
      where: { id: riskId },
      data: {
        ...(dto.description !== undefined
          ? { description: dto.description }
          : {}),
        ...(dto.likelihood !== undefined ? { likelihood: dto.likelihood } : {}),
        ...(dto.impact !== undefined ? { impact: dto.impact } : {}),
        ...(dto.mitigationPlan !== undefined
          ? { mitigationPlan: dto.mitigationPlan }
          : {}),
        ...(dto.ownerId !== undefined ? { ownerId: dto.ownerId } : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
      },
      include: { owner: { select: { firstName: true, lastName: true } } },
    });
    return this.toRisk(r);
  }

  async removeRisk(
    kickoffId: string,
    riskId: string,
    user: AuthenticatedUser,
  ): Promise<void> {
    await this.access.assertCanManage(user, kickoffId);
    await this.getSubOrThrow('kickoffRisk', riskId, kickoffId);
    await this.prisma.kickoffRisk.delete({ where: { id: riskId } });
  }

  // ── Delivery classification (on the linked order's line items) ──────
  /**
   * Replace the full set of vendor delivery splits for one order line. Gated by
   * assertCanManage (Project Manager/SUPER_ADMIN, same as every other kickoff
   * edit). The line item must belong to THIS kickoff's order — we resolve the
   * kickoff's orderId and match on it, so a caller can't edit an arbitrary
   * order's lines.
   *
   * A line's quantity can be sourced from more than one vendor; each split is a
   * portion tracked independently through PLM. Invariants enforced here:
   *   - Split quantities must sum to EXACTLY the line quantity.
   *   - A split with a live PLM tracker cannot be removed (that would
   *     cascade-destroy the tracker) or have its delivery type changed.
   *
   * Per-split vendor rules on a type change (same as the former single-vendor
   * path, now applied per split):
   *   - VENDOR   → cleared, ready for manual entry.
   *   - IN_HOUSE → vendorName auto-set to the fixed manufacturing partner
   *                (override), contact/lead-time cleared; all remain editable.
   *   - NPD      → cleared (no vendor).
   * An explicit vendorName/contact/lead-time on the same split still wins (the
   * manual-override path), applied after the type-driven defaults.
   */
  async updateDeliveryItem(
    kickoffId: string,
    lineItemId: string,
    dto: UpdateDeliveryItemDto,
    user: AuthenticatedUser,
  ): Promise<KickoffDeliveryItemEntity> {
    const kickoff = await this.access.assertCanManage(user, kickoffId);
    const line = await this.prisma.orderLineItem.findFirst({
      where: { id: lineItemId, orderId: kickoff.orderId },
      select: {
        id: true,
        quantity: true,
        deliverySplits: {
          select: {
            id: true,
            deliveryType: true,
            plmTracker: { select: { id: true } },
          },
        },
      },
    });
    if (!line) {
      throw new NotFoundException(
        'Line item not found on this kickoff’s order',
      );
    }

    // The vendor portions must fully allocate the line quantity — exact decimal
    // match, never a JS-float comparison.
    const allocated = dto.splits.reduce(
      (sum, s) => sum.plus(new Prisma.Decimal(s.quantity)),
      new Prisma.Decimal(0),
    );
    if (!allocated.equals(line.quantity)) {
      throw new BadRequestException(
        `Split quantities must add up to exactly the line quantity (${line.quantity.toString()})`,
      );
    }

    const existingById = new Map(line.deliverySplits.map((s) => [s.id, s]));
    const keptIds = new Set<string>();
    for (const input of dto.splits) {
      if (!input.id) continue;
      const existing = existingById.get(input.id);
      if (!existing) {
        throw new BadRequestException(
          'A referenced split does not belong to this line item',
        );
      }
      keptIds.add(input.id);
      if (
        existing.plmTracker &&
        input.deliveryType !== undefined &&
        input.deliveryType !== existing.deliveryType
      ) {
        throw new BadRequestException(
          'Delivery type cannot change after PLM tracking has started',
        );
      }
    }
    // Removing a split that already has a PLM tracker would cascade-destroy the
    // tracker + its events/cards — refuse it.
    const removed = line.deliverySplits.filter((s) => !keptIds.has(s.id));
    if (removed.some((s) => s.plmTracker)) {
      throw new BadRequestException(
        'A vendor split with PLM tracking in progress cannot be removed',
      );
    }

    // Resolve vendor lookups (async, approval-gated) before opening the tx.
    const resolved = await Promise.all(
      dto.splits.map((input) => this.resolveSplitData(input)),
    );

    await this.prisma.$transaction(async (tx) => {
      if (removed.length > 0) {
        await tx.orderLineDeliverySplit.deleteMany({
          where: { id: { in: removed.map((s) => s.id) } },
        });
      }
      for (let i = 0; i < dto.splits.length; i++) {
        const input = dto.splits[i];
        const data = resolved[i];
        if (input.id) {
          await tx.orderLineDeliverySplit.update({
            where: { id: input.id },
            data,
          });
        } else {
          await tx.orderLineDeliverySplit.create({
            data: { ...data, orderLineId: line.id },
          });
        }
      }
    });

    await this.plm.provisionForKickoff(kickoffId);

    const refreshed = await this.prisma.orderLineItem.findUniqueOrThrow({
      where: { id: lineItemId },
      include: {
        product: { select: { name: true, sku: true } },
        deliverySplits: {
          orderBy: { createdAt: 'asc' },
          include: { plmTracker: { select: { id: true } } },
        },
      },
    });
    return this.toDeliveryItem(refreshed);
  }

  /**
   * Build the persisted column values for one split input, applying the
   * type-driven vendor defaults then the explicit manual overrides. `vendorId`
   * is written as a scalar FK (works for both create and update, unlike the
   * relation connect/disconnect form).
   */
  private async resolveSplitData(input: DeliverySplitInputDto): Promise<{
    quantity: Prisma.Decimal;
    deliveryType?: OrderLineDeliveryType | null;
    vendorId?: string | null;
    vendorName?: string | null;
    vendorContactInfo?: string | null;
    vendorExpectedLeadTime?: string | null;
  }> {
    const data: {
      quantity: Prisma.Decimal;
      deliveryType?: OrderLineDeliveryType | null;
      vendorId?: string | null;
      vendorName?: string | null;
      vendorContactInfo?: string | null;
      vendorExpectedLeadTime?: string | null;
    } = { quantity: new Prisma.Decimal(input.quantity) };

    if (input.deliveryType !== undefined) {
      data.deliveryType = input.deliveryType;
      // In-House pins the fixed manufacturing partner; VENDOR/NPD clear any
      // vendor carried over from a prior type. Contact/lead-time always reset.
      data.vendorName =
        input.deliveryType === 'IN_HOUSE' ? IN_HOUSE_VENDOR_NAME : null;
      data.vendorContactInfo = null;
      data.vendorExpectedLeadTime = null;
      data.vendorId = null;
    }
    if (input.vendorId !== undefined) {
      if (input.vendorId === null) {
        data.vendorId = null;
      } else {
        const vendor = await this.prisma.vendor.findUnique({
          where: { id: input.vendorId },
          select: { id: true, companyName: true, status: true },
        });
        if (!vendor) {
          throw new BadRequestException('Select a valid Vendor Master record');
        }
        data.vendorId = vendor.id;
        if (input.vendorName === undefined) data.vendorName = vendor.companyName;
      }
    }
    // Explicit fields win over the type-driven default (manual override).
    if (input.vendorName !== undefined) data.vendorName = input.vendorName;
    if (input.vendorContactInfo !== undefined)
      data.vendorContactInfo = input.vendorContactInfo;
    if (input.vendorExpectedLeadTime !== undefined)
      data.vendorExpectedLeadTime = input.vendorExpectedLeadTime;

    return data;
  }

  // ── internals ──────────────────────────────────────────────────────
  private fullInclude() {
    return {
      attendees: {
        orderBy: { createdAt: 'asc' as const },
        include: {
          employee: {
            select: {
              firstName: true,
              lastName: true,
              designation: true,
              vertical: { select: { name: true } },
            },
          },
        },
      },
      milestones: {
        orderBy: { targetDate: 'asc' as const },
        include: { owner: { select: { firstName: true, lastName: true } } },
      },
      actionItems: {
        orderBy: { createdAt: 'asc' as const },
        include: this.actionItemInclude(),
      },
      risks: {
        orderBy: { createdAt: 'asc' as const },
        include: { owner: { select: { firstName: true, lastName: true } } },
      },
      // The linked order's line items drive the Delivery Classification section.
      order: {
        select: {
          bid: {
            select: {
              id: true,
              bidNumber: true,
              strategyMeetings: {
                orderBy: { meetingDate: 'desc' as const },
                select: {
                  id: true,
                  meetingDate: true,
                  meetingMode: true,
                  notes: true,
                },
              },
            },
          },
          lineItems: {
            orderBy: { createdAt: 'asc' as const },
            include: {
              product: { select: { name: true, sku: true } },
              deliverySplits: {
                orderBy: { createdAt: 'asc' as const },
                include: { plmTracker: { select: { id: true } } },
              },
            },
          },
        },
      },
    };
  }

  private actionItemInclude() {
    return {
      owner: { select: { firstName: true, lastName: true } },
      kanbanCard: {
        select: {
          status: true,
          list: { select: { name: true, isDoneList: true } },
        },
      },
    };
  }

  /** Confirm a sub-resource belongs to the kickoff before mutating it. */
  private async getSubOrThrow(
    model: 'kickoffMilestone' | 'kickoffRisk',
    id: string,
    kickoffId: string,
  ): Promise<void> {
    const row =
      model === 'kickoffMilestone'
        ? await this.prisma.kickoffMilestone.findFirst({
            where: { id, kickoffId },
            select: { id: true },
          })
        : await this.prisma.kickoffRisk.findFirst({
            where: { id, kickoffId },
            select: { id: true },
          });
    if (!row) throw new NotFoundException('Record not found');
  }

  // ── mappers ────────────────────────────────────────────────────────
  private async toEntity(row: KickoffRow): Promise<ProjectKickoffEntity> {
    return new ProjectKickoffEntity({
      id: row.id,
      orderId: row.orderId,
      projectName: row.projectName,
      meetingDate: row.meetingDate.toISOString(),
      meetingMode: row.meetingMode,
      meetingLocation: row.meetingLocation,
      overviewAndScope: row.overviewAndScope,
      minutesNotes: row.minutesNotes,
      status: row.status,
      supplyInScope: row.supplyInScope,
      vendorUpdateCadenceDays: row.vendorUpdateCadenceDays,
      kanbanBoardId: row.kanbanBoardId,
      createdById: row.createdById,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      attendees: row.attendees.map((a) => this.toAttendee(a)),
      milestones: row.milestones.map((m) => this.toMilestone(m)),
      actionItems: row.actionItems.map((i) => this.toActionItem(i)),
      risks: row.risks.map((r) => this.toRisk(r)),
      deliveryItems: row.order.lineItems.map((li) => this.toDeliveryItem(li)),
      priorBidStrategyMeetings: row.order.bid
        ? row.order.bid.strategyMeetings.map((meeting) => ({
            id: meeting.id,
            bidId: row.order.bid!.id,
            bidNumber: row.order.bid!.bidNumber,
            meetingDate: meeting.meetingDate.toISOString(),
            meetingMode: meeting.meetingMode,
            notes: meeting.notes,
          }))
        : [],
    });
  }

  private toDeliveryItem(li: DeliveryItemRow): KickoffDeliveryItemEntity {
    return new KickoffDeliveryItemEntity({
      id: li.id,
      // Customer-facing override first — kickoff is an order-context surface.
      productName:
        li.customerFacingProductName ??
        li.product?.name ??
        li.adHocProductName ??
        'Unnamed product',
      productSku: li.product?.sku ?? 'Ad-hoc',
      quantity: li.quantity.toString(),
      splits: li.deliverySplits.map(
        (s) =>
          new KickoffDeliverySplitEntity({
            id: s.id,
            quantity: s.quantity.toString(),
            deliveryType: s.deliveryType,
            vendorId: s.vendorId,
            vendorName: s.vendorName,
            vendorContactInfo: s.vendorContactInfo,
            vendorExpectedLeadTime: s.vendorExpectedLeadTime,
            hasPlmTracker: s.plmTracker !== null,
          }),
      ),
    });
  }

  private toAttendee(a: AttendeeRow): KickoffAttendeeEntity {
    const isInternal = !!a.employeeId;
    return new KickoffAttendeeEntity({
      id: a.id,
      kickoffId: a.kickoffId,
      employeeId: a.employeeId,
      name: isInternal ? fullName(a.employee) : a.externalName,
      // Internal attendee details remain live: correcting an employee's
      // designation or vertical in the HR roster immediately updates every
      // kickoff that references that employee. External attendee details are
      // still the snapshots entered on the kickoff itself.
      externalOrganization: isInternal ? 'Internal' : a.externalOrganization,
      designation: isInternal
        ? (a.employee?.designation ?? null)
        : a.designation,
      department: isInternal
        ? (a.employee?.vertical?.name ?? null)
        : a.department,
      isInternal,
    });
  }

  private toMilestone(m: MilestoneRow): KickoffMilestoneEntity {
    return new KickoffMilestoneEntity({
      id: m.id,
      kickoffId: m.kickoffId,
      name: m.name,
      targetDate: m.targetDate.toISOString(),
      ownerId: m.ownerId,
      ownerName: fullName(m.owner),
      status: m.status,
    });
  }

  private toActionItem(i: ActionItemRow): KickoffActionItemEntity {
    // Status is COMPUTED from the linked card's list — no stored status.
    let status: ActionItemComputedStatus = 'UNLINKED';
    let currentListName: string | null = null;
    if (i.kanbanCard) {
      currentListName = i.kanbanCard.list.name;
      if (i.kanbanCard.status === KanbanCardStatus.ARCHIVED) {
        status = 'ARCHIVED';
      } else if (i.kanbanCard.list.isDoneList) {
        status = 'DONE';
      } else {
        // Heuristic: the lowest open list is "to do"; any other open list is
        // in-progress. We only stored the name/flag, so treat a common "to do"
        // name as TODO and everything else open as IN_PROGRESS.
        status = /to\s*do|backlog/i.test(i.kanbanCard.list.name)
          ? 'TODO'
          : 'IN_PROGRESS';
      }
    }
    return new KickoffActionItemEntity({
      id: i.id,
      kickoffId: i.kickoffId,
      description: i.description,
      ownerId: i.ownerId,
      ownerName: fullName(i.owner),
      dueDate: i.dueDate ? i.dueDate.toISOString() : null,
      kanbanCardId: i.kanbanCardId,
      currentListName,
      status,
    });
  }

  private toRisk(r: RiskRow): KickoffRiskEntity {
    return new KickoffRiskEntity({
      id: r.id,
      kickoffId: r.kickoffId,
      description: r.description,
      likelihood: r.likelihood,
      impact: r.impact,
      mitigationPlan: r.mitigationPlan,
      ownerId: r.ownerId,
      ownerName: fullName(r.owner),
      status: r.status,
    });
  }
}

// ── Prisma row shapes (with the includes above) ─────────────────────
type AttendeeRow = Prisma.KickoffAttendeeGetPayload<{
  include: {
    employee: {
      select: {
        firstName: true;
        lastName: true;
        designation: true;
        vertical: { select: { name: true } };
      };
    };
  };
}>;
type MilestoneRow = Prisma.KickoffMilestoneGetPayload<{
  include: { owner: { select: { firstName: true; lastName: true } } };
}>;
type ActionItemRow = Prisma.KickoffActionItemGetPayload<{
  include: {
    owner: { select: { firstName: true; lastName: true } };
    kanbanCard: {
      select: {
        status: true;
        list: { select: { name: true; isDoneList: true } };
      };
    };
  };
}>;
type RiskRow = Prisma.KickoffRiskGetPayload<{
  include: { owner: { select: { firstName: true; lastName: true } } };
}>;
type DeliveryItemRow = Prisma.OrderLineItemGetPayload<{
  include: {
    product: { select: { name: true; sku: true } };
    deliverySplits: {
      include: { plmTracker: { select: { id: true } } };
    };
  };
}>;
type KickoffRow = Prisma.ProjectKickoffGetPayload<{
  include: {
    attendees: {
      include: {
        employee: {
          select: {
            firstName: true;
            lastName: true;
            designation: true;
            vertical: { select: { name: true } };
          };
        };
      };
    };
    milestones: {
      include: { owner: { select: { firstName: true; lastName: true } } };
    };
    actionItems: {
      include: {
        owner: { select: { firstName: true; lastName: true } };
        kanbanCard: {
          select: {
            status: true;
            list: { select: { name: true; isDoneList: true } };
          };
        };
      };
    };
    risks: {
      include: { owner: { select: { firstName: true; lastName: true } } };
    };
    order: {
      select: {
        bid: {
          select: {
            id: true;
            bidNumber: true;
            strategyMeetings: {
              select: {
                id: true;
                meetingDate: true;
                meetingMode: true;
                notes: true;
              };
            };
          };
        };
        lineItems: {
          include: {
            product: { select: { name: true; sku: true } };
            deliverySplits: {
              include: { plmTracker: { select: { id: true } } };
            };
          };
        };
      };
    };
  };
}>;
