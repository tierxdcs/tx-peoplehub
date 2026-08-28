import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { PlmService } from '../plm/plm.service';
import { ProjectKickoffService } from '../project-kickoff/project-kickoff.service';
import { OtdService } from '../logistics/otd.service';
import { OperationsDashboardService } from './operations-dashboard.service';

const d = (n: string | number) => new Prisma.Decimal(n);
const utc = (y: number, m: number, day = 1) =>
  new Date(Date.UTC(y, m - 1, day));
const NOW = utc(2026, 8, 25);
const USER = { id: 'coo-1' } as AuthenticatedUser;

type Line = Awaited<ReturnType<PlmService['dashboardCompanyWide']>>[number];
type Project = Awaited<
  ReturnType<ProjectKickoffService['progressCompanyWide']>
>[number];
type OtdReport = Awaited<ReturnType<OtdService['report']>>;

/** A PLM row exactly as the PLM workspace builds it, with only what we read set. */
const line = (over: Partial<Line> = {}): Line =>
  ({
    trackerId: 'tr-1',
    orderId: 'o-1',
    orderNumber: 'SO-1',
    customerName: 'Metro Rail',
    productName: 'Emergency Kiosk',
    productSku: 'EK-1',
    flowType: 'IN_HOUSE',
    currentStage: 'PRODUCTION',
    ownerName: 'A B',
    ageDays: 2,
    promisedDeliveryDate: '2026-09-01T00:00:00.000Z',
    daysUntilDue: 7,
    blocker: null,
    health: 'ON_TRACK',
    facilityKind: 'IN_HOUSE',
    facilityLabel: 'In-House — Balaji MetalTech',
    facilityVendorId: null,
    splitQuantity: '100.00',
    vendorCadenceStatus: null,
    production: { done: 0, total: 0 },
    hasPendingPing: false,
    updatedAt: NOW.toISOString(),
    ...over,
  }) as Line;

const project = (over: Partial<Project> = {}): Project =>
  ({
    kickoffId: 'k-1',
    projectName: 'Kiosk rollout',
    orderId: 'o-1',
    orderNumber: 'SO-1',
    health: 'ON_TRACK',
    healthReason: 'All lamps green',
    currentStage: 'Production',
    updatedAt: NOW.toISOString(),
    nextDueDate: null,
    stages: [
      { key: 'order', label: 'Order', state: 'COMPLETE', detail: '', href: '' },
      {
        key: 'dispatch',
        label: 'Dispatch',
        state: 'IN_PROGRESS',
        detail: '',
        href: '',
      },
    ],
    ...over,
  }) as Project;

const dispatch = (id: string, onTime: boolean) => ({
  id,
  dcNumber: `DC-${id}`,
  customerName: 'Metro Rail',
  promisedDeliveryDate: utc(2026, 7, 1).toISOString(),
  actualDeliveryDate: utc(2026, 7, onTime ? 1 : 9).toISOString(),
  delayDays: onTime ? 0 : 8,
  onTime,
});

interface Fixture {
  projects?: Project[];
  lines?: Line[];
  otd?: Partial<OtdReport>;
  designProjects?: unknown[];
  rfqs?: unknown[];
  overduePos?: unknown[];
  grnPendingQc?: number;
  openInspections?: number;
  ncrs?: unknown[];
  openNcrCount?: number;
  /** deliveryChallanId → delivery types of the splits behind its lines. */
  dcSplitTypes?: Record<string, Array<string | null>>;
  productionUpdates?: unknown[];
}

