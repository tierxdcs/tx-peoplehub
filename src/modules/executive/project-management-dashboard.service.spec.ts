import { PrismaService } from '../../core/database/prisma.service';
import { ProjectKickoffService } from '../project-kickoff/project-kickoff.service';
import { ProjectManagementDashboardService } from './project-management-dashboard.service';

const utc = (y: number, m: number, day = 1) =>
  new Date(Date.UTC(y, m - 1, day));
const NOW = utc(2026, 8, 25);

type Project = Awaited<
  ReturnType<ProjectKickoffService['progressCompanyWide']>
>[number];

const STAGES = [
  'order',
  'kickoff',
  'engineering',
  'procurement',
  'production',
  'quality',
  'dispatch',
] as const;

/** A progress view from the shared builder, with every lamp green but dispatch. */
const project = (over: Partial<Project> = {}): Project =>
  ({
    kickoffId: 'k-1',
    projectName: 'Kiosk rollout',
    orderId: 'o-1',
    orderNumber: 'SO-1',
    health: 'ON_TRACK',
    healthReason: 'All lamps green',
    currentStage: 'production',
    updatedAt: NOW.toISOString(),
    nextDueDate: null,
    stages: STAGES.map((key) => ({
      key,
      label: key,
      state: key === 'dispatch' ? 'UPCOMING' : 'COMPLETE',
      detail: '',
      href: '',
    })),
    ...over,
  }) as unknown as Project;

const stagesWith = (over: Partial<Record<string, string>>) =>
  STAGES.map((key) => ({
    key,
    label: key,
    state: over[key] ?? 'COMPLETE',
    detail: '',
    href: '',
  })) as unknown as Project['stages'];

const employee = (first: string, last = 'Rao') => ({
  firstName: first,
  lastName: last,
});

interface RowOptions {
  id?: string;
  projectName?: string;
  pmId?: string;
  pm?: string;
  orderId?: string;
  orderNumber?: string;
  fulfilmentStatus?: string;
  deliveryDate?: Date | null;
  lineCount?: number;
  meetingDate?: Date;
  milestones?: Array<Record<string, unknown>>;
  actionItems?: Array<Record<string, unknown>>;
  risks?: Array<Record<string, unknown>>;
  cards?: Array<{ id: string; dueDate?: Date | null; assigneeId?: string | null }>;
  doneCards?: number;
}

/** A kickoff row exactly as `loadKickoffs` projects it. */
const kickoffRow = (over: RowOptions = {}) => ({
  id: over.id ?? 'k-1',
  projectName: over.projectName ?? 'Kiosk rollout',
  meetingDate: over.meetingDate ?? utc(2026, 8, 15),
  createdAt: over.meetingDate ?? utc(2026, 8, 15),
  createdById: over.pmId ?? 'pm-1',
  createdBy: employee(over.pm ?? 'Asha'),
  order: {
    id: over.orderId ?? 'o-1',
    orderNumber: over.orderNumber ?? 'SO-1',
    fulfilmentStatus: over.fulfilmentStatus ?? 'NOT_DISPATCHED',
    confirmationSheets:
      over.deliveryDate === null
        ? []
        : [{ deliveryDate: over.deliveryDate ?? utc(2026, 9, 1) }],
    lineItems: Array.from({ length: over.lineCount ?? 2 }, (_, i) => ({
      id: `li-${i}`,
    })),
  },
  milestones: over.milestones ?? [],
  actionItems: over.actionItems ?? [],
  risks: over.risks ?? [],
  kanbanBoard: {
    id: `board-${over.id ?? 'k-1'}`,
    lists: [
      {
        isDoneList: false,
        cards: (over.cards ?? []).map((card) => ({
          id: card.id,
          dueDate: card.dueDate ?? null,
          assigneeId: 'assigneeId' in card ? card.assigneeId! : 'emp-1',
        })),
      },
      {
        isDoneList: true,
        cards: Array.from({ length: over.doneCards ?? 0 }, (_, i) => ({
          id: `done-${i}`,
          dueDate: null,
          assigneeId: 'emp-1',
        })),
      },
    ],
  },
});

