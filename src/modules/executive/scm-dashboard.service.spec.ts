import { ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { PlmService } from '../plm/plm.service';
import { ScmResourcePlanService } from '../scm-resource-plan/scm-resource-plan.service';
import { autoDraftPoNote } from '../rfq/rfq-po-provenance';
import { ScmDashboardService } from './scm-dashboard.service';

const d = (n: string | number) => new Prisma.Decimal(n);
const utc = (y: number, m: number, day = 1) =>
  new Date(Date.UTC(y, m - 1, day));
/** Mid-FY2026-27, so April 2026 onwards is "this period". */
const NOW = utc(2026, 8, 25);
const USER = { id: 'scm-head-1' } as AuthenticatedUser;

type Line = Awaited<ReturnType<PlmService['dashboardCompanyWide']>>[number];
type PlanRow = Awaited<
  ReturnType<ScmResourcePlanService['crossProjectSummary']>
>[number];

/** A PLM row exactly as the PLM workspace builds it, with only what we read set. */
const line = (over: Partial<Line> = {}): Line =>
  ({
    trackerId: 'tr-1',
    orderId: 'o-1',
    orderNumber: 'SO-1',
    customerName: 'Metro Rail',
    productName: 'Emergency Kiosk',
    productSku: 'EK-1',
    flowType: 'VENDOR',
    currentStage: 'PRODUCTION',
    ownerName: 'A B',
    ageDays: 2,
    promisedDeliveryDate: '2026-09-01T00:00:00.000Z',
    daysUntilDue: 7,
    blocker: null,
    health: 'ON_TRACK',
    facilityKind: 'EXTERNAL_VENDOR',
    facilityLabel: 'Shakti Fabricators',
    facilityVendorId: 'v-1',
    splitQuantity: '100.00',
    vendorCadenceStatus: 'GREEN',
    vendorCadenceDueAt: '2026-08-26T00:00:00.000Z',
    lastVendorUpdateAt: '2026-08-25T00:00:00.000Z',
    production: { done: 2, total: 6 },
    hasPendingPing: false,
    updatedAt: NOW.toISOString(),
    ...over,
  }) as Line;

const planRow = (over: Partial<PlanRow> = {}): PlanRow =>
  ({
    planId: 'plan-1',
    projectKickoffId: 'k-1',
    projectName: 'Kiosk rollout',
    orderNumber: 'SO-1',
    customerName: 'Metro Rail',
    generatedAt: utc(2026, 5, 1).toISOString(),
    totalBenchmarkCost: '1000.00',
    totalNegotiatedCost: '1100.00',
    varianceAmount: '100.00',
    variancePercent: '10.00',
    isCostComplete: true,
    lineCount: 4,
    negotiatedLineCount: 4,
    ...over,
  }) as PlanRow;

/** An RFQ invitee row as loadSubmittedInvitees selects it. */
const invitee = (over: Record<string, unknown> = {}) => ({
  id: 'inv-1',
  quoteStatus: 'SUBMITTED',
  submittedAt: utc(2026, 6, 5),
  revokedAt: null,
  revisionRequestedAt: null,
  declineReason: null,
  vendor: { id: 'v-1', companyName: 'Shakti Fabricators' },
  supplier: null,
  rfq: { createdAt: utc(2026, 6, 1), pmApprovedAt: utc(2026, 6, 2) },
  quotes: [{ revisionNumber: 1, submittedAt: utc(2026, 6, 5) }],
  ...over,
});

/** An awarded RFQ row as loadAwardedRfqs selects it. */
const awardedRfq = (over: Record<string, unknown> = {}) => ({
  id: 'rfq-1',
  rfqNumber: 'RFQ-2026-0001',
  title: 'Kiosk shells',
  createdAt: utc(2026, 6, 1),
  awardDecisionAt: utc(2026, 6, 11),
  awardedInviteeId: 'inv-1',
  awardJustification: null,
  invitees: [
    {
      id: 'inv-1',
      vendor: { companyName: 'Shakti Fabricators' },
      supplier: null,
      quotes: [{ totalQuotedValue: d('100.00'), revisionNumber: 1 }],
    },
  ],
  ...over,
});

const po = (over: Record<string, unknown> = {}) => ({
  id: 'po-1',
  poNumber: 'PO-2026-0001',
  status: 'ISSUED',
  expectedDeliveryDate: utc(2026, 9, 1),
  issuedAt: utc(2026, 6, 15),
  notes: null,
  vendor: { companyName: 'Shakti Fabricators' },
  supplier: null,
  adHocPartyName: null,
  lines: [{ lineTotal: d('100.00') }],
  ...over,
});

const partner = (over: Record<string, unknown> = {}) => ({
  id: 'v-1',
  companyName: 'Shakti Fabricators',
  status: 'APPROVED',
  statusOverridden: false,
  createdAt: utc(2025, 5, 1),
  ...over,
});

interface Fixture {
  activeRfqs?: unknown[];
  awardedRfqs?: unknown[];
  invitees?: unknown[];
  openPos?: unknown[];
  adHocPending?: unknown[];
  adHocApprovedCount?: number;
  vendors?: unknown[];
  suppliers?: unknown[];
  poValueRows?: unknown[];
  lines?: Line[];
  intakes?: unknown[];
  ncrs?: unknown[];
  grnBacklog?: unknown[];
  leadTimeQuotes?: unknown[];
  productionUpdates?: unknown[];
  plans?: PlanRow[];
  /** Set to reject the cost-view gate the way ItemCostService would. */
  costForbidden?: boolean;
}

function buildService(fixture: Fixture) {
  // rfq.findMany is called twice with different shapes; the where clause tells
  // them apart, mirroring how the service actually queries.
  const rfqFindMany = jest.fn((args: { where?: { status?: unknown } }) => {
    const status = args?.where?.status as
      { in?: string[] } | string | undefined;
    if (typeof status === 'string' && status === 'AWARDED') {
      return Promise.resolve(fixture.awardedRfqs ?? []);
    }
    return Promise.resolve(fixture.activeRfqs ?? []);
  });
  const poFindMany = jest.fn((args: { where?: Record<string, unknown> }) => {
    const where = args?.where ?? {};
    if (where.vendorId === null && where.supplierId === null) {
      return Promise.resolve(fixture.adHocPending ?? []);
    }
    if (
      typeof where.status === 'object' &&
      where.status !== null &&
      'notIn' in (where.status as Record<string, unknown>)
    ) {
      return Promise.resolve(fixture.poValueRows ?? []);
    }
    return Promise.resolve(fixture.openPos ?? []);
  });

  const prisma = {
    rfq: { findMany: rfqFindMany },
    rfqInvitee: {
      findMany: jest.fn(() => Promise.resolve(fixture.invitees ?? [])),
    },
    rfqQuote: {
      findMany: jest.fn(() => Promise.resolve(fixture.leadTimeQuotes ?? [])),
    },
    purchaseOrder: {
      findMany: poFindMany,
      count: jest.fn(() => Promise.resolve(fixture.adHocApprovedCount ?? 0)),
    },
    vendor: { findMany: jest.fn(() => Promise.resolve(fixture.vendors ?? [])) },
    supplier: {
      findMany: jest.fn(() => Promise.resolve(fixture.suppliers ?? [])),
    },
    customerBomIntake: {
      findMany: jest.fn(() => Promise.resolve(fixture.intakes ?? [])),
    },
    nonConformanceReport: {
      findMany: jest.fn(() => Promise.resolve(fixture.ncrs ?? [])),
    },
    goodsReceiptNote: {
      findMany: jest.fn(() => Promise.resolve(fixture.grnBacklog ?? [])),
    },
    plmProductionUpdate: {
      findMany: jest.fn(() => Promise.resolve(fixture.productionUpdates ?? [])),
    },
  } as unknown as PrismaService;

  const plm = {
    dashboardCompanyWide: jest.fn(() => Promise.resolve(fixture.lines ?? [])),
  } as unknown as PlmService;
  const resourcePlans = {
    crossProjectSummary: jest.fn(() =>
      fixture.costForbidden
        ? Promise.reject(
            new ForbiddenException('You do not have access to item cost data'),
          )
        : Promise.resolve(fixture.plans ?? []),
    ),
  } as unknown as ScmResourcePlanService;

  return {
    service: new ScmDashboardService(prisma, plm, resourcePlans),
    prisma,
    plm,
    resourcePlans,
    poFindMany,
  };
}

describe('ScmDashboardService — RFQ health', () => {
  it('separates the PM approval queue from the rest of the open pipeline', async () => {
    const { service } = buildService({
      activeRfqs: [
        {
          id: 'a',
          rfqNumber: 'RFQ-1',
          title: 'Shells',
          status: 'DRAFT',
          createdAt: utc(2026, 8, 1),
          updatedAt: utc(2026, 8, 1),
          submissionDeadline: null,
          pmApprovedAt: null,
          pmRejectionComment: null,
          projectKickoffId: 'k-1',
          customerBomIntakeId: null,
          _count: { lines: 3, invitees: 2 },
        },
        {
          id: 'b',
          rfqNumber: 'RFQ-2',
          title: 'Panels',
          status: 'DRAFT',
          createdAt: utc(2026, 8, 2),
          updatedAt: utc(2026, 8, 2),
          submissionDeadline: null,
          pmApprovedAt: utc(2026, 8, 3),
          pmRejectionComment: null,
          projectKickoffId: null,
          customerBomIntakeId: 'bi-1',
          _count: { lines: 1, invitees: 0 },
        },
        {
          id: 'c',
          rfqNumber: 'RFQ-3',
          title: 'Frames',
          status: 'ISSUED',
          createdAt: utc(2026, 8, 4),
          updatedAt: utc(2026, 8, 4),
          submissionDeadline: utc(2026, 9, 1),
          pmApprovedAt: utc(2026, 8, 4),
          pmRejectionComment: null,
          projectKickoffId: null,
          customerBomIntakeId: null,
          _count: { lines: 2, invitees: 3 },
        },
        {
          id: 'e',
          rfqNumber: 'RFQ-4',
          title: 'Trims',
          status: 'CLOSED',
          createdAt: utc(2026, 7, 1),
          updatedAt: utc(2026, 8, 1),
          submissionDeadline: utc(2026, 8, 1),
          pmApprovedAt: utc(2026, 7, 2),
          pmRejectionComment: null,
          projectKickoffId: null,
          customerBomIntakeId: null,
          _count: { lines: 2, invitees: 3 },
        },
      ],
    });
    const result = await service.build(USER, NOW);
    expect(result.rfqHealth.open).toMatchObject({
      total: 4,
      draft: 2,
      awaitingPmApproval: 1,
      approvedNotIssued: 1,
      issued: 1,
      closedAwaitingAward: 1,
    });
    // The queue itself is named, so a backed-up gate is actionable.
    expect(result.rfqHealth.open.awaitingPmApprovalRfqs).toEqual([
      expect.objectContaining({ rfqNumber: 'RFQ-1', waitingDays: 24 }),
    ]);
  });

  it('measures response time from RFQ creation and says so, since issuing is not timestamped', async () => {
    const { service } = buildService({
      invitees: [
        invitee({ id: 'i1', submittedAt: utc(2026, 6, 5) }), // 4 days
        invitee({
          id: 'i2',
          submittedAt: utc(2026, 6, 9),
          quotes: [{ revisionNumber: 1, submittedAt: utc(2026, 6, 9) }],
        }), // 8 days
      ],
    });
    const result = await service.build(USER, NOW);
    expect(result.rfqHealth.responseTime).toMatchObject({
      averageDays: 6,
      quotesMeasured: 2,
      status: 'AVAILABLE',
      // Our own gate, reported separately so vendor slowness is not overstated.
      pmApprovalLagDays: 1,
    });
    expect(result.rfqHealth.responseTime.note).toMatch(/RFQ creation/i);
  });

  it('reports null response time rather than zero when nothing has been quoted', async () => {
    const { service } = buildService({});
    const result = await service.build(USER, NOW);
    expect(result.rfqHealth.responseTime.averageDays).toBeNull();
    expect(result.rfqHealth.responseTime.status).toBe('NO_DATA');
    expect(result.rfqHealth.participation.percent).toBeNull();
  });

  it('counts a qualified vendor who never answers as silent, and excludes revoked links', async () => {
    const { service } = buildService({
      invitees: [
        invitee({ id: 'i1' }),
        invitee({
          id: 'i2',
          quoteStatus: 'VIEWED',
          submittedAt: null,
          quotes: [],
        }),
        invitee({
          id: 'i3',
          quoteStatus: 'DECLINED',
          submittedAt: null,
          declineReason: 'Capacity full',
          quotes: [],
        }),
        // Revoked: the link was pulled, so it was never a chance to respond.
        invitee({
          id: 'i4',
          quoteStatus: 'INVITED',
          submittedAt: null,
          revokedAt: utc(2026, 6, 3),
          quotes: [],
        }),
      ],
    });
    const result = await service.build(USER, NOW);
    expect(result.rfqHealth.participation).toMatchObject({
      invited: 3,
      submitted: 1,
      percent: '33.33',
    });
    expect(result.rfqHealth.participation.partners[0]).toMatchObject({
      partnerName: 'Shakti Fabricators',
      invited: 3,
      submitted: 1,
      declined: 1,
      silent: 1,
      participationPercent: '33.33',
    });
  });

  it('flags a non-lowest award with its premium and the justification recorded at the time', async () => {
    const { service } = buildService({
      awardedRfqs: [
        awardedRfq({
          awardedInviteeId: 'inv-2',
          awardJustification: 'Only vendor with the required IS certification',
          invitees: [
            {
              id: 'inv-1',
              vendor: { companyName: 'Cheap Metals' },
              supplier: null,
              quotes: [{ totalQuotedValue: d('100.00'), revisionNumber: 1 }],
            },
            {
              id: 'inv-2',
              vendor: { companyName: 'Shakti Fabricators' },
              supplier: null,
              quotes: [{ totalQuotedValue: d('120.00'), revisionNumber: 1 }],
            },
          ],
        }),
        // Lowest wins: not listed, but counted in the denominator.
        awardedRfq({ id: 'rfq-2', rfqNumber: 'RFQ-2026-0002' }),
      ],
    });
    const result = await service.build(USER, NOW);
    expect(result.rfqHealth.nonLowestAwards).toMatchObject({
      count: 1,
      comparableAwards: 2,
      lowestWins: 1,
      percent: '50.00',
    });
    expect(result.rfqHealth.nonLowestAwards.awards[0]).toMatchObject({
      rfqNumber: 'RFQ-2026-0001',
      awardedTo: 'Shakti Fabricators',
      premiumAmount: '20.00',
      premiumPercent: '20.00',
      justification: 'Only vendor with the required IS certification',
      quotesCompared: 2,
    });
  });

  it('measures award cycle time from RFQ creation to the award decision', async () => {
    const { service } = buildService({ awardedRfqs: [awardedRfq()] });
    const result = await service.build(USER, NOW);
    expect(result.rfqHealth.awardCycle).toMatchObject({
      averageDays: 10,
      rfqsMeasured: 1,
      status: 'AVAILABLE',
    });
  });

  it('counts negotiated revisions but never the original sealed bid', async () => {
    const { service } = buildService({
      invitees: [
        invitee({
          id: 'i1',
          revisionRequestedAt: utc(2026, 6, 7),
          quotes: [
            { revisionNumber: 1, submittedAt: utc(2026, 6, 5) },
            { revisionNumber: 2, submittedAt: utc(2026, 6, 8) },
          ],
        }),
        invitee({
          id: 'i2',
          vendor: { id: 'v-2', companyName: 'Cheap Metals' },
          quotes: [{ revisionNumber: 1, submittedAt: utc(2026, 6, 5) }],
        }),
      ],
    });
    const result = await service.build(USER, NOW);
    expect(result.rfqHealth.quoteRevisions).toMatchObject({
      revisions: 1,
      revisionRequests: 1,
    });
    // Named, because "with which vendors" is the question being asked.
    expect(result.rfqHealth.quoteRevisions.partners).toEqual([
      expect.objectContaining({
        partnerName: 'Shakti Fabricators',
        revisions: 1,
      }),
    ]);
  });
});

describe('ScmDashboardService — purchase order health', () => {
  it('values open orders from their stored line totals and splits pending vs partial', async () => {
    const { service } = buildService({
      openPos: [
        po({ id: 'p1', lines: [{ lineTotal: d('100.00') }] }),
        po({
          id: 'p2',
          status: 'PARTIALLY_RECEIVED',
          lines: [{ lineTotal: d('50.00') }, { lineTotal: d('25.50') }],
        }),
      ],
    });
    const result = await service.build(USER, NOW);
    expect(result.purchaseOrders.open).toMatchObject({
      count: 2,
      value: '175.50',
      pendingReceipt: 1,
      partiallyReceived: 1,
    });
  });

  it('names overdue orders and counts undated ones separately instead of calling them on time', async () => {
    const { service } = buildService({
      openPos: [
        po({
          id: 'p1',
          poNumber: 'PO-1',
          expectedDeliveryDate: utc(2026, 8, 1),
        }),
        po({ id: 'p2', poNumber: 'PO-2', expectedDeliveryDate: null }),
        po({
          id: 'p3',
          poNumber: 'PO-3',
          expectedDeliveryDate: utc(2026, 9, 9),
        }),
      ],
    });
    const result = await service.build(USER, NOW);
    expect(result.purchaseOrders.overdue).toMatchObject({
      count: 1,
      value: '100.00',
      withoutExpectedDate: 1,
    });
    expect(result.purchaseOrders.overdue.orders[0]).toMatchObject({
      poNumber: 'PO-1',
      daysOverdue: 24,
      partyName: 'Shakti Fabricators',
    });
  });

  it('treats an order with neither a vendor nor a supplier link as the ad-hoc compliance signal', async () => {
    const { service, poFindMany } = buildService({
      adHocPending: [
        {
          id: 'ah-1',
          poNumber: 'PO-AH-1',
          adHocPartyName: 'Local Hardware',
          createdAt: utc(2026, 8, 20),
          lines: [{ lineTotal: d('9000.00') }],
        },
      ],
      adHocApprovedCount: 4,
    });
    const result = await service.build(USER, NOW);
    // Both partner links must be absent — approval status alone is not the test.
    const call = poFindMany.mock.calls.find(
      (args) =>
        Array.isArray(
          (
            (args[0] as { where?: { status?: { in?: unknown[] } } }).where
              ?.status as { in?: unknown[] } | undefined
          )?.in,
        ) &&
        (args[0] as { where?: Record<string, unknown> }).where?.vendorId ===
          null,
    );
    expect(
      (call?.[0] as { where: Record<string, unknown> }).where,
    ).toMatchObject({ vendorId: null, supplierId: null });
    expect(result.purchaseOrders.adHoc).toMatchObject({
      pendingCount: 1,
      pendingValue: '9000.00',
      approvedThisPeriod: 4,
    });
    expect(result.purchaseOrders.adHoc.orders[0]).toMatchObject({
      poNumber: 'PO-AH-1',
      partyName: 'Local Hardware',
      waitingDays: 5,
    });
  });

  it('matches award to PO through the provenance note the award writes, and reports its coverage', async () => {
    const { service } = buildService({
      awardedRfqs: [
        awardedRfq({ rfqNumber: 'RFQ-2026-0001' }),
        awardedRfq({ id: 'rfq-2', rfqNumber: 'RFQ-2026-0002' }),
      ],
      openPos: [
        po({
          id: 'p1',
          notes: autoDraftPoNote('RFQ-2026-0001', 2),
          issuedAt: utc(2026, 6, 17),
        }),
        // A human-written note must never be guessed at.
        po({
          id: 'p2',
          notes: 'Reorder of last month',
          issuedAt: utc(2026, 6, 20),
        }),
      ],
    });
    const result = await service.build(USER, NOW);
    expect(result.purchaseOrders.cycleTime).toMatchObject({
      averageDays: 6,
      posMeasured: 1,
      awardsInPeriod: 2,
      awardsMatched: 1,
      status: 'AVAILABLE',
    });
    expect(result.purchaseOrders.cycleTime.note).toMatch(/1 of 2 awards/);
  });

  it('says the cycle time cannot be measured rather than reporting zero days', async () => {
    const { service } = buildService({ openPos: [po({ notes: null })] });
    const result = await service.build(USER, NOW);
    expect(result.purchaseOrders.cycleTime).toMatchObject({
      averageDays: null,
      status: 'NO_DATA',
    });
    expect(result.purchaseOrders.cycleTime.note).toMatch(/no stored link/i);
  });
});

describe('ScmDashboardService — vendor and supplier base', () => {
  it('breaks the base down by classification across both registers', async () => {
    const { service } = buildService({
      vendors: [
        partner({ id: 'v-1', status: 'APPROVED_PREFERRED' }),
        partner({ id: 'v-2', status: 'APPROVED' }),
        partner({ id: 'v-3', status: 'QUESTIONNAIRE_SUBMITTED' }),
      ],
      suppliers: [
        partner({ id: 's-1', status: 'CONDITIONALLY_APPROVED' }),
        partner({ id: 's-2', status: 'NOT_APPROVED' }),
        partner({ id: 's-3', status: 'UNDER_AUDIT' }),
      ],
    });
    const result = await service.build(USER, NOW);
    expect(result.supplyBase.registered).toMatchObject({
      total: 6,
      vendors: 3,
      suppliers: 3,
      classified: 4,
      unclassified: 2,
    });
    expect(result.supplyBase.classification).toEqual([
      expect.objectContaining({
        status: 'APPROVED_PREFERRED',
        label: 'Approved Preferred',
        total: 1,
      }),
      expect.objectContaining({ status: 'APPROVED', total: 1 }),
      expect.objectContaining({ status: 'CONDITIONALLY_APPROVED', total: 1 }),
      expect.objectContaining({ status: 'NOT_APPROVED', total: 1 }),
    ]);
  });

  it('reads the audit workload off the partner queue, since an audit has no draft state', async () => {
    const { service } = buildService({
      vendors: [
        partner({ id: 'v-1', status: 'QUESTIONNAIRE_SUBMITTED' }),
        partner({ id: 'v-2', status: 'UNDER_AUDIT' }),
        partner({ id: 'v-3', status: 'APPROVED' }),
      ],
      suppliers: [partner({ id: 's-1', status: 'UNDER_AUDIT' })],
    });
    const result = await service.build(USER, NOW);
    expect(result.supplyBase.auditQueue.total).toBe(3);
    expect(result.supplyBase.auditQueue.stages).toEqual([
      expect.objectContaining({ status: 'QUESTIONNAIRE_SUBMITTED', total: 1 }),
      expect.objectContaining({
        status: 'UNDER_AUDIT',
        vendors: 1,
        suppliers: 1,
        total: 2,
      }),
    ]);
    expect(result.supplyBase.auditQueue.note).toMatch(/draft audit state/i);
  });

  it('names every partner currently running on a SuperAdmin override', async () => {
    const { service } = buildService({
      vendors: [
        partner({ id: 'v-1', companyName: 'Shakti', statusOverridden: true }),
        partner({ id: 'v-2', companyName: 'Earned Co' }),
      ],
      suppliers: [
        partner({
          id: 's-1',
          companyName: 'Alloy Traders',
          status: 'APPROVED_PREFERRED',
          statusOverridden: true,
        }),
      ],
    });
    const result = await service.build(USER, NOW);
    expect(result.supplyBase.overrides.count).toBe(2);
    expect(result.supplyBase.overrides.partners).toEqual([
      expect.objectContaining({
        partnerName: 'Alloy Traders',
        partnerType: 'SUPPLIER',
        statusLabel: 'Approved Preferred',
      }),
      expect.objectContaining({
        partnerName: 'Shakti',
        partnerType: 'VENDOR',
        statusLabel: 'Approved',
      }),
    ]);
  });

  it('counts newly onboarded partners only inside the current fiscal year', async () => {
    const { service } = buildService({
      vendors: [
        partner({ id: 'v-1', createdAt: utc(2026, 5, 1) }),
        partner({ id: 'v-2', createdAt: utc(2025, 5, 1) }),
      ],
      suppliers: [partner({ id: 's-1', createdAt: utc(2026, 7, 1) })],
    });
    const result = await service.build(USER, NOW);
    expect(result.supplyBase.onboarded).toMatchObject({
      thisPeriod: 2,
      vendors: 1,
      suppliers: 1,
      percentOfBase: '66.67',
    });
  });

  it('identifies the top partner by actual share of purchase order value', async () => {
    const { service } = buildService({
      poValueRows: [
        {
          id: 'p1',
          vendorId: 'v-1',
          supplierId: null,
          vendor: { companyName: 'Shakti Fabricators' },
          supplier: null,
          adHocPartyName: null,
          lines: [{ lineTotal: d('600.00') }],
        },
        // Same vendor across two orders must aggregate, not compete.
        {
          id: 'p2',
          vendorId: 'v-1',
          supplierId: null,
          vendor: { companyName: 'Shakti Fabricators' },
          supplier: null,
          adHocPartyName: null,
          lines: [{ lineTotal: d('200.00') }],
        },
        {
          id: 'p3',
          vendorId: null,
          supplierId: 's-1',
          vendor: null,
          supplier: { companyName: 'Alloy Traders' },
          adHocPartyName: null,
          lines: [{ lineTotal: d('200.00') }],
        },
      ],
    });
    const result = await service.build(USER, NOW);
    expect(result.supplyBase.concentration).toMatchObject({
      totalPoValue: '1000.00',
      topPartnerName: 'Shakti Fabricators',
      topPartnerPercent: '80.00',
      status: 'AVAILABLE',
    });
    expect(result.supplyBase.concentration.partners).toEqual([
      { name: 'Shakti Fabricators', value: '800.00', percentOfTotal: '80.00' },
      { name: 'Alloy Traders', value: '200.00', percentOfTotal: '20.00' },
    ]);
  });

  it('reports no concentration rather than 100% of nothing', async () => {
    const { service } = buildService({});
    const result = await service.build(USER, NOW);
    expect(result.supplyBase.concentration).toMatchObject({
      status: 'NO_DATA',
      topPartnerName: null,
      topPartnerPercent: null,
    });
  });
});

describe('ScmDashboardService — vendor-operated project detail', () => {
  it('reads the company-wide PLM builder and keeps only externally executed lines', async () => {
    const { service, plm } = buildService({
      lines: [
        line({ trackerId: 'a' }),
        line({
          trackerId: 'b',
          facilityKind: 'IN_HOUSE',
          facilityLabel: 'In-House — Balaji MetalTech',
          facilityVendorId: null,
        }),
        line({
          trackerId: 'c',
          facilityKind: 'IN_HOUSE_NPD',
          facilityLabel: 'In-House — NPD',
          facilityVendorId: null,
        }),
      ],
    });
    const result = await service.build(USER, NOW);
    expect(plm.dashboardCompanyWide).toHaveBeenCalledWith(USER);
    expect(result.vendorProjects.lineCount).toBe(1);
    expect(result.vendorProjects.vendors[0].lines[0].trackerId).toBe('a');
  });

  it('gives per-line detail grouped by vendor, with the quiet ones first', async () => {
    const { service } = buildService({
      lines: [
        line({
          trackerId: 'a',
          facilityVendorId: 'v-1',
          facilityLabel: 'Shakti Fabricators',
          vendorCadenceStatus: 'GREEN',
        }),
        line({
          trackerId: 'b',
          facilityVendorId: 'v-2',
          facilityLabel: 'Quiet Works',
          vendorCadenceStatus: 'RED',
          lastVendorUpdateAt: '2026-08-20T00:00:00.000Z',
          health: 'BLOCKED',
          blocker: 'Awaiting drawing approval',
        }),
        line({
          trackerId: 'c',
          facilityVendorId: 'v-2',
          facilityLabel: 'Quiet Works',
          vendorCadenceStatus: 'AMBER',
        }),
      ],
    });
    const result = await service.build(USER, NOW);
    expect(result.vendorProjects).toMatchObject({
      vendorCount: 2,
      lineCount: 3,
      overdueUpdates: 1,
      blockedLines: 1,
    });
    const [worst] = result.vendorProjects.vendors;
    expect(worst).toMatchObject({
      vendorName: 'Quiet Works',
      activeLines: 2,
      overdueUpdates: 1,
      dueSoonUpdates: 1,
    });
    // Detail, not a count: the row itself carries what to chase.
    expect(worst.lines[0]).toMatchObject({
      trackerId: 'b',
      updateOverdue: true,
      lastUpdateAt: '2026-08-20T00:00:00.000Z',
      blocker: 'Awaiting drawing approval',
      productName: 'Emergency Kiosk',
      splitQuantity: '100.00',
    });
  });

  it('attaches each line its own latest self-report, reusing the PLM step percentage', async () => {
    const { service } = buildService({
      lines: [line({ trackerId: 'a' }), line({ trackerId: 'b' })],
      productionUpdates: [
        {
          trackerId: 'a',
          createdAt: utc(2026, 8, 24),
          reporterDisplayName: 'Shakti QC',
          completedSteps: 3,
          fabricationPercent: 60,
          surfaceFinishPercent: 20,
          assemblyPercent: 0,
          notes: 'Bending done',
        },
        // Older row for the same tracker must not win.
        {
          trackerId: 'a',
          createdAt: utc(2026, 8, 10),
          reporterDisplayName: 'Shakti QC',
          completedSteps: 1,
          fabricationPercent: 10,
          surfaceFinishPercent: null,
          assemblyPercent: null,
          notes: 'Started',
        },
      ],
    });
    const result = await service.build(USER, NOW);
    const rows = result.vendorProjects.vendors[0].lines;
    const a = rows.find((row) => row.trackerId === 'a');
    const b = rows.find((row) => row.trackerId === 'b');
    expect(a?.selfReport).toMatchObject({
      reportedAt: utc(2026, 8, 24),
      completedSteps: 3,
      fabricationPercent: 60,
      surfaceFinishPercent: 20,
      notes: 'Bending done',
    });
    // The step percentage is the PLM module's own conversion, not a second one.
    expect(a?.selfReport?.stepPercent).toBe(33);
    // Never invented: a line with no report says so.
    expect(b?.selfReport).toBeNull();
  });

  it('does not query self-reports at all when no line is vendor-executed', async () => {
    const { service, prisma } = buildService({
      lines: [line({ facilityKind: 'IN_HOUSE', facilityVendorId: null })],
    });
    const result = await service.build(USER, NOW);
    expect(prisma.plmProductionUpdate.findMany).not.toHaveBeenCalled();
    expect(result.vendorProjects.vendors).toEqual([]);
  });
});

describe('ScmDashboardService — sourcing backlog', () => {
  it('lists BOM intakes that were made RFQ-ready and never actioned', async () => {
    const { service } = buildService({
      intakes: [
        {
          id: 'bi-1',
          productName: 'Ticket Gate',
          updatedAt: utc(2026, 8, 5),
          bomId: 'bom-1',
          businessUnit: { code: 'TXM', name: 'Manufacturing' },
          _count: { lines: 12 },
        },
      ],
      activeRfqs: [
        {
          id: 'a',
          rfqNumber: 'RFQ-1',
          title: 'Shells',
          status: 'DRAFT',
          createdAt: utc(2026, 7, 1),
          updatedAt: utc(2026, 7, 2),
          submissionDeadline: null,
          pmApprovedAt: utc(2026, 7, 3),
          pmRejectionComment: null,
          projectKickoffId: 'k-1',
          customerBomIntakeId: null,
          _count: { lines: 4, invitees: 0 },
        },
        // No lines: nothing was ever populated, so it is not sourcing backlog.
        {
          id: 'b',
          rfqNumber: 'RFQ-2',
          title: 'Empty',
          status: 'DRAFT',
          createdAt: utc(2026, 8, 1),
          updatedAt: utc(2026, 8, 1),
          submissionDeadline: null,
          pmApprovedAt: null,
          pmRejectionComment: null,
          projectKickoffId: null,
          customerBomIntakeId: null,
          _count: { lines: 0, invitees: 0 },
        },
      ],
    });
    const result = await service.build(USER, NOW);
    expect(result.sourcingBacklog.total).toBe(2);
    expect(result.sourcingBacklog.intakes.rows[0]).toMatchObject({
      productName: 'Ticket Gate',
      businessUnit: 'TXM',
      lineCount: 12,
      hasBom: true,
      idleDays: 20,
    });
    expect(result.sourcingBacklog.draftRfqs.count).toBe(1);
    expect(result.sourcingBacklog.draftRfqs.rows[0]).toMatchObject({
      rfqNumber: 'RFQ-1',
      fromKickoff: true,
      fromBomIntake: false,
      idleDays: 54,
    });
  });
});

describe('ScmDashboardService — cost performance', () => {
  it('aggregates the resource plan module’s own variance across projects', async () => {
    const { service, resourcePlans } = buildService({
      plans: [
        planRow({
          planId: 'p1',
          totalBenchmarkCost: '1000.00',
          totalNegotiatedCost: '1100.00',
          varianceAmount: '100.00',
        }),
        planRow({
          planId: 'p2',
          totalBenchmarkCost: '1000.00',
          totalNegotiatedCost: '900.00',
          varianceAmount: '-100.00',
          isCostComplete: false,
        }),
      ],
    });
    const result = await service.build(USER, NOW);
    expect(resourcePlans.crossProjectSummary).toHaveBeenCalledWith(USER);
    expect(result.costPerformance).toMatchObject({
      status: 'AVAILABLE',
      projectsWithPlan: 2,
      projectsCostComplete: 1,
      projectsOverBenchmark: 1,
      totalBenchmarkCost: '2000.00',
      totalNegotiatedCost: '2000.00',
      varianceAmount: '0.00',
      variancePercent: '0.00',
    });
    // Worst overrun first, so the project to act on reads first.
    expect(result.costPerformance.projects[0].planId).toBe('p1');
  });

  it('withholds the section instead of widening the cost-view gate', async () => {
    const { service } = buildService({ costForbidden: true });
    const result = await service.build(USER, NOW);
    expect(result.costPerformance).toMatchObject({
      status: 'RESTRICTED',
      projectsWithPlan: 0,
      varianceAmount: null,
      projects: [],
    });
    expect(result.costPerformance.note).toMatch(/does not by itself grant/i);
  });

  it('reports no plans rather than a zero variance', async () => {
    const { service } = buildService({ plans: [] });
    const result = await service.build(USER, NOW);
    expect(result.costPerformance).toMatchObject({
      status: 'NO_DATA',
      variancePercent: null,
    });
  });
});

describe('ScmDashboardService — quality of supply', () => {
  const ncr = (over: Record<string, unknown> = {}) => ({
    id: 'ncr-1',
    ncrNumber: 'NCR-2026-0001',
    status: 'OPEN',
    disposition: null,
    rejectedQuantity: d('5.00'),
    createdAt: utc(2026, 6, 10),
    item: { name: 'Steel Sheet', itemCode: 'ITM-1' },
    grn: {
      grnNumber: 'GRN-1',
      purchaseOrder: {
        poNumber: 'PO-1',
        vendorId: 'v-1',
        supplierId: null,
        vendor: { companyName: 'Shakti Fabricators' },
        supplier: null,
        adHocPartyName: null,
      },
    },
    ...over,
  });

  it('attributes rejections to the partner behind the order and trends them monthly', async () => {
    const { service } = buildService({
      ncrs: [
        ncr({ id: 'n1', createdAt: utc(2026, 6, 10) }),
        ncr({
          id: 'n2',
          createdAt: utc(2026, 7, 12),
          status: 'DISPOSITIONED',
          disposition: 'RETURN_TO_SUPPLIER',
        }),
        ncr({
          id: 'n3',
          createdAt: utc(2026, 8, 2),
          grn: {
            grnNumber: 'GRN-9',
            purchaseOrder: {
              poNumber: 'PO-9',
              vendorId: null,
              supplierId: 's-1',
              vendor: null,
              supplier: { companyName: 'Alloy Traders' },
              adHocPartyName: null,
            },
          },
        }),
      ],
    });
    const result = await service.build(USER, NOW);
    expect(result.qualityOfSupply.ncrs).toMatchObject({
      raisedThisPeriod: 3,
      open: 2,
      dispositioned: 1,
      undispositioned: 2,
      status: 'AVAILABLE',
    });
    expect(result.qualityOfSupply.ncrs.trend).toEqual([
      { key: '2026-04', label: 'Apr 26', value: 0 },
      { key: '2026-05', label: 'May 26', value: 0 },
      { key: '2026-06', label: 'Jun 26', value: 1 },
      { key: '2026-07', label: 'Jul 26', value: 1 },
      { key: '2026-08', label: 'Aug 26', value: 1 },
    ]);
    expect(result.qualityOfSupply.partners).toEqual([
      expect.objectContaining({
        partnerName: 'Shakti Fabricators',
        partnerType: 'VENDOR',
        ncrCount: 2,
        openCount: 1,
        returned: 1,
        rejectedQuantity: '10.00',
      }),
      expect.objectContaining({
        partnerName: 'Alloy Traders',
        partnerType: 'SUPPLIER',
        ncrCount: 1,
      }),
    ]);
    expect(result.qualityOfSupply.ncrs.note).toMatch(
      /Internal production non-conformances are a separate register/i,
    );
  });

  it('reads the supply-side non-conformance register, not the internal production one', async () => {
    const { service, prisma } = buildService({});
    await service.build(USER, NOW);
    expect(prisma.nonConformanceReport.findMany).toHaveBeenCalled();
    expect(
      (prisma as unknown as Record<string, unknown>).qmsNonConformance,
    ).toBeUndefined();
  });

  it('ages the QC gate backlog against the partner who shipped it', async () => {
    const { service } = buildService({
      grnBacklog: [
        {
          id: 'g1',
          grnNumber: 'GRN-1',
          receivedDate: utc(2026, 8, 10),
          purchaseOrder: {
            poNumber: 'PO-1',
            vendor: { companyName: 'Shakti Fabricators' },
            supplier: null,
            adHocPartyName: null,
          },
        },
      ],
    });
    const result = await service.build(USER, NOW);
    expect(result.qualityOfSupply.grnBacklog).toMatchObject({
      count: 1,
      oldestReceivedAt: utc(2026, 8, 10),
    });
    expect(result.qualityOfSupply.grnBacklog.rows[0]).toMatchObject({
      grnNumber: 'GRN-1',
      poNumber: 'PO-1',
      partyName: 'Shakti Fabricators',
    });
  });
});

describe('ScmDashboardService — lead time trend', () => {
  const quote = (
    month: number,
    days: number,
    vendor = { id: 'v-1', companyName: 'Shakti Fabricators' },
  ) => ({
    id: `q-${month}-${days}`,
    submittedAt: utc(2026, month, 10),
    quotedLeadTimeDays: days,
    invitee: { vendor, supplier: null },
  });

  it('averages quoted lead time per month and reads the direction raw', async () => {
    const { service } = buildService({
      leadTimeQuotes: [quote(4, 20), quote(4, 22), quote(7, 40), quote(8, 44)],
    });
    const result = await service.build(USER, NOW);
    expect(result.leadTime).toMatchObject({
      averageDays: 31.5,
      quotesMeasured: 4,
      status: 'AVAILABLE',
      direction: 'RISING',
    });
    expect(result.leadTime.trend).toEqual([
      { key: '2026-04', label: 'Apr 26', value: 21 },
      // A month with no quote breaks the line instead of collapsing to zero.
      { key: '2026-05', label: 'May 26', value: null },
      { key: '2026-06', label: 'Jun 26', value: null },
      { key: '2026-07', label: 'Jul 26', value: 40 },
      { key: '2026-08', label: 'Aug 26', value: 44 },
    ]);
    expect(result.leadTime.note).toMatch(/supply-stress/i);
  });

  it('ranks the slowest quoters first', async () => {
    const { service } = buildService({
      leadTimeQuotes: [
        quote(4, 10),
        quote(5, 12),
        quote(4, 60, { id: 'v-2', companyName: 'Slow Metals' }),
      ],
    });
    const result = await service.build(USER, NOW);
    expect(result.leadTime.partners).toEqual([
      expect.objectContaining({
        partnerName: 'Slow Metals',
        averageDays: 60,
        quotesMeasured: 1,
      }),
      expect.objectContaining({
        partnerName: 'Shakti Fabricators',
        averageDays: 11,
        quotesMeasured: 2,
      }),
    ]);
  });

  it('has no direction from a single month and says the data is absent', async () => {
    const { service } = buildService({ leadTimeQuotes: [quote(4, 20)] });
    const result = await service.build(USER, NOW);
    expect(result.leadTime.direction).toBeNull();

    const { service: empty } = buildService({});
    const bare = await empty.build(USER, NOW);
    expect(bare.leadTime).toMatchObject({
      averageDays: null,
      status: 'NO_DATA',
      direction: null,
    });
  });
});

describe('ScmDashboardService — scope discipline', () => {
  it('carries no sales, finance or customer data anywhere in the payload', async () => {
    const { service } = buildService({
      lines: [line()],
      plans: [planRow()],
      poValueRows: [
        {
          id: 'p1',
          vendorId: 'v-1',
          supplierId: null,
          vendor: { companyName: 'Shakti Fabricators' },
          supplier: null,
          adHocPartyName: null,
          lines: [{ lineTotal: d('100.00') }],
        },
      ],
      intakes: [
        {
          id: 'bi-1',
          productName: 'Ticket Gate',
          updatedAt: utc(2026, 8, 5),
          bomId: null,
          businessUnit: { code: 'TXM', name: 'Manufacturing' },
          _count: { lines: 2 },
        },
      ],
    });
    const result = await service.build(USER, NOW);

    // Both the PLM row and the resource plan row carry a customer name upstream;
    // this dashboard must drop them rather than merely not render them.
    expect(result.vendorProjects.vendors[0].lines[0]).not.toHaveProperty(
      'customerName',
    );
    expect(result.costPerformance.projects[0]).not.toHaveProperty(
      'customerName',
    );

    const keys = new Set<string>();
    const walk = (value: unknown) => {
      if (Array.isArray(value)) return value.forEach(walk);
      if (value && typeof value === 'object' && !(value instanceof Date)) {
        for (const [key, inner] of Object.entries(value)) {
          keys.add(key);
          walk(inner);
        }
      }
    };
    walk(result);
    const forbidden = [...keys].filter((key) =>
      /revenue|margin|profit|cashflow|receivable|invoice|customer|opportunity|bid|quotation/i.test(
        key,
      ),
    );
    expect(forbidden).toEqual([]);
  });

  it('states its own basis, including the substituted RFQ clock', async () => {
    const { service } = buildService({});
    const result = await service.build(USER, NOW);
    expect(result.period.label).toBe('FY 2026-27');
    expect(result.basis.length).toBeGreaterThan(3);
    expect(result.basis.join(' ')).toMatch(/no revenue, no margin/i);
  });
});
