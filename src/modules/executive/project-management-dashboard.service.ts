import { Injectable } from '@nestjs/common';
import { OrderStatus, OrderType, PingRecipientStatus } from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { ProjectKickoffService } from '../project-kickoff/project-kickoff.service';
import type {
  ProjectHealth,
  ProjectProgressView,
} from '../project-kickoff/project-progress';
import {
  deriveActionItemStatus,
  isActionItemOpen,
  isActionItemOverdue,
  isMilestoneOverdue,
  isRiskHighImpactOpen,
} from '../project-kickoff/kickoff-work-items';
import { daysBetween } from './sales-dashboard.math';
import { wholeDaysUntil } from '../../common/utils/date.util';
import {
  average,
  bucketAges,
  breachRate,
  countHealth,
  imbalancePercent,
  ratePercent,
  relativeLoadPercent,
} from './project-management-dashboard.math';

/**
 * The executive Project Management dashboard: "which project, owned by which
 * PM, needs my personal intervention today".
 *
 * Two rules:
 *
 *  - **Reuse, never restate.** Project health, its reason, the stage ladder and
 *    every "is this late" test come from the same functions the personal
 *    dashboard and the Operations dashboard use — `deriveProjectProgress` via
 *    `progressCompanyWide()`, and the shared `kickoff-work-items` predicates.
 *    Nothing here re-decides whether a milestone is overdue. The promised
 *    delivery date is read off the same confirmation sheet PLM reads (EXECUTED,
 *    highest revision) and tiered with the same whole-day clock, so a project
 *    can't read "overdue" on one page and "on track" on another.
 *  - **Attribution on every row.** Every list carries the owning PM, because
 *    the point of this dashboard is knowing who to call. Aggregates exist only
 *    to rank the named rows underneath them.
 *
 * Scope: project and delivery management only. No revenue, margin, customer,
 * receivable, vendor-price or purchase-order figure is loaded or emitted —
 * that's what the Sales, Finance and SCM dashboards are for.
 *
 * Access is checked by ExecutiveAccessService at the controller, not here.
 */

/** Statuses that mean "the PM's active portfolio", i.e. still needing management. */
const ACTIVE_KICKOFF_STAGE_EXCLUSIONS = {
  /** Fully dispatched — delivered, nothing left to manage. */
  dispatchComplete: 'dispatch',
  /** Cancelled order — the ATTENTION state on the order lamp. */
  orderCancelled: 'order',
} as const;

/** Named rows are capped so one runaway project can't bury the rest. */
const NAMED_ROW_LIMIT = 12;
/** The app-wide ping escalation boundary, in hours (see web/app/lib/urgency.ts). */
const PING_AGING_AFTER_HOURS = 24;

type KickoffRow = Awaited<
  ReturnType<ProjectManagementDashboardService['loadKickoffs']>
>[number];

export interface PmWorkloadRow {
  pmId: string;
  pm: string;
  activeProjects: number;
  openTasks: number;
  overdueTasks: number;
  unassignedTasks: number;
  openMilestones: number;
  overdueMilestones: number;
  openActionItems: number;
  overdueActionItems: number;
  openHighRisks: number;
  blockedProjects: number;
  atRiskProjects: number;
  onTrackProjects: number;
  overdueDeliveries: number;
  /** Open tasks relative to the busiest PM, 0-100, or null when nobody carries any. */
  loadPercent: string | null;
  /** Open tasks per active project — the "spread thin vs deep" read. */
  tasksPerProject: number | null;
  /** Share of this PM's projects that are not On Track. */
  troubledPercent: string | null;
}