const milestone = (over: Record<string, unknown> = {}) => ({
  id: 'ms-1',
  name: 'Design freeze',
  targetDate: utc(2026, 9, 10),
  status: 'PENDING',
  owner: employee('Vikram'),
  ...over,
});

const openCard = {
  status: 'ACTIVE',
  list: { name: 'In Progress', isDoneList: false },
};

const actionItem = (over: Record<string, unknown> = {}) => ({
  id: 'ai-1',
  description: 'Confirm enclosure spec',
  dueDate: utc(2026, 9, 5),
  owner: employee('Neha'),
  kanbanCard: openCard,
  ...over,
});

const risk = (over: Record<string, unknown> = {}) => ({
  id: 'rk-1',
  description: 'Single-source display panel',
  likelihood: 'MEDIUM',
  impact: 'HIGH',
  status: 'OPEN',
  mitigationPlan: null,
  owner: employee('Imran'),
  ...over,
});

interface Fixture {
  progress?: Project[];
  rows?: ReturnType<typeof kickoffRow>[];
  awaitingKickoff?: Array<Record<string, unknown>>;
  pings?: Array<Record<string, unknown>>;
  trackers?: Array<{ id: string; kickoffId: string }>;
}

function buildService(fixture: Fixture) {
  const rows = fixture.rows ?? [];
  const kickoffFindMany = jest.fn((args: { select?: Record<string, unknown> }) =>
    // Two different reads hit projectKickoff.findMany: the full row projection
    // and the ping link index. Discriminate on the projection, not call order.
    Promise.resolve(
      args.select?.projectName
        ? rows
        : rows.map((row) => ({
            id: row.id,
            orderId: row.order.id,
            kanbanBoardId: row.kanbanBoard.id,
          })),
    ),
  );
  const prisma = {
    projectKickoff: { findMany: kickoffFindMany },
    order: {
      findMany: jest.fn(() => Promise.resolve(fixture.awaitingKickoff ?? [])),
    },
    plmTracker: {
      findMany: jest.fn(() => Promise.resolve(fixture.trackers ?? [])),
    },
    ping: { findMany: jest.fn(() => Promise.resolve(fixture.pings ?? [])) },
  } as unknown as PrismaService;

  const kickoffs = {
    progressCompanyWide: jest.fn(() =>
      Promise.resolve(fixture.progress ?? rows.map((row) => project({ kickoffId: row.id }))),
    ),
  } as unknown as ProjectKickoffService;

  return {
    service: new ProjectManagementDashboardService(prisma, kickoffs),
    prisma,
    kickoffs,
    kickoffFindMany,
  };
}