function buildService(fixture: Fixture) {
  const dispatches = fixture.otd?.dispatches ?? [];
  const onTime = dispatches.filter((row) => row.onTime).length;
  const otdReport: OtdReport = {
    summary: {
      totalDelivered: dispatches.length,
      onTime,
      late: dispatches.length - onTime,
      onTimePercentage: dispatches.length
        ? Math.round((onTime / dispatches.length) * 1000) / 10
        : null,
      averageDelayDays: 0,
    },
    byCustomer: [],
    dispatches,
    ...fixture.otd,
  } as OtdReport;

  const prisma = {
    designProject: {
      findMany: jest.fn(() => Promise.resolve(fixture.designProjects ?? [])),
    },
    rfq: { findMany: jest.fn(() => Promise.resolve(fixture.rfqs ?? [])) },
    purchaseOrder: {
      findMany: jest.fn(() => Promise.resolve(fixture.overduePos ?? [])),
    },
    goodsReceiptNote: {
      count: jest.fn(() => Promise.resolve(fixture.grnPendingQc ?? 0)),
    },
    qmsInspection: {
      count: jest.fn(() => Promise.resolve(fixture.openInspections ?? 0)),
    },
    qmsNonConformance: {
      findMany: jest.fn(() => Promise.resolve(fixture.ncrs ?? [])),
      count: jest.fn(() => Promise.resolve(fixture.openNcrCount ?? 0)),
    },
    deliveryChallanLine: {
      findMany: jest.fn(() =>
        Promise.resolve(
          Object.entries(fixture.dcSplitTypes ?? {}).map(([id, types]) => ({
            deliveryChallanId: id,
            orderLine: {
              deliverySplits: types.map((deliveryType) => ({ deliveryType })),
            },
          })),
        ),
      ),
    },
    plmProductionUpdate: {
      findMany: jest.fn(() => Promise.resolve(fixture.productionUpdates ?? [])),
    },
  } as unknown as PrismaService;

  const plm = {
    dashboardCompanyWide: jest.fn(() => Promise.resolve(fixture.lines ?? [])),
  } as unknown as PlmService;
  const kickoffs = {
    progressCompanyWide: jest.fn(() =>
      Promise.resolve(fixture.projects ?? []),
    ),
  } as unknown as ProjectKickoffService;
  const otd = {
    report: jest.fn(() => Promise.resolve(otdReport)),
  } as unknown as OtdService;

  return {
    service: new OperationsDashboardService(prisma, plm, kickoffs, otd),
    plm,
    kickoffs,
    otd,
  };
}

describe('OperationsDashboardService — company-wide scope', () => {
  it('reads the company-wide project and PLM builders, not the per-user ones', async () => {
    const { service, plm, kickoffs } = buildService({});
    await service.build(USER, NOW);
    expect(kickoffs.progressCompanyWide).toHaveBeenCalled();
    expect(plm.dashboardCompanyWide).toHaveBeenCalledWith(USER);
  });

  it('counts health off the shared progress view and drops finished projects', async () => {
    const completedStages = [
      { key: 'order', label: 'Order', state: 'COMPLETE', detail: '', href: '' },
      {
        key: 'dispatch',
        label: 'Dispatch',
        state: 'COMPLETE',
        detail: '',
        href: '',
      },
    ] as Project['stages'];
    const cancelledStages = [
      {
        key: 'order',
        label: 'Order',
        state: 'ATTENTION',
        detail: '',
        href: '',
      },
      {
        key: 'dispatch',
        label: 'Dispatch',
        state: 'UPCOMING',
        detail: '',
        href: '',
      },
    ] as Project['stages'];
    const { service } = buildService({
      projects: [
        project({ kickoffId: 'a', health: 'ON_TRACK' }),
        project({ kickoffId: 'b', health: 'AT_RISK' }),
        project({ kickoffId: 'c', health: 'BLOCKED' }),
        project({ kickoffId: 'd', stages: completedStages }),
        project({ kickoffId: 'e', stages: cancelledStages }),
      ],
    });
    const result = await service.build(USER, NOW);
    expect(result.portfolio.activeTotal).toBe(3);
    expect(result.portfolio.totalEverStarted).toBe(5);
    expect(result.portfolio).toMatchObject({ onTrack: 1, atRisk: 1, blocked: 1 });
  });

  it('passes the PLM rows through untouched, so the page derives urgency, blockers and the funnel from one source', async () => {
    const rows = [line({ trackerId: 'x' }), line({ trackerId: 'y' })];
    const { service } = buildService({ lines: rows });
    const result = await service.build(USER, NOW);
    expect(result.lines).toBe(rows);
  });
});