@Injectable()
export class ProjectManagementDashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly kickoffs: ProjectKickoffService,
  ) {}

  async build(now = new Date()) {
    // The shared health builder, company-wide. Filtered to the projects a PM
    // Head can still act on: dispatched and cancelled projects are history.
    const allProgress = await this.kickoffs.progressCompanyWide();
    const progress = allProgress.filter((project) => {
      const stage = (key: string) =>
        project.stages.find((entry) => entry.key === key)?.state;
      return (
        stage(ACTIVE_KICKOFF_STAGE_EXCLUSIONS.dispatchComplete) !== 'COMPLETE' &&
        stage(ACTIVE_KICKOFF_STAGE_EXCLUSIONS.orderCancelled) !== 'ATTENTION'
      );
    });
    const kickoffIds = progress.map((project) => project.kickoffId);

    const [loaded, awaitingKickoff, pings] = await Promise.all([
      this.loadKickoffs(kickoffIds),
      this.loadAwaitingKickoff(),
      this.loadProjectPings(kickoffIds),
    ]);

    const progressById = new Map(
      progress.map((project) => [project.kickoffId, project]),
    );
    // The health builder is the single gate on what counts as active, so every
    // section below sees exactly the projects it kept — a row without a health
    // view is a finished project and must not leak into a milestone or risk count.
    const rows = loaded.filter((row) => progressById.has(row.id));
    const projects = rows
      .map((row) => this.toProject(row, progressById.get(row.id), now))
      .sort(
        (left, right) =>
          HEALTH_RANK[left.health] - HEALTH_RANK[right.health] ||
          (left.daysUntilDue ?? Number.POSITIVE_INFINITY) -
            (right.daysUntilDue ?? Number.POSITIVE_INFINITY),
      );

    return {
      asOf: now,
      basis: [
        'Project health, its reason and the seven-stage ladder are ProjectKickoffService.progressCompanyWide() — the same builder behind every PM’s own dashboard and the Operations dashboard, so a badge cannot disagree between pages.',
        'Overdue milestones, incomplete action items and open high-impact risks use the shared kickoff-work-items predicates that feed that same health calculation, so a project’s badge and its underlying counts always agree.',
        'The promised delivery date is the latest EXECUTED confirmation sheet revision — the identical source and whole-day clock PLM rows and the Operations dashboard tier against.',
        'PM attribution is the ProjectKickoff.createdBy assignment, the only per-project PM the schema records.',
        `Delivered and cancelled projects are excluded: ${allProgress.length} project(s) exist company-wide, ${progress.length} still need management.`,
        'Project and delivery data only — no revenue, margin, customer or purchasing figure is read.',
      ],
      portfolio: this.portfolio(projects, allProgress, now),
      projects,
      blockers: this.blockers(rows, projects, now),
      delivery: this.delivery(projects, now),
      workload: this.workload(rows, projects, now),
      awaitingKickoff: this.awaitingKickoff(awaitingKickoff, now),
      ordersAwaitingDelivery: this.ordersAwaitingDelivery(projects),
      milestones: this.milestones(rows, now),
      actionItems: this.actionItems(rows, now),
      risks: this.risks(rows),
      pings: this.pings(pings, rows, now),
    };
  }

  // ── Loaders ───────────────────────────────────────────────────────────────

  private loadKickoffs(kickoffIds: string[]) {
    return this.prisma.projectKickoff.findMany({
      where: { id: { in: kickoffIds } },
      select: {
        id: true,
        projectName: true,
        meetingDate: true,
        createdAt: true,
        createdById: true,
        createdBy: { select: { firstName: true, lastName: true } },
        order: {
          select: {
            id: true,
            orderNumber: true,
            fulfilmentStatus: true,
            // Identical projection to PlmService's promised-date read: EXECUTED
            // only, highest revision. Ordering by createdAt instead would let
            // this page pick a different sheet than the PLM rows do.
            confirmationSheets: {
              where: { status: 'EXECUTED' as const },
              orderBy: { revisionNumber: 'desc' as const },
              take: 1,
              select: { deliveryDate: true },
            },
            lineItems: { select: { id: true } },
          },
        },
        milestones: {
          select: {
            id: true,
            name: true,
            targetDate: true,
            status: true,
            owner: { select: { firstName: true, lastName: true } },
          },
          orderBy: { targetDate: 'asc' },
        },
        actionItems: {
          select: {
            id: true,
            description: true,
            dueDate: true,
            owner: { select: { firstName: true, lastName: true } },
            kanbanCard: {
              select: {
                status: true,
                list: { select: { name: true, isDoneList: true } },
              },
            },
          },
          orderBy: { dueDate: 'asc' },
        },
        risks: {
          select: {
            id: true,
            description: true,
            likelihood: true,
            impact: true,
            status: true,
            mitigationPlan: true,
            owner: { select: { firstName: true, lastName: true } },
          },
        },
        kanbanBoard: {
          select: {
            id: true,
            lists: {
              select: {
                isDoneList: true,
                cards: {
                  where: { status: 'ACTIVE' as const },
                  select: { id: true, dueDate: true, assigneeId: true },
                },
              },
            },
          },
        },
      },
    });
  }

  /**
   * Orders that qualify for a kickoff but have none. Both doors into a project:
   * an executed customer confirmation sheet, or a confirmed Internal order
   * (which never gets an OCS).
   */
  private loadAwaitingKickoff() {
    return this.prisma.order.findMany({
      where: {
        projectKickoffs: { none: {} },
        status: { not: OrderStatus.CANCELLED },
        OR: [
          { orderType: OrderType.INTERNAL, status: OrderStatus.CONFIRMED },
          { confirmationSheets: { some: { status: 'EXECUTED' } } },
        ],
      },
      select: {
        id: true,
        orderNumber: true,
        orderType: true,
        status: true,
        createdAt: true,
        lineItems: { select: { id: true } },
        confirmationSheets: {
          where: { status: 'EXECUTED' },
          orderBy: { revisionNumber: 'desc' },
          take: 1,
          select: { deliveryDate: true, updatedAt: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Unresolved pings hanging off any record that belongs to a project.
   *
   * Deliberately wider than the kickoff record itself: a ping raised on the
   * project's order or one of its PLM trackers is every bit as much an
   * unanswered project question, and scoping to PROJECT_KICKOFF alone silently
   * hid most of them. `PAGE` links are excluded — a URL is not a record.
   */
  private async loadProjectPings(kickoffIds: string[]) {
    if (kickoffIds.length === 0) return [];
    // Build the record → project index first: a ping only says which record it
    // hangs off, so the mapping back to a project (and therefore a PM) has to
    // come from the project's own record ids.
    const [links, trackers] = await Promise.all([
      this.prisma.projectKickoff.findMany({
        where: { id: { in: kickoffIds } },
        select: { id: true, orderId: true, kanbanBoardId: true },
      }),
      this.prisma.plmTracker.findMany({
        where: { kickoffId: { in: kickoffIds } },
        select: { id: true, kickoffId: true },
      }),
    ]);
    const kickoffByLink = new Map<string, string>();
    for (const kickoff of links) {
      kickoffByLink.set(`PROJECT_KICKOFF:${kickoff.id}`, kickoff.id);
      kickoffByLink.set(`ORDER:${kickoff.orderId}`, kickoff.id);
      kickoffByLink.set(`KANBAN_BOARD:${kickoff.kanbanBoardId}`, kickoff.id);
    }
    for (const tracker of trackers) {
      kickoffByLink.set(`PLM_TRACKER:${tracker.id}`, tracker.kickoffId);
    }

    const linkedIds = Array.from(
      new Set(
        Array.from(kickoffByLink.keys()).map((key) =>
          key.slice(key.indexOf(':') + 1),
        ),
      ),
    );
    const pings = await this.prisma.ping.findMany({
      where: {
        linkedRecordType: {
          in: ['PROJECT_KICKOFF', 'ORDER', 'PLM_TRACKER', 'KANBAN_BOARD'],
        },
        linkedRecordId: { in: linkedIds },
        recipients: {
          some: { status: { not: PingRecipientStatus.RESOLVED } },
        },
      },
      select: {
        id: true,
        message: true,
        linkedRecordType: true,
        linkedRecordId: true,
        createdAt: true,
        fromEmployee: { select: { firstName: true, lastName: true } },
        recipients: {
          where: { status: { not: PingRecipientStatus.RESOLVED } },
          select: {
            status: true,
            employee: { select: { firstName: true, lastName: true } },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
    return pings
      .map((ping) => ({
        ...ping,
        kickoffId:
          kickoffByLink.get(
            `${ping.linkedRecordType}:${ping.linkedRecordId}`,
          ) ?? null,
      }))
      .filter((ping) => ping.kickoffId !== null);
  }

  // ── Section builders ──────────────────────────────────────────────────────

  /** §1 One row per project, health from the shared builder, PM attributed. */
  private toProject(
    row: KickoffRow,
    health: ProjectProgressView | undefined,
    now: Date,
  ) {
    const promised = row.order.confirmationSheets[0]?.deliveryDate ?? null;
    const openMilestones = row.milestones.filter(
      (milestone) => milestone.status !== 'COMPLETED',
    );
    const openActionItems = row.actionItems.filter((item) =>
      isActionItemOpen(deriveActionItemStatus(item.kanbanCard)),
    );
    const openCards = boardCards(row);
    return {
      kickoffId: row.id,
      projectName: row.projectName,
      orderId: row.order.id,
      orderNumber: row.order.orderNumber,
      pmId: row.createdById,
      pm: personName(row.createdBy),
      health: (health?.health ?? 'ON_TRACK') as ProjectHealth,
      healthReason: health?.healthReason ?? 'No active blockers',
      currentStage: health?.currentStage ?? 'order',
      stages: (health?.stages ?? []).map((stage) => ({
        key: stage.key,
        label: stage.label,
        state: stage.state,
        detail: stage.detail,
      })),
      /** Whole days of project age — how long this has been somebody's problem. */
      ageDays: daysBetween(row.meetingDate, now),
      promisedDeliveryDate: promised,
      /** Same whole-day clock the PLM rows use; null when no OCS date exists. */
      daysUntilDue: promised ? wholeDaysUntil(promised, now) : null,
      fulfilmentStatus: row.order.fulfilmentStatus,
      lineCount: row.order.lineItems.length,
      openMilestones: openMilestones.length,
      overdueMilestones: row.milestones.filter((milestone) =>
        isMilestoneOverdue(milestone, now),
      ).length,
      openActionItems: openActionItems.length,
      overdueActionItems: row.actionItems.filter((item) =>
        isActionItemOverdue(item, now),
      ).length,
      openHighRisks: row.risks.filter((risk) => isRiskHighImpactOpen(risk))
        .length,
      openTasks: openCards.open.length,
      overdueTasks: openCards.overdue(now).length,
      nextMilestone: openMilestones[0]
        ? {
            name: openMilestones[0].name,
            targetDate: openMilestones[0].targetDate,
            owner: personName(openMilestones[0].owner),
            overdue: isMilestoneOverdue(openMilestones[0], now),
          }
        : null,
    };
  }

  /**
   * The portfolio band: health split, where projects sit on the seven-stage
   * ladder, and how old the active set is. This is the aggregate the named
   * lists below are ranked against.
   */
  private portfolio(
    projects: Array<ReturnType<ProjectManagementDashboardService['toProject']>>,
    allProgress: ProjectProgressView[],
    now: Date,
  ) {
    const health = countHealth(projects.map((project) => project.health));
    // The stage ladder and its labels come from the shared builder's own stage
    // list, so this page can never invent or reorder a stage.
    const stageOrder = allProgress[0]?.stages.map((stage) => stage.key) ?? [];
    const stageLabels = new Map(
      allProgress[0]?.stages.map((stage) => [stage.key, stage.label]) ?? [],
    );
    const stages = stageOrder.map((key) => {
      const atStage = projects.filter(
        (project) => project.currentStage === key,
      );
      return {
        key,
        label: stageLabels.get(key) ?? key,
        count: atStage.length,
        blocked: atStage.filter((project) => project.health === 'BLOCKED')
          .length,
        atRisk: atStage.filter((project) => project.health === 'AT_RISK').length,
        percentOfActive: ratePercent(atStage.length, projects.length),
      };
    });
    return {
      activeTotal: projects.length,
      totalEverStarted: allProgress.length,
      ...health,
      troubledPercent: ratePercent(
        health.atRisk + health.blocked,
        health.total,
      ),
      /** How long active projects have been running — a stalling portfolio ages. */
      averageAgeDays: average(projects.map((project) => project.ageDays)),
      ageBuckets: bucketAges(projects.map((project) => project.ageDays)),
      stages,
      /** The single project a PM Head should look at first, and why. */
      worst:
        projects.find(
          (project) =>
            project.health === 'BLOCKED' &&
            project.daysUntilDue !== null &&
            project.daysUntilDue < 0,
        ) ??
        projects.find((project) => project.health === 'BLOCKED') ??
        null,
      pmCount: new Set(projects.map((project) => project.pmId)).size,
      note:
        projects.length === 0
          ? 'No project is currently in flight: every kickoff is either fully dispatched or cancelled.'
          : null,
      asOf: now,
    };
  }

  /**
   * §2 Every blocker as one actionable row: project, PM, the specific reason,
   * and who owns clearing it. Sorted so the deepest-overdue items lead.
   */
  private blockers(
    rows: KickoffRow[],
    projects: Array<ReturnType<ProjectManagementDashboardService['toProject']>>,
    now: Date,
  ) {
    const projectById = new Map(
      projects.map((project) => [project.kickoffId, project]),
    );
    const entries = rows.flatMap((row) => {
      const project = projectById.get(row.id);
      if (!project) return [];
      const base = {
        kickoffId: row.id,
        project: row.projectName,
        orderNumber: row.order.orderNumber,
        pm: personName(row.createdBy),
        pmId: row.createdById,
      };
      return [
        // The health reason itself, when the shared builder found a system-level
        // blocker (failed inspection, cancelled order, overdue vendor update)
        // that isn't any single milestone or action item.
        ...(project.health === 'BLOCKED'
          ? [
              {
                ...base,
                kind: 'HEALTH' as const,
                blocker: project.healthReason,
                owner: base.pm,
                ownerIsPm: true,
                overdueDays: null as number | null,
                severity: 'BLOCKED' as const,
              },
            ]
          : []),
        ...row.milestones
          .filter((milestone) => isMilestoneOverdue(milestone, now))
          .map((milestone) => ({
            ...base,
            kind: 'MILESTONE' as const,
            blocker: `Milestone: ${milestone.name}`,
            owner: personName(milestone.owner) ?? 'Unassigned',
            ownerIsPm: false,
            overdueDays: Math.max(daysBetween(milestone.targetDate, now), 0),
            severity: 'AT_RISK' as const,
          })),
        ...row.actionItems
          .filter((item) => isActionItemOverdue(item, now))
          .map((item) => ({
            ...base,
            kind: 'ACTION_ITEM' as const,
            blocker: `Action: ${item.description}`,
            owner: personName(item.owner) ?? 'Unassigned',
            ownerIsPm: false,
            overdueDays: item.dueDate
              ? Math.max(daysBetween(item.dueDate, now), 0)
              : null,
            severity: 'AT_RISK' as const,
          })),
        ...row.risks
          .filter((risk) => isRiskHighImpactOpen(risk))
          .map((risk) => ({
            ...base,
            kind: 'RISK' as const,
            blocker: `Risk: ${risk.description}`,
            owner: personName(risk.owner) ?? 'Unassigned',
            ownerIsPm: false,
            overdueDays: null as number | null,
            severity: risk.mitigationPlan
              ? ('AT_RISK' as const)
              : ('BLOCKED' as const),
          })),
      ];
    });
    entries.sort(
      (left, right) =>
        SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity] ||
        (right.overdueDays ?? -1) - (left.overdueDays ?? -1),
    );

    // Who to call, ranked. The point of the section: one name, N blockers.
    const byOwner = new Map<string, { owner: string; count: number; projects: Set<string> }>();
    for (const entry of entries) {
      const current =
        byOwner.get(entry.owner) ??
        { owner: entry.owner, count: 0, projects: new Set<string>() };
      current.count += 1;
      current.projects.add(entry.project);
      byOwner.set(entry.owner, current);
    }
    return {
      total: entries.length,
      projectsAffected: new Set(entries.map((entry) => entry.kickoffId)).size,
      unassigned: entries.filter((entry) => entry.owner === 'Unassigned').length,
      byKind: (['HEALTH', 'MILESTONE', 'ACTION_ITEM', 'RISK'] as const).map(
        (kind) => ({
          kind,
          label: BLOCKER_KIND_LABEL[kind],
          count: entries.filter((entry) => entry.kind === kind).length,
        }),
      ),
      owners: Array.from(byOwner.values())
        .map((owner) => ({
          owner: owner.owner,
          count: owner.count,
          projectCount: owner.projects.size,
          sharePercent: ratePercent(owner.count, entries.length),
        }))
        .sort((left, right) => right.count - left.count)
        .slice(0, NAMED_ROW_LIMIT),
      entries: entries.slice(0, NAMED_ROW_LIMIT * 3),
      note:
        entries.length === 0
          ? 'Nothing is blocked: no overdue milestone, no overdue action item and no open high-impact risk across the active portfolio.'
          : null,
    };
  }

  /**
   * §3 Delivery-date progress. The tiering itself is left to the shared
   * delivery-urgency scale on the client (the one the PLM rows use); this
   * returns the raw `daysUntilDue` per project plus the per-PM breakdown, which
   * is the part Operations does not have.
   */
  private delivery(
    projects: Array<ReturnType<ProjectManagementDashboardService['toProject']>>,
    now: Date,
  ) {
    const dated = projects.filter((project) => project.daysUntilDue !== null);
    const overdue = dated.filter((project) => project.daysUntilDue! < 0);
    return {
      measured: dated.length,
      /** Projects with no EXECUTED delivery date — reported, never assumed fine. */
      unconfirmed: projects.length - dated.length,
      overdue: overdue.length,
      overduePercent: ratePercent(overdue.length, dated.length),
      averageOverrunDays: average(
        overdue.map((project) => Math.abs(project.daysUntilDue!)),
      ),
      rows: projects.map((project) => ({
        kickoffId: project.kickoffId,
        projectName: project.projectName,
        orderNumber: project.orderNumber,
        pm: project.pm,
        pmId: project.pmId,
        health: project.health,
        currentStage: project.currentStage,
        promisedDeliveryDate: project.promisedDeliveryDate,
        daysUntilDue: project.daysUntilDue,
        fulfilmentStatus: project.fulfilmentStatus,
      })),
      note:
        dated.length === 0
          ? 'No active project has an executed confirmation sheet delivery date yet, so delivery progress cannot be judged.'
          : null,
      asOf: now,
    };
  }

  /**
   * §4 Workload per PM — the redistribution view. Open tasks come from the
   * project board's non-done lists (the board the PM runs), and the same PM's
   * project health is folded in, because "12 tasks across 5 blocked projects"
   * is a heavier load than "40 tasks across 3 healthy ones".
   */
  private workload(
    rows: KickoffRow[],
    projects: Array<ReturnType<ProjectManagementDashboardService['toProject']>>,
    now: Date,
  ) {
    const byPm = new Map<string, PmWorkloadRow>();
    const projectById = new Map(
      projects.map((project) => [project.kickoffId, project]),
    );
    for (const row of rows) {
      const project = projectById.get(row.id);
      if (!project) continue;
      const cards = boardCards(row);
      const current: PmWorkloadRow =
        byPm.get(row.createdById) ??
        {
          pmId: row.createdById,
          pm: personName(row.createdBy),
          activeProjects: 0,
          openTasks: 0,
          overdueTasks: 0,
          unassignedTasks: 0,
          openMilestones: 0,
          overdueMilestones: 0,
          openActionItems: 0,
          overdueActionItems: 0,
          openHighRisks: 0,
          blockedProjects: 0,
          atRiskProjects: 0,
          onTrackProjects: 0,
          overdueDeliveries: 0,
          loadPercent: null,
          tasksPerProject: null,
          troubledPercent: null,
        };
      current.activeProjects += 1;
      current.openTasks += cards.open.length;
      current.overdueTasks += cards.overdue(now).length;
      current.unassignedTasks += cards.open.filter(
        (card) => card.assigneeId === null,
      ).length;
      current.openMilestones += project.openMilestones;
      current.overdueMilestones += project.overdueMilestones;
      current.openActionItems += project.openActionItems;
      current.overdueActionItems += project.overdueActionItems;
      current.openHighRisks += project.openHighRisks;
      if (project.health === 'BLOCKED') current.blockedProjects += 1;
      else if (project.health === 'AT_RISK') current.atRiskProjects += 1;
      else current.onTrackProjects += 1;
      if (project.daysUntilDue !== null && project.daysUntilDue < 0) {
        current.overdueDeliveries += 1;
      }
      byPm.set(row.createdById, current);
    }

    const pms = Array.from(byPm.values());
    const peakTasks = Math.max(0, ...pms.map((pm) => pm.openTasks));
    for (const pm of pms) {
      pm.loadPercent = relativeLoadPercent(pm.openTasks, peakTasks);
      pm.tasksPerProject =
        pm.activeProjects > 0
          ? Math.round((pm.openTasks / pm.activeProjects) * 10) / 10
          : null;
      pm.troubledPercent = ratePercent(
        pm.blockedProjects + pm.atRiskProjects,
        pm.activeProjects,
      );
    }
    pms.sort(
      (left, right) =>
        right.openTasks - left.openTasks ||
        right.activeProjects - left.activeProjects,
    );

    return {
      pmCount: pms.length,
      totalOpenTasks: pms.reduce((sum, pm) => sum + pm.openTasks, 0),
      peakOpenTasks: peakTasks,
      /** 0 = evenly spread, 100 = one PM carries everything. Null under 2 PMs. */
      taskImbalancePercent: imbalancePercent(pms.map((pm) => pm.openTasks)),
      projectImbalancePercent: imbalancePercent(
        pms.map((pm) => pm.activeProjects),
      ),
      averageTasksPerPm: average(pms.map((pm) => pm.openTasks)),
      averageProjectsPerPm: average(pms.map((pm) => pm.activeProjects)),
      rows: pms,
      note:
        pms.length < 2
          ? 'Workload imbalance needs at least two project managers to mean anything; only one currently carries active projects.'
          : null,
    };
  }

  /**
   * §5 Orders that qualify for a kickoff and have none. Age is the signal: a
   * qualifying order sitting for weeks means delivery is already slipping
   * before any work has been scheduled.
   */
  private awaitingKickoff(
    orders: Awaited<
      ReturnType<ProjectManagementDashboardService['loadAwaitingKickoff']>
    >,
    now: Date,
  ) {
    const rows = orders.map((order) => {
      // Qualification starts when the OCS was executed, or at order creation
      // for an Internal order that never gets one.
      const qualifiedAt =
        order.confirmationSheets[0]?.updatedAt ?? order.createdAt;
      const promised = order.confirmationSheets[0]?.deliveryDate ?? null;
      return {
        id: order.id,
        orderNumber: order.orderNumber,
        orderType: order.orderType,
        source:
          order.orderType === OrderType.INTERNAL
            ? ('INTERNAL_CONFIRMED' as const)
            : ('OCS_EXECUTED' as const),
        lineCount: order.lineItems.length,
        qualifiedAt,
        waitingDays: Math.max(daysBetween(qualifiedAt, now), 0),
        promisedDeliveryDate: promised,
        /** Already promised to the customer while not yet even started. */
        daysUntilDue: promised ? wholeDaysUntil(promised, now) : null,
      };
    });
    rows.sort((left, right) => right.waitingDays - left.waitingDays);
    return {
      total: rows.length,
      /** Promised date already passed with no kickoff at all — the worst case. */
      alreadyOverdue: rows.filter(
        (row) => row.daysUntilDue !== null && row.daysUntilDue < 0,
      ).length,
      averageWaitingDays: average(rows.map((row) => row.waitingDays)),
      ageBuckets: bucketAges(rows.map((row) => row.waitingDays)),
      rows: rows.slice(0, NAMED_ROW_LIMIT * 2),
      note:
        rows.length === 0
          ? 'Every qualifying order has a kickoff: nothing is waiting to start.'
          : null,
    };
  }

  /** §6 Portfolio size still to deliver, by fulfilment state. */
  private ordersAwaitingDelivery(
    projects: Array<ReturnType<ProjectManagementDashboardService['toProject']>>,
  ) {
    const outstanding = projects.filter(
      (project) => project.fulfilmentStatus !== 'FULLY_DISPATCHED',
    );
    const byStatus = new Map<string, number>();
    for (const project of outstanding) {
      byStatus.set(
        project.fulfilmentStatus,
        (byStatus.get(project.fulfilmentStatus) ?? 0) + 1,
      );
    }
    return {
      total: outstanding.length,
      lineCount: outstanding.reduce(
        (sum, project) => sum + project.lineCount,
        0,
      ),
      byStatus: Array.from(byStatus.entries())
        .map(([status, count]) => ({
          status,
          label: titleCase(status),
          count,
          percentOfOutstanding: ratePercent(count, outstanding.length),
        }))
        .sort((left, right) => right.count - left.count),
      rows: outstanding.map((project) => ({
        orderId: project.orderId,
        orderNumber: project.orderNumber,
        projectName: project.projectName,
        pm: project.pm,
        pmId: project.pmId,
        fulfilmentStatus: project.fulfilmentStatus,
        lineCount: project.lineCount,
        daysUntilDue: project.daysUntilDue,
      })),
      note:
        outstanding.length === 0
          ? 'Every active project’s order is fully dispatched.'
          : 'Counted from the order’s own fulfilment rollup, so this matches the order list rather than recounting line dispatch state here.',
    };
  }

  /** §7a Milestones, with the slip distribution rather than only a list. */
  private milestones(rows: KickoffRow[], now: Date) {
    const all = rows.flatMap((row) =>
      row.milestones.map((milestone) => ({
        id: milestone.id,
        kickoffId: row.id,
        project: row.projectName,
        pm: personName(row.createdBy),
        pmId: row.createdById,
        name: milestone.name,
        status: milestone.status,
        targetDate: milestone.targetDate,
        owner: personName(milestone.owner) ?? 'Unassigned',
        overdue: isMilestoneOverdue(milestone, now),
        overdueDays: Math.max(daysBetween(milestone.targetDate, now), 0),
        /** Flagged as slipping by a PM, distinct from simply being past due. */
        flaggedDelayed: milestone.status === 'DELAYED',
      })),
    );
    const open = all.filter((milestone) => milestone.status !== 'COMPLETED');
    const overdue = all.filter((milestone) => milestone.overdue);
    overdue.sort((left, right) => right.overdueDays - left.overdueDays);
    return {
      total: all.length,
      completed: all.filter((milestone) => milestone.status === 'COMPLETED')
        .length,
      open: open.length,
      overdue: overdue.length,
      flaggedDelayed: all.filter((milestone) => milestone.flaggedDelayed).length,
      completionPercent: ratePercent(
        all.filter((milestone) => milestone.status === 'COMPLETED').length,
        all.length,
      ),
      overdueOfOpenPercent: ratePercent(overdue.length, open.length),
      averageSlipDays: average(
        overdue.map((milestone) => milestone.overdueDays),
      ),
      slipBuckets: bucketAges(overdue.map((milestone) => milestone.overdueDays)),
      /** Nearest open milestones company-wide — the "what lands next" read. */
      upcoming: open
        .filter((milestone) => !milestone.overdue)
        .sort(
          (left, right) =>
            left.targetDate.getTime() - right.targetDate.getTime(),
        )
        .slice(0, NAMED_ROW_LIMIT)
        .map((milestone) => ({
          ...milestone,
          daysUntilDue: wholeDaysUntil(milestone.targetDate, now),
        })),
      rows: overdue.slice(0, NAMED_ROW_LIMIT * 2),
      note:
        all.length === 0
          ? 'No milestone has been set on any active project, so milestone health cannot be judged.'
          : null,
    };
  }

  /**
   * §7b Action items. The status is the shared card-derived one, so ARCHIVED
   * and UNLINKED items are reported separately instead of being silently
   * counted as open work that nobody is doing.
   */
  private actionItems(rows: KickoffRow[], now: Date) {
    const all = rows.flatMap((row) =>
      row.actionItems.map((item) => {
        const status = deriveActionItemStatus(item.kanbanCard);
        return {
          id: item.id,
          kickoffId: row.id,
          project: row.projectName,
          pm: personName(row.createdBy),
          pmId: row.createdById,
          description: item.description,
          owner: personName(item.owner) ?? 'Unassigned',
          dueDate: item.dueDate,
          status,
          open: isActionItemOpen(status),
          overdue: isActionItemOverdue(item, now),
          overdueDays: item.dueDate
            ? Math.max(daysBetween(item.dueDate, now), 0)
            : null,
        };
      }),
    );
    const open = all.filter((item) => item.open);
    const overdue = all.filter((item) => item.overdue);
    overdue.sort(
      (left, right) => (right.overdueDays ?? 0) - (left.overdueDays ?? 0),
    );
    return {
      total: all.length,
      open: open.length,
      overdue: overdue.length,
      done: all.filter((item) => item.status === 'DONE').length,
      /** No due date set — open, but never counted as late. */
      undated: open.filter((item) => item.dueDate === null).length,
      /** Card archived or deleted: the item has no live status to act on. */
      withoutLiveStatus: all.filter(
        (item) => item.status === 'ARCHIVED' || item.status === 'UNLINKED',
      ).length,
      completionPercent: ratePercent(
        all.filter((item) => item.status === 'DONE').length,
        all.length,
      ),
      overdueOfOpenPercent: ratePercent(overdue.length, open.length),
      averageSlipDays: average(
        overdue.map((item) => item.overdueDays ?? 0),
      ),
      byStatus: (
        ['TODO', 'IN_PROGRESS', 'DONE', 'ARCHIVED', 'UNLINKED'] as const
      ).map((status) => ({
        status,
        label: titleCase(status),
        count: all.filter((item) => item.status === status).length,
      })),
      rows: overdue.slice(0, NAMED_ROW_LIMIT * 2),
      note:
        all.length === 0
          ? 'No action item has been raised on any active project.'
          : 'Status is derived from each item’s linked Kanban card, so an archived or deleted card is reported as having no live status rather than counted as open work.',
    };
  }

  /** §8 The open risk register, ranked by the likelihood/impact matrix. */
  private risks(rows: KickoffRow[]) {
    const all = rows.flatMap((row) =>
      row.risks.map((risk) => ({
        id: risk.id,
        kickoffId: row.id,
        project: row.projectName,
        pm: personName(row.createdBy),
        pmId: row.createdById,
        description: risk.description,
        likelihood: risk.likelihood,
        impact: risk.impact,
        status: risk.status,
        owner: personName(risk.owner) ?? 'Unassigned',
        hasMitigation: Boolean(risk.mitigationPlan?.trim()),
        highImpactOpen: isRiskHighImpactOpen(risk),
        severity: RISK_SEVERITY[risk.impact] + RISK_SEVERITY[risk.likelihood],
      })),
    );
    const open = all.filter((risk) => risk.status === 'OPEN');
    const highImpactOpen = all.filter((risk) => risk.highImpactOpen);
    highImpactOpen.sort((left, right) => right.severity - left.severity);
    const matrix = (['HIGH', 'MEDIUM', 'LOW'] as const).flatMap((impact) =>
      (['HIGH', 'MEDIUM', 'LOW'] as const).map((likelihood) => ({
        impact,
        likelihood,
        count: open.filter(
          (risk) => risk.impact === impact && risk.likelihood === likelihood,
        ).length,
      })),
    );
    return {
      total: all.length,
      open: open.length,
      highImpactOpen: highImpactOpen.length,
      /** Open, severe, and nobody has written a plan — the real exposure. */
      unmitigated: highImpactOpen.filter((risk) => !risk.hasMitigation).length,
      unmitigatedPercent: ratePercent(
        highImpactOpen.filter((risk) => !risk.hasMitigation).length,
        highImpactOpen.length,
      ),
      projectsAffected: new Set(highImpactOpen.map((risk) => risk.kickoffId))
        .size,
      matrix,
      rows: highImpactOpen.slice(0, NAMED_ROW_LIMIT * 2),
      note:
        open.length === 0
          ? 'The risk register is clear across every active project.'
          : 'Severe means HIGH on either axis of the likelihood/impact matrix — the same test the project health badge uses.',
    };
  }

  /**
   * §9 Unresolved project-linked pings. Age is measured in hours against the
   * app-wide 24h escalation boundary, the same scale the Pings inbox and the
   * pending-approval badges use.
   */
  private pings(
    pings: Awaited<
      ReturnType<ProjectManagementDashboardService['loadProjectPings']>
    >,
    rows: KickoffRow[],
    now: Date,
  ) {
    const projectById = new Map(
      rows.map((row) => [
        row.id,
        { name: row.projectName, pm: personName(row.createdBy), pmId: row.createdById },
      ]),
    );
    const entries = pings
      .map((ping) => {
        const project = projectById.get(ping.kickoffId!);
        const ageHours = Math.max(
          Math.floor((now.getTime() - ping.createdAt.getTime()) / 3_600_000),
          0,
        );
        return {
          id: ping.id,
          kickoffId: ping.kickoffId!,
          project: project?.name ?? 'Unknown project',
          pm: project?.pm ?? 'Unassigned',
          pmId: project?.pmId ?? null,
          message: ping.message,
          from: personName(ping.fromEmployee),
          linkedRecordType: ping.linkedRecordType,
          linkedRecordId: ping.linkedRecordId,
          createdAt: ping.createdAt,
          ageHours,
          /** Nobody has even acknowledged it yet. */
          unacknowledged: ping.recipients.every(
            (recipient) => recipient.status === PingRecipientStatus.PENDING,
          ),
          owners: ping.recipients.map((recipient) =>
            personName(recipient.employee),
          ),
        };
      })
      .sort((left, right) => right.ageHours - left.ageHours);
    const byType = new Map<string, number>();
    for (const entry of entries) {
      const key = entry.linkedRecordType ?? 'UNKNOWN';
      byType.set(key, (byType.get(key) ?? 0) + 1);
    }
    return {
      total: entries.length,
      /** Past the shared 24h boundary — the original escalation this app tiers on. */
      pastEscalation: entries.filter(
        (entry) => entry.ageHours >= PING_AGING_AFTER_HOURS,
      ).length,
      escalationRatePercent: breachRate(
        entries.map((entry) => entry.ageHours),
        PING_AGING_AFTER_HOURS,
      ),
      unacknowledged: entries.filter((entry) => entry.unacknowledged).length,
      averageAgeHours: average(entries.map((entry) => entry.ageHours)),
      oldestAgeHours: entries[0]?.ageHours ?? null,
      projectsAffected: new Set(entries.map((entry) => entry.kickoffId)).size,
      byLinkedRecord: Array.from(byType.entries())
        .map(([type, count]) => ({
          type,
          label: titleCase(type),
          count,
        }))
        .sort((left, right) => right.count - left.count),
      rows: entries.slice(0, NAMED_ROW_LIMIT * 2),
      note:
        entries.length === 0
          ? 'No unresolved ping is linked to any active project record.'
          : 'Read from every record that belongs to a project — the kickoff, its order, its PLM trackers and its board — not the kickoff record alone.',
    };
  }
}

// ── Module-level helpers ────────────────────────────────────────────────────

const HEALTH_RANK: Record<ProjectHealth, number> = {
  BLOCKED: 0,
  AT_RISK: 1,
  ON_TRACK: 2,
};
const SEVERITY_RANK = { BLOCKED: 0, AT_RISK: 1 } as const;
const RISK_SEVERITY: Record<string, number> = { HIGH: 3, MEDIUM: 2, LOW: 1 };
const BLOCKER_KIND_LABEL = {
  HEALTH: 'Project-level',
  MILESTONE: 'Overdue milestone',
  ACTION_ITEM: 'Overdue action',
  RISK: 'Open severe risk',
} as const;

function personName(
  employee: { firstName: string; lastName: string } | null,
): string {
  if (!employee) return 'Unassigned';
  return `${employee.firstName} ${employee.lastName}`.trim() || 'Unassigned';
}

/** PARTIALLY_DISPATCHED → Partially Dispatched. */
function titleCase(value: string): string {
  return value
    .toLowerCase()
    .split('_')
    .map((word) => (word ? word[0].toUpperCase() + word.slice(1) : word))
    .join(' ');
}

/**
 * The project board's open cards: ACTIVE cards sitting in a list that isn't the
 * done list. Same definition the board itself uses for "not finished", so the
 * count here equals what the PM sees on their board.
 */
function boardCards(row: {
  kanbanBoard: {
    lists: Array<{
      isDoneList: boolean;
      cards: Array<{ id: string; dueDate: Date | null; assigneeId: string | null }>;
    }>;
  };
}) {
  const open = row.kanbanBoard.lists
    .filter((list) => !list.isDoneList)
    .flatMap((list) => list.cards);
  return {
    open,
    overdue: (now: Date) =>
      open.filter((card) => card.dueDate && card.dueDate.getTime() < now.getTime()),
  };
}