describe('ProjectManagementDashboardService — reuse and scope', () => {
  it('takes health from the shared company-wide progress builder', async () => {
    const { service, kickoffs } = buildService({
      rows: [kickoffRow()],
      progress: [
        project({ health: 'BLOCKED', healthReason: 'Inspection failed' }),
      ],
    });
    const data = await service.build(NOW);
    expect(kickoffs.progressCompanyWide).toHaveBeenCalled();
    expect(data.projects[0].health).toBe('BLOCKED');
    expect(data.projects[0].healthReason).toBe('Inspection failed');
    expect(data.portfolio.blocked).toBe(1);
  });

  it('excludes dispatched and cancelled projects from the active portfolio', async () => {
    const { service } = buildService({
      rows: [
        kickoffRow({ id: 'live' }),
        kickoffRow({ id: 'done' }),
        kickoffRow({ id: 'cancelled' }),
      ],
      progress: [
        project({ kickoffId: 'live' }),
        project({ kickoffId: 'done', stages: stagesWith({}) }),
        project({
          kickoffId: 'cancelled',
          stages: stagesWith({ order: 'ATTENTION', dispatch: 'UPCOMING' }),
        }),
      ],
    });
    const data = await service.build(NOW);
    expect(data.portfolio.activeTotal).toBe(1);
    expect(data.portfolio.totalEverStarted).toBe(3);
    expect(data.projects.map((row) => row.kickoffId)).toEqual(['live']);
  });

  it('reads the promised date off the latest executed confirmation sheet', async () => {
    const { service, prisma } = buildService({ rows: [kickoffRow()] });
    await service.build(NOW);
    const args = (prisma.projectKickoff.findMany as jest.Mock).mock.calls.find(
      (call) => call[0].select?.projectName,
    )![0];
    const sheets = args.select.order.select.confirmationSheets;
    expect(sheets.where).toEqual({ status: 'EXECUTED' });
    expect(sheets.orderBy).toEqual({ revisionNumber: 'desc' });
    expect(sheets.take).toBe(1);
  });

  it('emits no sales, finance or SCM figure anywhere in the payload', async () => {
    const { service } = buildService({
      rows: [
        kickoffRow({
          milestones: [milestone()],
          actionItems: [actionItem()],
          risks: [risk()],
          cards: [{ id: 'c-1' }],
        }),
      ],
      awaitingKickoff: [
        {
          id: 'o-9',
          orderNumber: 'SO-9',
          orderType: 'CUSTOMER',
          status: 'CONFIRMED',
          createdAt: utc(2026, 8, 1),
          lineItems: [{ id: 'l-1' }],
          confirmationSheets: [
            { deliveryDate: utc(2026, 9, 1), updatedAt: utc(2026, 8, 5) },
          ],
        },
      ],
    });
    const data = await service.build(NOW);
    const keys = new Set<string>();
    const walk = (value: unknown) => {
      if (Array.isArray(value)) return value.forEach(walk);
      if (value && typeof value === 'object' && !(value instanceof Date)) {
        for (const [key, child] of Object.entries(value)) {
          keys.add(key);
          walk(child);
        }
      }
    };
    walk(data);
    const forbidden =
      /revenue|margin|invoice|receivable|payable|customer|vendor|supplier|rfq|purchaseOrder|amount|price|gst|tax/i;
    expect([...keys].filter((key) => forbidden.test(key))).toEqual([]);
  });
});

describe('ProjectManagementDashboardService — PM attribution', () => {
  it('names the assigned PM on every project, blocker, delivery and workload row', async () => {
    const { service } = buildService({
      rows: [
        kickoffRow({
          id: 'k-1',
          pmId: 'pm-1',
          pm: 'Asha',
          milestones: [milestone({ targetDate: utc(2026, 8, 1) })],
          cards: [{ id: 'c-1' }],
        }),
        kickoffRow({
          id: 'k-2',
          pmId: 'pm-2',
          pm: 'Bala',
          orderId: 'o-2',
          orderNumber: 'SO-2',
        }),
      ],
      progress: [project({ kickoffId: 'k-1' }), project({ kickoffId: 'k-2' })],
    });
    const data = await service.build(NOW);
    expect(data.projects.map((row) => row.pm).sort()).toEqual([
      'Asha Rao',
      'Bala Rao',
    ]);
    expect(data.blockers.entries[0].pm).toBe('Asha Rao');
    expect(data.delivery.rows.every((row) => Boolean(row.pm))).toBe(true);
    expect(data.workload.rows.map((row) => row.pm).sort()).toEqual([
      'Asha Rao',
      'Bala Rao',
    ]);
    expect(data.portfolio.pmCount).toBe(2);
  });
});