describe('OperationsDashboardService — on-time delivery', () => {
  it('surfaces the Logistics OTD summary rather than recomputing it', async () => {
    const { service } = buildService({
      otd: { dispatches: [dispatch('1', true), dispatch('2', false)] },
    });
    const result = await service.build(USER, NOW);
    expect(result.onTimeDelivery).toMatchObject({
      percent: 50,
      totalDelivered: 2,
      onTime: 1,
      late: 1,
      status: 'AVAILABLE',
    });
  });

  it('reports NO_DATA with an explanation rather than 0% when nothing is delivered', async () => {
    const { service } = buildService({});
    const result = await service.build(USER, NOW);
    expect(result.onTimeDelivery.percent).toBeNull();
    expect(result.onTimeDelivery.status).toBe('NO_DATA');
    expect(result.onTimeDelivery.note).toMatch(/no delivery challan/i);
  });
});

describe('OperationsDashboardService — facility attribution and depth', () => {
  it('segments the in-house OTD rate out of the company figure and excludes mixed challans', async () => {
    const { service } = buildService({
      otd: {
        dispatches: [
          dispatch('in-1', true),
          dispatch('in-2', false),
          dispatch('vendor-1', true),
          dispatch('mixed-1', false),
        ],
      },
      dcSplitTypes: {
        'in-1': ['IN_HOUSE'],
        'in-2': ['IN_HOUSE', 'IN_HOUSE'],
        'vendor-1': ['VENDOR'],
        'mixed-1': ['IN_HOUSE', 'VENDOR'],
      },
    });
    const result = await service.build(USER, NOW);
    // Company-wide: 2 of 4 on time. In-house alone: 1 of 2.
    expect(result.onTimeDelivery.percent).toBe(50);
    expect(result.facilities.inHouse.onTimeDelivery).toMatchObject({
      percent: 50,
      totalDelivered: 2,
      onTime: 1,
      late: 1,
    });
    expect(result.facilities.mixedDispatchesExcluded).toBe(1);
  });

  it('gives the in-house facility Kanban-depth metrics: card completion, WIP and blockers', async () => {
    const { service } = buildService({
      lines: [
        line({
          trackerId: 'i1',
          production: { done: 3, total: 4 },
        }),
        line({
          trackerId: 'i2',
          health: 'BLOCKED',
          blocker: 'Passed QC inspection required',
          currentStage: 'QC',
          production: { done: 1, total: 4 },
        }),
        line({
          trackerId: 'v1',
          facilityKind: 'EXTERNAL_VENDOR',
          facilityLabel: 'Shakti Fabricators',
          facilityVendorId: 'v-shakti',
          flowType: 'VENDOR',
          production: { done: 9, total: 9 },
        }),
      ],
    });
    const result = await service.build(USER, NOW);
    expect(result.facilities.inHouse).toMatchObject({
      activeLines: 2,
      blockedLines: 1,
      linesInProduction: 1,
    });
    // 4 of 8 in-house cards done — the vendor line's cards are not counted.
    expect(result.facilities.inHouse.production).toMatchObject({
      done: 4,
      total: 8,
      percent: 50,
    });
  });

  it('reports in-house card completion as unmeasured, not 0%, when no card is linked', async () => {
    const { service } = buildService({ lines: [line()] });
    const result = await service.build(USER, NOW);
    expect(result.facilities.inHouse.production.percent).toBeNull();
    expect(result.facilities.inHouse.production.note).toMatch(/no production card/i);
  });

  it('keeps external vendors on the shallow self-reported view, named and ranked by overdue updates', async () => {
    const { service } = buildService({
      lines: [
        line({
          trackerId: 'v1',
          facilityKind: 'EXTERNAL_VENDOR',
          facilityLabel: 'Shakti Fabricators',
          facilityVendorId: 'v-shakti',
          vendorCadenceStatus: 'GREEN',
        }),
        line({
          trackerId: 'v2',
          facilityKind: 'EXTERNAL_VENDOR',
          facilityLabel: 'Preciforge',
          facilityVendorId: 'v-preci',
          vendorCadenceStatus: 'RED',
          health: 'BLOCKED',
          blocker: 'Vendor update overdue (expected every 7 day(s))',
        }),
      ],
      productionUpdates: [
        {
          trackerId: 'v2',
          createdAt: utc(2026, 8, 10),
          reporterDisplayName: 'Preciforge QA',
          completedSteps: 3,
          fabricationPercent: 60,
          surfaceFinishPercent: 0,
          assemblyPercent: 0,
        },
      ],
    });
    const result = await service.build(USER, NOW);
    const [first, second] = result.facilities.externalVendors;
    // The vendor with an overdue update sorts first.
    expect(first.vendorName).toBe('Preciforge');
    expect(first).toMatchObject({ overdue: 1, blockedLines: 1, activeLines: 1 });
    expect(first.latestSelfReport).toMatchObject({
      reporterDisplayName: 'Preciforge QA',
      fabricationPercent: 60,
    });
    expect(second.vendorName).toBe('Shakti Fabricators');
    expect(second.latestSelfReport).toBeNull();
    // The in-house facility is never listed as a vendor.
    expect(
      result.facilities.externalVendors.some((v) =>
        v.vendorName.includes('Balaji'),
      ),
    ).toBe(false);
  });
});

