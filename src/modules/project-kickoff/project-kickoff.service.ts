import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { KanbanCardStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { ConfirmationSheetsService } from '../sales/confirmation-sheets.service';
import { KanbanBoardsService } from '../kanban/kanban-boards.service';
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
  KickoffDeliveryItemEntity,
  KickoffMilestoneEntity,
  KickoffRiskEntity,
  ProjectKickoffEntity,
} from './entities/project-kickoff.entity';
import { UpdateDeliveryItemDto } from './dto/project-kickoff.dto';

/** Employee shape needed to render an owner/attendee name. */
type EmployeeName = { firstName: string; lastName: string } | null;
function fullName(e: EmployeeName): string | null {
  return e ? `${e.firstName} ${e.lastName}` : null;
}

@Injectable()
export class ProjectKickoffService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectKickoffAccessService,
    private readonly confirmationSheets: ConfirmationSheetsService,
    private readonly boards: KanbanBoardsService,
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
      include: { bid: true, customer: { select: { name: true } } },
    });
    if (!order) {
      throw new NotFoundException('Order not found');
    }

    const executed = await this.confirmationSheets.latestIsExecutedFor(
      dto.orderId,
    );
    if (!executed) {
      throw new BadRequestException(
        'A project kickoff can only be created once the order’s Confirmation Sheet is executed',
      );
    }

    const projectName =
      dto.projectName?.trim() ||
      `${order.customer.name} — ${order.orderNumber}`;
    const overview =
      dto.overviewAndScope ??
      order.bid?.quotationSubject ??
      order.bid?.technicalSpecification ??
      null;

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
  ): Promise<{ id: string; orderNumber: string; customerName: string }[]> {
    await this.access.assertCanCreate(user);

    // Confirmed-or-later orders that don't already have a kickoff.
    const orders = await this.prisma.order.findMany({
      where: { projectKickoffs: { none: {} } },
      select: {
        id: true,
        orderNumber: true,
        customer: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Keep only those whose latest confirmation sheet is EXECUTED (the same
    // gate create() enforces). Checked per-order to reuse the one source of truth.
    const eligible = await Promise.all(
      orders.map(async (o) => ({
        order: o,
        ok: await this.confirmationSheets.latestIsExecutedFor(o.id),
      })),
    );
    return eligible
      .filter((e) => e.ok)
      .map((e) => ({
        id: e.order.id,
        orderNumber: e.order.orderNumber,
        customerName: e.order.customer.name,
      }));
  }

  // ── Read ─────────────────────────────────────────────────────────────
  async findAll(user: AuthenticatedUser): Promise<ProjectKickoffEntity[]> {
    // Visible kickoffs: created by me, or I'm an internal attendee — or all for
    // SUPER_ADMIN. Filtered in the query so we never over-fetch.
    const where: Prisma.ProjectKickoffWhereInput = this.access.isSuperAdmin(user)
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

  async update(
    id: string,
    dto: UpdateKickoffDto,
    user: AuthenticatedUser,
  ): Promise<ProjectKickoffEntity> {
    await this.access.assertCanAccess(user, id);
    await this.prisma.projectKickoff.update({
      where: { id },
      data: {
        ...(dto.projectName !== undefined ? { projectName: dto.projectName } : {}),
        ...(dto.meetingDate !== undefined
          ? { meetingDate: new Date(dto.meetingDate) }
          : {}),
        ...(dto.meetingMode !== undefined ? { meetingMode: dto.meetingMode } : {}),
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
      },
    });
    return this.findOne(id, user);
  }

  // ── Attendees ──────────────────────────────────────────────────────
  async addAttendee(
    kickoffId: string,
    dto: CreateAttendeeDto,
    user: AuthenticatedUser,
  ): Promise<KickoffAttendeeEntity> {
    const kickoff = await this.access.assertCanAccess(user, kickoffId);

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
      include: { employee: { select: { firstName: true, lastName: true } } },
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
    await this.access.assertCanAccess(user, kickoffId);
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
    await this.access.assertCanAccess(user, kickoffId);
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

  async updateMilestone(
    kickoffId: string,
    milestoneId: string,
    dto: UpdateMilestoneDto,
    user: AuthenticatedUser,
  ): Promise<KickoffMilestoneEntity> {
    await this.access.assertCanAccess(user, kickoffId);
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
    await this.access.assertCanAccess(user, kickoffId);
    await this.getSubOrThrow('kickoffMilestone', milestoneId, kickoffId);
    await this.prisma.kickoffMilestone.delete({ where: { id: milestoneId } });
  }

  // ── Action items (each mirrored to a Kanban card) ───────────────────
  async addActionItem(
    kickoffId: string,
    dto: CreateActionItemDto,
    user: AuthenticatedUser,
  ): Promise<KickoffActionItemEntity> {
    const kickoff = await this.access.assertCanAccess(user, kickoffId);

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
    await this.access.assertCanAccess(user, kickoffId);
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
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dueDate !== undefined ? { dueDate } : {}),
      },
      include: this.actionItemInclude(),
    });

    // Keep the linked card's title/due date in sync with the action item.
    if (existing.kanbanCardId && (dto.description !== undefined || dueDate !== undefined)) {
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
    await this.access.assertCanAccess(user, kickoffId);
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
    await this.access.assertCanAccess(user, kickoffId);
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
    await this.access.assertCanAccess(user, kickoffId);
    await this.getSubOrThrow('kickoffRisk', riskId, kickoffId);
    const r = await this.prisma.kickoffRisk.update({
      where: { id: riskId },
      data: {
        ...(dto.description !== undefined ? { description: dto.description } : {}),
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
    await this.access.assertCanAccess(user, kickoffId);
    await this.getSubOrThrow('kickoffRisk', riskId, kickoffId);
    await this.prisma.kickoffRisk.delete({ where: { id: riskId } });
  }

  // ── Delivery classification (on the linked order's line items) ──────
  /**
   * Set a line item's delivery type + vendor placeholder fields. Gated by
   * kickoff access (same as every other kickoff edit). The line item must
   * belong to THIS kickoff's order — we resolve the kickoff's orderId and match
   * on it, so a caller can't edit an arbitrary order's lines. Vendor fields are
   * only meaningful for VENDOR; when the type is set to non-VENDOR we clear
   * them so stale vendor data doesn't linger.
   */
  async updateDeliveryItem(
    kickoffId: string,
    lineItemId: string,
    dto: UpdateDeliveryItemDto,
    user: AuthenticatedUser,
  ): Promise<KickoffDeliveryItemEntity> {
    const kickoff = await this.access.assertCanAccess(user, kickoffId);
    const line = await this.prisma.orderLineItem.findFirst({
      where: { id: lineItemId, orderId: kickoff.orderId },
      select: { id: true },
    });
    if (!line) {
      throw new NotFoundException('Line item not found on this kickoff’s order');
    }

    const data: Prisma.OrderLineItemUpdateInput = {};
    if (dto.deliveryType !== undefined) {
      data.deliveryType = dto.deliveryType;
      // Clearing to non-VENDOR wipes the placeholder vendor fields.
      if (dto.deliveryType !== 'VENDOR') {
        data.vendorName = null;
        data.vendorContactInfo = null;
        data.vendorExpectedLeadTime = null;
      }
    }
    if (dto.vendorName !== undefined) data.vendorName = dto.vendorName;
    if (dto.vendorContactInfo !== undefined)
      data.vendorContactInfo = dto.vendorContactInfo;
    if (dto.vendorExpectedLeadTime !== undefined)
      data.vendorExpectedLeadTime = dto.vendorExpectedLeadTime;

    const updated = await this.prisma.orderLineItem.update({
      where: { id: lineItemId },
      data,
      include: { product: { select: { name: true, sku: true } } },
    });
    return this.toDeliveryItem(updated);
  }

  // ── internals ──────────────────────────────────────────────────────
  private fullInclude() {
    return {
      attendees: {
        orderBy: { createdAt: 'asc' as const },
        include: { employee: { select: { firstName: true, lastName: true } } },
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
          lineItems: {
            orderBy: { createdAt: 'asc' as const },
            include: { product: { select: { name: true, sku: true } } },
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
      kanbanBoardId: row.kanbanBoardId,
      createdById: row.createdById,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      attendees: row.attendees.map((a) => this.toAttendee(a)),
      milestones: row.milestones.map((m) => this.toMilestone(m)),
      actionItems: row.actionItems.map((i) => this.toActionItem(i)),
      risks: row.risks.map((r) => this.toRisk(r)),
      deliveryItems: row.order.lineItems.map((li) =>
        this.toDeliveryItem(li),
      ),
    });
  }

  private toDeliveryItem(li: DeliveryItemRow): KickoffDeliveryItemEntity {
    return new KickoffDeliveryItemEntity({
      id: li.id,
      productName: li.product.name,
      productSku: li.product.sku,
      quantity: li.quantity.toString(),
      deliveryType: li.deliveryType,
      vendorName: li.vendorName,
      vendorContactInfo: li.vendorContactInfo,
      vendorExpectedLeadTime: li.vendorExpectedLeadTime,
    });
  }

  private toAttendee(a: AttendeeRow): KickoffAttendeeEntity {
    const isInternal = !!a.employeeId;
    return new KickoffAttendeeEntity({
      id: a.id,
      kickoffId: a.kickoffId,
      employeeId: a.employeeId,
      name: isInternal ? fullName(a.employee) : a.externalName,
      externalOrganization: a.externalOrganization,
      designation: a.designation,
      department: a.department,
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
  include: { employee: { select: { firstName: true; lastName: true } } };
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
  include: { product: { select: { name: true; sku: true } } };
}>;
type KickoffRow = Prisma.ProjectKickoffGetPayload<{
  include: {
    attendees: {
      include: { employee: { select: { firstName: true; lastName: true } } };
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
        lineItems: {
          include: { product: { select: { name: true; sku: true } } };
        };
      };
    };
  };
}>;