describe('ProjectManagementDashboardService — blockers', () => {
  it('lists each blocker with its project, specific reason and resolving owner', async () => {
    const { service } = buildService({
      rows: [
        kickoffRow({
          projectName: 'Kiosk rollout',
          milestones: [
            milestone({ name: 'Design freeze', targetDate: utc(2026, 8, 20) }),
          ],
          actionItems: [
            actionItem({
              description: 'Confirm enclosure spec',
              dueDate: utc(2026, 8, 10),
            }),
          ],
          risks: [risk({ description: 'Single-source panel', owner: null })],
        }),
      ],
      progress: [
        project({ health: 'BLOCKED', healthReason: 'Inspection failed' }),
      ],
    });
    const data = await service.build(NOW);
    expect(data.blockers.total).toBe(4);
    expect(data.blockers.projectsAffected).toBe(1);
    const byKind = Object.fromEntries(
      data.blockers.byKind.map((entry) => [entry.kind, entry.count]),
    );
    expect(byKind).toEqual({
      HEALTH: 1,
      MILESTONE: 1,
      ACTION_ITEM: 1,
      RISK: 1,
    });
    const milestoneRow = data.blockers.entries.find(
      (entry) => entry.kind === 'MILESTONE',
    )!;
    expect(milestoneRow.project).toBe('Kiosk rollout');
    expect(milestoneRow.blocker).toBe('Milestone: Design freeze');
    expect(milestoneRow.owner).toBe('Vikram Rao');
    expect(milestoneRow.overdueDays).toBe(5);
    // A risk with no owner is reported as unassigned rather than dropped.
    expect(data.blockers.unassigned).toBe(1);
    expect(data.blockers.owners[0].count).toBeGreaterThan(0);
  });

  it('says so plainly when nothing is blocked', async () => {
    const { service } = buildService({ rows: [kickoffRow()] });
    const data = await service.build(NOW);
    expect(data.blockers.total).toBe(0);
    expect(data.blockers.note).toContain('Nothing is blocked');
  });
});

describe('ProjectManagementDashboardService — delivery', () => {
  it('counts overdue against the promised date and reports unconfirmed separately', async () => {
    const { service } = buildService({
      rows: [
        kickoffRow({ id: 'late', deliveryDate: utc(2026, 8, 20) }),
        kickoffRow({ id: 'soon', deliveryDate: utc(2026, 8, 27) }),
        kickoffRow({ id: 'blank', deliveryDate: null }),
      ],
      progress: STAGES.length
        ? [
            project({ kickoffId: 'late' }),
            project({ kickoffId: 'soon' }),
            project({ kickoffId: 'blank' }),
          ]
        : [],
    });
    const data = await service.build(NOW);
    expect(data.delivery.measured).toBe(2);
    expect(data.delivery.unconfirmed).toBe(1);
    expect(data.delivery.overdue).toBe(1);
    expect(data.delivery.overduePercent).toBe('50.00');
    expect(data.delivery.averageOverrunDays).toBe(5);
    const blank = data.delivery.rows.find((row) => row.kickoffId === 'blank')!;
    // Null, not zero: no executed date means the question cannot be answered.
    expect(blank.daysUntilDue).toBeNull();
    const soon = data.delivery.rows.find((row) => row.kickoffId === 'soon')!;
    expect(soon.daysUntilDue).toBe(2);
  });
});

describe('ProjectManagementDashboardService — workload', () => {
  it('counts open tasks and active projects per PM, excluding done-list cards', async () => {
    const { service } = buildService({
      rows: [
        kickoffRow({
          id: 'k-1',
          pmId: 'pm-1',
          pm: 'Asha',
          cards: [
            { id: 'c-1' },
            { id: 'c-2', dueDate: utc(2026, 8, 1) },
            { id: 'c-3', assigneeId: null },
          ],
          doneCards: 4,
        }),
        kickoffRow({ id: 'k-2', pmId: 'pm-1', pm: 'Asha', cards: [{ id: 'c-4' }] }),
        kickoffRow({ id: 'k-3', pmId: 'pm-2', pm: 'Bala', cards: [{ id: 'c-5' }] }),
      ],
      progress: [
        project({ kickoffId: 'k-1', health: 'BLOCKED' }),
        project({ kickoffId: 'k-2' }),
        project({ kickoffId: 'k-3' }),
      ],
    });
    const data = await service.build(NOW);
    const asha = data.workload.rows.find((row) => row.pmId === 'pm-1')!;
    expect(asha.openTasks).toBe(4);
    expect(asha.activeProjects).toBe(2);
    expect(asha.overdueTasks).toBe(1);
    expect(asha.unassignedTasks).toBe(1);
    expect(asha.blockedProjects).toBe(1);
    expect(asha.tasksPerProject).toBe(2);
    expect(asha.troubledPercent).toBe('50.00');
    // Busiest PM anchors the relative scale.
    expect(asha.loadPercent).toBe('100.00');
    const bala = data.workload.rows.find((row) => row.pmId === 'pm-2')!;
    expect(bala.openTasks).toBe(1);
    expect(bala.loadPercent).toBe('25.00');
    expect(data.workload.totalOpenTasks).toBe(5);
    expect(data.workload.taskImbalancePercent).not.toBeNull();
  });

  it('withholds imbalance when only one PM carries anything', async () => {
    const { service } = buildService({
      rows: [kickoffRow({ cards: [{ id: 'c-1' }] })],
    });
    const data = await service.build(NOW);
    expect(data.workload.taskImbalancePercent).toBeNull();
    expect(data.workload.note).toContain('at least two project managers');
  });
});