describe('OperationsDashboardService — vendor update cadence', () => {
  it('counts the tracker’s own cadence verdicts and ignores lines with no cadence running', async () => {
    const { service } = buildService({
      lines: [
        line({ trackerId: '1', vendorCadenceStatus: 'RED' }),
        line({ trackerId: '2', vendorCadenceStatus: 'AMBER' }),
        line({ trackerId: '3', vendorCadenceStatus: 'GREEN' }),
        line({ trackerId: '4', vendorCadenceStatus: null }),
      ],
    });
    const result = await service.build(USER, NOW);
    expect(result.vendorUpdateHealth).toMatchObject({
      measuredLines: 3,
      overdue: 1,
      dueSoon: 1,
      onSchedule: 1,
      note: null,
    });
    expect(result.vendorUpdateHealth.overdueLines).toHaveLength(1);
  });

  it('explains itself when no cadence clock is running at all', async () => {
    const { service } = buildService({ lines: [line()] });
    const result = await service.build(USER, NOW);
    expect(result.vendorUpdateHealth.measuredLines).toBe(0);
    expect(result.vendorUpdateHealth.note).toMatch(/no vendor-flow line/i);
  });
});

describe('OperationsDashboardService — design stage gates', () => {
  it('counts design projects per stage in the Design module’s ladder order and flags overdue ones', async () => {
    const { service } = buildService({
      designProjects: [
        {
          id: 'd1',
          projectNumber: 'DP-1',
          name: 'Kiosk shell',
          status: 'DETAILED_DESIGN',
          targetDate: utc(2026, 8, 1),
        },
        {
          id: 'd2',
          projectNumber: 'DP-2',
          name: 'Door latch',
          status: 'DETAILED_DESIGN',
          targetDate: utc(2026, 12, 1),
        },
        {
          id: 'd3',
          projectNumber: 'DP-3',
          name: 'Signage',
          status: 'ON_HOLD',
          targetDate: utc(2026, 7, 1),
        },
      ],
    });
    const result = await service.build(USER, NOW);
    expect(result.design.activeTotal).toBe(3);
    expect(result.design.overdueTotal).toBe(2);
    const detailed = result.design.stages.find(
      (stage) => stage.status === 'DETAILED_DESIGN',
    );
    expect(detailed).toMatchObject({
      label: 'Detailed Design',
      count: 2,
      overdueCount: 1,
    });
    expect(result.design.stages.map((stage) => stage.status)).toEqual([
      'REQUIREMENTS',
      'CONCEPT',
      'DETAILED_DESIGN',
      'INTERNAL_REVIEW',
      'CUSTOMER_APPROVAL',
      'RELEASED_FOR_PRODUCTION',
    ]);
    // ON_HOLD is not a ladder stage: reported separately, never silently dropped.
    expect(result.design.offLadder.map((stage) => stage.status)).toEqual([
      'ON_HOLD',
    ]);
    expect(result.design.overdueProjects[0]).toMatchObject({
      projectNumber: 'DP-1',
      stageLabel: 'Detailed Design',
      daysOverdue: 24,
    });
  });
});