describe('ProjectManagementDashboardService — awaiting kickoff', () => {
  it('queries qualifying orders with no kickoff, both routes in', async () => {
    const { service, prisma } = buildService({ rows: [kickoffRow()] });
    await service.build(NOW);
    const where = (prisma.order.findMany as jest.Mock).mock.calls[0][0].where;
    expect(where.projectKickoffs).toEqual({ none: {} });
    expect(where.OR).toEqual([
      { orderType: 'INTERNAL', status: 'CONFIRMED' },
      { confirmationSheets: { some: { status: 'EXECUTED' } } },
    ]);
    expect(where.status).toEqual({ not: 'CANCELLED' });
  });

  it('ages each waiting order from when it qualified, not from order creation', async () => {
    const { service } = buildService({
      rows: [kickoffRow()],
      awaitingKickoff: [
        {
          id: 'o-9',
          orderNumber: 'SO-9',
          orderType: 'CUSTOMER',
          status: 'CONFIRMED',
          createdAt: utc(2026, 1, 1),
          lineItems: [{ id: 'l-1' }],
          confirmationSheets: [
            { deliveryDate: utc(2026, 8, 20), updatedAt: utc(2026, 8, 15) },
          ],
        },
        {
          id: 'o-10',
          orderNumber: 'SO-10',
          orderType: 'INTERNAL',
          status: 'CONFIRMED',
          createdAt: utc(2026, 8, 24),
          lineItems: [],
          confirmationSheets: [],
        },
      ],
    });
    const data = await service.build(NOW);
    expect(data.awaitingKickoff.total).toBe(2);
    const ocs = data.awaitingKickoff.rows.find((row) => row.id === 'o-9')!;
    expect(ocs.source).toBe('OCS_EXECUTED');
    expect(ocs.waitingDays).toBe(10);
    // Already past the promised date with no kickoff at all.
    expect(ocs.daysUntilDue).toBe(-5);
    expect(data.awaitingKickoff.alreadyOverdue).toBe(1);
    const internal = data.awaitingKickoff.rows.find(
      (row) => row.id === 'o-10',
    )!;
    expect(internal.source).toBe('INTERNAL_CONFIRMED');
    expect(internal.waitingDays).toBe(1);
    expect(
      data.awaitingKickoff.ageBuckets.reduce((sum, b) => sum + b.count, 0),
    ).toBe(2);
  });
});

describe('ProjectManagementDashboardService — orders awaiting delivery', () => {
  it('counts orders whose lines have not all reached dispatch', async () => {
    const { service } = buildService({
      rows: [
        kickoffRow({ id: 'k-1', fulfilmentStatus: 'NOT_DISPATCHED', lineCount: 3 }),
        kickoffRow({
          id: 'k-2',
          fulfilmentStatus: 'PARTIALLY_DISPATCHED',
          lineCount: 2,
        }),
        kickoffRow({ id: 'k-3', fulfilmentStatus: 'FULLY_DISPATCHED' }),
      ],
      progress: [
        project({ kickoffId: 'k-1' }),
        project({ kickoffId: 'k-2' }),
        project({ kickoffId: 'k-3' }),
      ],
    });
    const data = await service.build(NOW);
    expect(data.ordersAwaitingDelivery.total).toBe(2);
    expect(data.ordersAwaitingDelivery.lineCount).toBe(5);
    expect(
      data.ordersAwaitingDelivery.byStatus.map((row) => row.label).sort(),
    ).toEqual(['Not Dispatched', 'Partially Dispatched']);
  });
});

describe('ProjectManagementDashboardService — milestone and action item health', () => {
  it('uses the shared overdue predicates and groups by project and PM', async () => {
    const { service } = buildService({
      rows: [
        kickoffRow({
          projectName: 'Kiosk rollout',
          pm: 'Asha',
          milestones: [
            milestone({ id: 'm-late', targetDate: utc(2026, 8, 5) }),
            // Flagged DELAYED while still ahead of its date: overdue anyway.
            milestone({
              id: 'm-flagged',
              status: 'DELAYED',
              targetDate: utc(2026, 12, 1),
            }),
            milestone({
              id: 'm-done',
              status: 'COMPLETED',
              targetDate: utc(2026, 8, 1),
            }),
            milestone({ id: 'm-next', targetDate: utc(2026, 9, 2) }),
          ],
          actionItems: [
            actionItem({ id: 'a-late', dueDate: utc(2026, 8, 15) }),
            // Archived card: not open work, so never overdue.
            actionItem({
              id: 'a-archived',
              dueDate: utc(2026, 8, 15),
              kanbanCard: { ...openCard, status: 'ARCHIVED' },
            }),
            actionItem({ id: 'a-undated', dueDate: null }),
            actionItem({
              id: 'a-done',
              dueDate: utc(2026, 8, 1),
              kanbanCard: {
                status: 'ACTIVE',
                list: { name: 'Done', isDoneList: true },
              },
            }),
          ],
        }),
      ],
    });
    const data = await service.build(NOW);
    expect(data.milestones.total).toBe(4);
    expect(data.milestones.overdue).toBe(2);
    expect(data.milestones.flaggedDelayed).toBe(1);
    expect(data.milestones.completed).toBe(1);
    expect(data.milestones.completionPercent).toBe('25.00');
    expect(data.milestones.rows[0].id).toBe('m-late');
    expect(data.milestones.rows[0].pm).toBe('Asha Rao');
    expect(data.milestones.rows[0].project).toBe('Kiosk rollout');
    expect(data.milestones.upcoming.map((row) => row.id)).toEqual(['m-next']);
    expect(data.milestones.upcoming[0].daysUntilDue).toBe(8);

    expect(data.actionItems.total).toBe(4);
    expect(data.actionItems.overdue).toBe(1);
    expect(data.actionItems.rows[0].id).toBe('a-late');
    expect(data.actionItems.withoutLiveStatus).toBe(1);
    expect(data.actionItems.undated).toBe(1);
    expect(data.actionItems.done).toBe(1);
    expect(data.actionItems.open).toBe(2);
  });
});

describe('ProjectManagementDashboardService — risks', () => {
  it('keeps open severe risks, ranks them and flags the unmitigated ones', async () => {
    const { service } = buildService({
      rows: [
        kickoffRow({
          risks: [
            risk({ id: 'r-hh', likelihood: 'HIGH', impact: 'HIGH' }),
            risk({
              id: 'r-mitigated',
              impact: 'HIGH',
              mitigationPlan: 'Dual-source the panel',
            }),
            risk({ id: 'r-mid', likelihood: 'MEDIUM', impact: 'MEDIUM' }),
            risk({ id: 'r-closed', status: 'CLOSED', impact: 'HIGH' }),
          ],
        }),
      ],
    });
    const data = await service.build(NOW);
    expect(data.risks.total).toBe(4);
    expect(data.risks.open).toBe(3);
    expect(data.risks.highImpactOpen).toBe(2);
    expect(data.risks.rows[0].id).toBe('r-hh');
    expect(data.risks.unmitigated).toBe(1);
    expect(data.risks.unmitigatedPercent).toBe('50.00');
    expect(
      data.risks.matrix.find(
        (cell) => cell.impact === 'HIGH' && cell.likelihood === 'HIGH',
      )!.count,
    ).toBe(1);
  });
});