describe('OperationsDashboardService — procurement and quality', () => {
  it('averages RFQ creation-to-award days and prices the award against the lowest quote', async () => {
    const { service } = buildService({
      rfqs: [
        {
          id: 'r1',
          rfqNumber: 'RFQ-1',
          createdAt: utc(2026, 6, 1),
          awardDecisionAt: utc(2026, 6, 11),
          awardedInviteeId: 'i2',
          invitees: [
            { id: 'i1', quotes: [{ totalQuotedValue: d('1000') }] },
            { id: 'i2', quotes: [{ totalQuotedValue: d('1200') }] },
          ],
        },
        {
          id: 'r2',
          rfqNumber: 'RFQ-2',
          createdAt: utc(2026, 7, 1),
          awardDecisionAt: utc(2026, 7, 21),
          awardedInviteeId: null,
          invitees: [{ id: 'i3', quotes: [{ totalQuotedValue: d('500') }] }],
        },
      ],
      overduePos: [
        {
          id: 'p1',
          poNumber: 'PO-1',
          status: 'ISSUED',
          expectedDeliveryDate: utc(2026, 8, 1),
          vendor: { companyName: 'Shakti Fabricators' },
          supplier: null,
          adHocPartyName: null,
        },
      ],
      grnPendingQc: 4,
      openInspections: 6,
    });
    const result = await service.build(USER, NOW);
    expect(result.procurement.rfqCycle).toMatchObject({
      averageDays: 15,
      rfqsMeasured: 2,
      status: 'AVAILABLE',
    });
    expect(result.procurement.awardPremium).toMatchObject({
      amount: '200.00',
      percent: '20.00',
      rfqsMeasured: 1,
      rfqsUnmeasured: 1,
    });
    expect(result.procurement.overduePurchaseOrders.count).toBe(1);
    expect(result.procurement.overduePurchaseOrders.orders[0].partyName).toBe(
      'Shakti Fabricators',
    );
    expect(result.procurement.grnPendingQc).toBe(4);
    expect(result.procurement.inspectionBacklog).toBe(6);
  });

  it('sums the COPQ the QMS module already stored, and says so when there is none', async () => {
    const { service: withCost } = buildService({
      ncrs: [
        { costOfPoorQuality: d('1500.50'), costOfPoorQualitySource: 'DERIVED' },
        { costOfPoorQuality: d('499.50'), costOfPoorQualitySource: 'MANUAL' },
      ],
      openNcrCount: 3,
    });
    const costed = await withCost.build(USER, NOW);
    expect(costed.quality).toMatchObject({
      copqTotal: '2000.00',
      ncrsCosted: 2,
      manuallyCosted: 1,
      openNcrCount: 3,
      status: 'AVAILABLE',
    });

    const { service: empty } = buildService({});
    const uncosted = await empty.build(USER, NOW);
    expect(uncosted.quality.copqTotal).toBeNull();
    expect(uncosted.quality.status).toBe('NO_DATA');
  });
});

describe('OperationsDashboardService — non-financial by construction', () => {
  it('exposes no revenue, margin, cash-flow or receivables figure anywhere on the payload', async () => {
    const { service } = buildService({
      projects: [project()],
      lines: [line()],
      otd: { dispatches: [dispatch('1', true)] },
      dcSplitTypes: { '1': ['IN_HOUSE'] },
    });
    const result = await service.build(USER, NOW);

    const keys = new Set<string>();
    const walk = (value: unknown, depth = 0) => {
      if (depth > 8 || value === null || typeof value !== 'object') return;
      if (Array.isArray(value)) return value.forEach((v) => walk(v, depth + 1));
      for (const [key, child] of Object.entries(value)) {
        keys.add(key);
        walk(child, depth + 1);
      }
    };
    walk(result);

    const forbidden =
      /revenue|margin|profit|cashflow|cash_flow|receivable|invoice|outstanding|collection|billed|orderValue/i;
    expect([...keys].filter((key) => forbidden.test(key))).toEqual([]);
  });

  it('states the exclusion in the rendered basis, so the scope is never assumed', async () => {
    const { service } = buildService({});
    const result = await service.build(USER, NOW);
    expect(
      result.basis.some((entry) =>
        /excludes revenue, margin, cash flow and receivables/i.test(entry),
      ),
    ).toBe(true);
  });
});