describe('ProjectManagementDashboardService — project-linked pings', () => {
  it('reads every record type that belongs to a project and maps it back to its PM', async () => {
    const { service, prisma } = buildService({
      rows: [kickoffRow({ id: 'k-1', pm: 'Asha' })],
      trackers: [{ id: 'tr-1', kickoffId: 'k-1' }],
      pings: [
        {
          id: 'p-1',
          message: 'Panel drawing still pending',
          linkedRecordType: 'PLM_TRACKER',
          linkedRecordId: 'tr-1',
          createdAt: utc(2026, 8, 20),
          fromEmployee: employee('Imran'),
          recipients: [{ status: 'PENDING', employee: employee('Neha') }],
        },
        {
          id: 'p-2',
          message: 'Order revision?',
          linkedRecordType: 'ORDER',
          linkedRecordId: 'o-1',
          createdAt: new Date(NOW.getTime() - 2 * 3_600_000),
          fromEmployee: employee('Bala'),
          recipients: [{ status: 'ACKNOWLEDGED', employee: employee('Asha') }],
        },
      ],
    });
    const data = await service.build(NOW);
    const where = (prisma.ping.findMany as jest.Mock).mock.calls[0][0].where;
    expect(where.linkedRecordType.in).toEqual([
      'PROJECT_KICKOFF',
      'ORDER',
      'PLM_TRACKER',
      'KANBAN_BOARD',
    ]);
    // Never a PAGE link: a URL is not a project record.
    expect(where.linkedRecordType.in).not.toContain('PAGE');
    expect(where.recipients).toEqual({
      some: { status: { not: 'RESOLVED' } },
    });

    expect(data.pings.total).toBe(2);
    expect(data.pings.rows[0].id).toBe('p-1');
    expect(data.pings.rows[0].pm).toBe('Asha Rao');
    expect(data.pings.rows[0].project).toBe('Kiosk rollout');
    expect(data.pings.rows[0].ageHours).toBe(120);
    expect(data.pings.oldestAgeHours).toBe(120);
    expect(data.pings.pastEscalation).toBe(1);
    expect(data.pings.escalationRatePercent).toBe('50.00');
    expect(data.pings.unacknowledged).toBe(1);
    expect(data.pings.projectsAffected).toBe(1);
  });

  it('drops a ping linked to a record outside the active portfolio', async () => {
    const { service } = buildService({
      rows: [kickoffRow({ id: 'k-1' })],
      pings: [
        {
          id: 'p-stray',
          message: 'Unrelated',
          linkedRecordType: 'ORDER',
          linkedRecordId: 'o-other',
          createdAt: NOW,
          fromEmployee: employee('Bala'),
          recipients: [{ status: 'PENDING', employee: employee('Neha') }],
        },
      ],
    });
    const data = await service.build(NOW);
    expect(data.pings.total).toBe(0);
    expect(data.pings.note).toContain('No unresolved ping');
  });
});

describe('ProjectManagementDashboardService — empty portfolio', () => {
  it('degrades honestly with nothing in flight', async () => {
    const { service } = buildService({});
    const data = await service.build(NOW);
    expect(data.portfolio.activeTotal).toBe(0);
    expect(data.portfolio.troubledPercent).toBeNull();
    expect(data.portfolio.averageAgeDays).toBeNull();
    expect(data.portfolio.note).toContain('No project is currently in flight');
    expect(data.delivery.note).toContain('cannot be judged');
    expect(data.pings.total).toBe(0);
    expect(data.basis.length).toBeGreaterThan(0);
  });
});
