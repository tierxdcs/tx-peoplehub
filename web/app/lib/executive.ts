import { apiFetch } from './api';
import type { PlmDashboardItem } from './plm';
import type { ProjectProgress } from './project-kickoff';

/**
 * Wire types for the Executive Dashboards section. Money and percentages arrive
 * as fixed-2 strings (the repo's Decimal convention) and `null` always means
 * "the data cannot answer this", never zero — see the honest-degradation rules
 * in the backend's sales-dashboard.service.ts.
 */

export type DataMaturity = 'AVAILABLE' | 'INSUFFICIENT_HISTORY' | 'NO_DATA';

export interface YoyComparison {
  status: DataMaturity;
  comparisonLabel: string;
  detail: string | null;
  priorValue: string | null;
  changePercent: string | null;
}

export interface TrendPoint {
  key: string;
  label: string;
  value: string | null;
}

export interface FunnelStage {
  key: string;
  label: string;
  count: number;
  value: string | null;
  valueNote: string | null;
}

export interface ShareSlice {
  name: string;
  value: string;
  percentOfTotal: string | null;
  colorHex: string | null;
}

export interface SalesDashboard {
  period: {
    label: string;
    startsOn: string;
    endsBefore: string;
    asOf: string;
    monthsElapsed: number;
  };
  basis: string[];
  revenue: {
    booked: {
      total: string;
      orderCount: number;
      trend: TrendPoint[];
      yoy: YoyComparison;
    };
    recognised: {
      total: string;
      invoiceCount: number;
      trend: TrendPoint[];
      yoy: YoyComparison;
    };
    bookedNotYetRecognised: string;
  };
  margin: {
    averagePercent: string | null;
    status: DataMaturity;
    ordersMeasured: number;
    ordersUncosted: number;
    coverageNote: string | null;
    trend: TrendPoint[];
  };
  funnel: FunnelStage[];
  winRate: {
    percent: string | null;
    bidsSubmitted: number;
    bidsWon: number;
    submittedValue: string;
    wonValue: string;
    status: DataMaturity;
  };
  dealSize: {
    averageValue: string | null;
    orderCount: number;
    trend: TrendPoint[];
  };
  salesCycle: {
    averageDays: number | null;
    ordersMeasured: number;
    ordersUnlinked: number;
    status: DataMaturity;
  };
  cash: {
    arOutstanding: string;
    arOverdue: string;
    openInvoiceCount: number;
    dsoDays: number | null;
    dsoPaymentsMeasured: number;
    cashInTotal: string;
    cashInTrend: TrendPoint[];
  };
  customers: {
    activeCount: number;
    orderingCount: number;
    newCount: number;
    repeatCount: number;
    newValue: string;
    repeatValue: string;
    concentration: {
      totalValue: string;
      topFiveValue: string;
      topFivePercent: string | null;
      otherValue: string;
      topFive: ShareSlice[];
    };
  };
  businessUnits: ShareSlice[];
  discount: {
    averagePercent: string | null;
    bidsMeasured: number;
    approvedDiscountCount: number;
    trend: TrendPoint[];
  };
}

export function fetchSalesDashboard() {
  return apiFetch<SalesDashboard>('/executive/dashboards/sales');
}

/**
 * The Operations dashboard. Deliberately carries no revenue, margin, cash-flow
 * or receivables figure — the two monetary fields here are Cost of Poor Quality
 * (a quality-failure cost) and the RFQ award premium (a sourcing-effectiveness
 * signal), both labelled as such on the page.
 *
 * `lines` are the PLM workspace's own rows at company scope. Delivery urgency,
 * the blocker ranking and the stage funnel are derived from them on the client
 * using the same helpers the PLM tracker page uses, so the two views cannot
 * disagree.
 */
export interface OperationsDashboard {
  asOf: string;
  period: { label: string; startsOn: string; endsBefore: string };
  basis: string[];
  portfolio: {
    activeTotal: number;
    totalEverStarted: number;
    onTrack: number;
    atRisk: number;
    blocked: number;
    projects: ProjectProgress[];
  };
  lines: PlmDashboardItem[];
  onTimeDelivery: {
    percent: number | null;
    totalDelivered: number;
    onTime: number;
    late: number;
    averageDelayDays: number;
    status: DataMaturity;
    note: string | null;
  };
  design: {
    activeTotal: number;
    overdueTotal: number;
    stages: DesignStageCount[];
    offLadder: DesignStageCount[];
    overdueProjects: Array<{
      id: string;
      projectNumber: string;
      name: string;
      stageLabel: string;
      targetDate: string;
      daysOverdue: number;
    }>;
  };
  vendorUpdateHealth: {
    measuredLines: number;
    overdue: number;
    dueSoon: number;
    onSchedule: number;
    note: string | null;
    overdueLines: PlmDashboardItem[];
  };
  procurement: {
    rfqCycle: {
      averageDays: number | null;
      rfqsMeasured: number;
      status: DataMaturity;
      note: string;
    };
    awardPremium: {
      amount: string;
      percent: string | null;
      rfqsMeasured: number;
      rfqsUnmeasured: number;
      status: DataMaturity;
    };
    overduePurchaseOrders: {
      count: number;
      orders: Array<{
        id: string;
        poNumber: string;
        status: string;
        expectedDeliveryDate: string | null;
        partyName: string;
      }>;
    };
    grnPendingQc: number;
    inspectionBacklog: number;
  };
  quality: {
    copqTotal: string | null;
    ncrsCosted: number;
    manuallyCosted: number;
    openNcrCount: number;
    status: DataMaturity;
    note: string;
  };
  facilities: {
    /** Our own plant: internal-grade depth, because we own the board it runs on. */
    inHouse: {
      label: string;
      activeLines: number;
      blockedLines: number;
      linesInProduction: number;
      production: {
        done: number;
        total: number;
        percent: number | null;
        note: string | null;
      };
      onTimeDelivery: {
        percent: number | null;
        totalDelivered: number;
        onTime: number;
        late: number;
        status: DataMaturity;
        note: string;
      };
    };
    /** Genuine external vendors: the shallower self-reported view, by name. */
    externalVendors: ExternalVendorHealth[];
    mixedDispatchesExcluded: number;
  };
}

export interface DesignStageCount {
  status: string;
  label: string;
  count: number;
  overdueCount: number;
}

export interface ExternalVendorHealth {
  key: string;
  vendorName: string;
  vendorId: string | null;
  activeLines: number;
  blockedLines: number;
  overdue: number;
  dueSoon: number;
  onSchedule: number;
  trackerIds: string[];
  /** What the vendor last told us — not something we measured. */
  latestSelfReport: {
    reportedAt: string;
    reporterDisplayName: string;
    stepPercent: number | null;
    completedSteps: number | null;
    fabricationPercent: number | null;
    surfaceFinishPercent: number | null;
    assemblyPercent: number | null;
  } | null;
}

export function fetchOperationsDashboard() {
  return apiFetch<OperationsDashboard>('/executive/dashboards/operations');
}

/** The health states the shared project-progress builder emits. */
export type ProjectHealth = 'ON_TRACK' | 'AT_RISK' | 'BLOCKED';
export type ProjectStageState =
  | 'COMPLETE'
  | 'IN_PROGRESS'
  | 'ATTENTION'
  | 'UPCOMING';

/** A whole-day bucket of ages, pre-counted so the page never re-buckets. */
export interface PmAgeBucket {
  key: string;
  label: string;
  count: number;
}

export interface PmProject {
  kickoffId: string;
  projectName: string;
  orderId: string;
  orderNumber: string;
  pmId: string;
  pm: string;
  health: ProjectHealth;
  healthReason: string;
  currentStage: string;
  stages: Array<{
    key: string;
    label: string;
    state: ProjectStageState;
    detail: string;
  }>;
  ageDays: number;
  promisedDeliveryDate: string | null;
  /** Whole days until the promised date; null when no executed OCS date exists. */
  daysUntilDue: number | null;
  fulfilmentStatus: string;
  lineCount: number;
  openMilestones: number;
  overdueMilestones: number;
  openActionItems: number;
  overdueActionItems: number;
  openHighRisks: number;
  openTasks: number;
  overdueTasks: number;
  nextMilestone: {
    name: string;
    targetDate: string;
    owner: string;
    overdue: boolean;
  } | null;
}

export interface PmBlockerEntry {
  kickoffId: string;
  project: string;
  orderNumber: string;
  pm: string;
  pmId: string;
  kind: 'HEALTH' | 'MILESTONE' | 'ACTION_ITEM' | 'RISK';
  blocker: string;
  owner: string;
  ownerIsPm: boolean;
  overdueDays: number | null;
  severity: 'BLOCKED' | 'AT_RISK';
}

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
  /** 0-100 against the busiest PM; null when nobody carries any task. */
  loadPercent: string | null;
  tasksPerProject: number | null;
  troubledPercent: string | null;
}

/**
 * The executive Project Management dashboard.
 *
 * Two conventions carry over from the backend and must be rendered as they
 * arrive:
 *
 *  - `null` means "the data cannot answer this", never zero. A percentage with
 *    no denominator arrives null and renders as an em dash beside the section's
 *    own `note`, which explains why.
 *  - Percentages arrive as fixed-2 strings so the page never re-rounds them.
 *
 * Deliberately project-side only: no revenue, margin, customer or purchasing
 * figure is on the wire at all.
 */
export interface ProjectManagementDashboard {
  asOf: string;
  basis: string[];
  portfolio: {
    activeTotal: number;
    totalEverStarted: number;
    onTrack: number;
    atRisk: number;
    blocked: number;
    total: number;
    troubledPercent: string | null;
    averageAgeDays: number | null;
    ageBuckets: PmAgeBucket[];
    stages: Array<{
      key: string;
      label: string;
      count: number;
      blocked: number;
      atRisk: number;
      percentOfActive: string | null;
    }>;
    /** The one project to look at first, straight from the backend's ranking. */
    worst: PmProject | null;
    pmCount: number;
    note: string | null;
    asOf: string;
  };
  projects: PmProject[];
  blockers: {
    total: number;
    projectsAffected: number;
    unassigned: number;
    byKind: Array<{ kind: string; label: string; count: number }>;
    owners: Array<{
      owner: string;
      count: number;
      projectCount: number;
      sharePercent: string | null;
    }>;
    entries: PmBlockerEntry[];
    note: string | null;
  };
  delivery: {
    measured: number;
    unconfirmed: number;
    overdue: number;
    overduePercent: string | null;
    averageOverrunDays: number | null;
    rows: Array<{
      kickoffId: string;
      projectName: string;
      orderNumber: string;
      pm: string;
      pmId: string;
      health: ProjectHealth;
      currentStage: string;
      promisedDeliveryDate: string | null;
      daysUntilDue: number | null;
      fulfilmentStatus: string;
    }>;
    note: string | null;
    asOf: string;
  };
  workload: {
    pmCount: number;
    totalOpenTasks: number;
    peakOpenTasks: number;
    /** 0 = evenly spread, 100 = one PM carries everything; null under 2 PMs. */
    taskImbalancePercent: string | null;
    projectImbalancePercent: string | null;
    averageTasksPerPm: number | null;
    averageProjectsPerPm: number | null;
    rows: PmWorkloadRow[];
    note: string | null;
  };
  awaitingKickoff: {
    total: number;
    alreadyOverdue: number;
    averageWaitingDays: number | null;
    ageBuckets: PmAgeBucket[];
    rows: Array<{
      id: string;
      orderNumber: string;
      orderType: string;
      source: 'OCS_EXECUTED' | 'INTERNAL_CONFIRMED';
      lineCount: number;
      qualifiedAt: string;
      waitingDays: number;
      promisedDeliveryDate: string | null;
      daysUntilDue: number | null;
    }>;
    note: string | null;
  };
  ordersAwaitingDelivery: {
    total: number;
    lineCount: number;
    byStatus: Array<{
      status: string;
      label: string;
      count: number;
      percentOfOutstanding: string | null;
    }>;
    rows: Array<{
      orderId: string;
      orderNumber: string;
      projectName: string;
      pm: string;
      pmId: string;
      fulfilmentStatus: string;
      lineCount: number;
      daysUntilDue: number | null;
    }>;
    note: string | null;
  };
  milestones: {
    total: number;
    completed: number;
    open: number;
    overdue: number;
    flaggedDelayed: number;
    completionPercent: string | null;
    overdueOfOpenPercent: string | null;
    averageSlipDays: number | null;
    slipBuckets: PmAgeBucket[];
    upcoming: Array<{
      id: string;
      kickoffId: string;
      project: string;
      pm: string;
      pmId: string;
      name: string;
      status: string;
      targetDate: string;
      owner: string;
      daysUntilDue: number;
    }>;
    rows: Array<{
      id: string;
      kickoffId: string;
      project: string;
      pm: string;
      pmId: string;
      name: string;
      status: string;
      targetDate: string;
      owner: string;
      overdue: boolean;
      overdueDays: number;
      flaggedDelayed: boolean;
    }>;
    note: string | null;
  };
  actionItems: {
    total: number;
    open: number;
    overdue: number;
    done: number;
    undated: number;
    /** Card archived or deleted: no live status left to act on. */
    withoutLiveStatus: number;
    completionPercent: string | null;
    overdueOfOpenPercent: string | null;
    averageSlipDays: number | null;
    byStatus: Array<{ status: string; label: string; count: number }>;
    rows: Array<{
      id: string;
      kickoffId: string;
      project: string;
      pm: string;
      pmId: string;
      description: string;
      owner: string;
      dueDate: string | null;
      status: string;
      open: boolean;
      overdue: boolean;
      overdueDays: number | null;
    }>;
    note: string | null;
  };
  risks: {
    total: number;
    open: number;
    highImpactOpen: number;
    unmitigated: number;
    unmitigatedPercent: string | null;
    projectsAffected: number;
    matrix: Array<{ impact: string; likelihood: string; count: number }>;
    rows: Array<{
      id: string;
      kickoffId: string;
      project: string;
      pm: string;
      pmId: string;
      description: string;
      likelihood: string;
      impact: string;
      status: string;
      owner: string;
      hasMitigation: boolean;
      highImpactOpen: boolean;
      severity: number;
    }>;
    note: string | null;
  };
  pings: {
    total: number;
    pastEscalation: number;
    escalationRatePercent: string | null;
    unacknowledged: number;
    averageAgeHours: number | null;
    oldestAgeHours: number | null;
    projectsAffected: number;
    byLinkedRecord: Array<{ type: string; label: string; count: number }>;
    rows: Array<{
      id: string;
      kickoffId: string;
      project: string;
      pm: string;
      pmId: string | null;
      message: string;
      from: string;
      linkedRecordType: string | null;
      linkedRecordId: string | null;
      createdAt: string;
      ageHours: number;
      unacknowledged: boolean;
      owners: string[];
    }>;
    note: string | null;
  };
}

export function fetchProjectManagementDashboard() {
  return apiFetch<ProjectManagementDashboard>('/executive/dashboards/project-management');
}

/**
 * The SCM dashboard. Deliberately supply-side only: no revenue, no margin and no
 * customer name is on the wire at all — the backend strips the customer from the
 * PLM rows, the resource-plan rows and the BOM intakes rather than relying on the
 * page not to render it.
 *
 * Two honesty conventions carry through from the backend and must be rendered as
 * they arrive:
 *  - a `null` number means "the data cannot answer this", never zero;
 *  - `note` is the backend's own explanation of what a metric is measured from
 *    (the RFQ clock's start, the award→PO provenance match, the audit queue), so
 *    it is shown rather than paraphrased.
 */
export type ScmTrendDirection = 'RISING' | 'FALLING' | 'FLAT';

export interface ScmMonthPoint {
  key: string;
  label: string;
  value: number | null;
}

export interface ScmPartnerParticipation {
  key: string;
  partnerName: string;
  partnerType: 'VENDOR' | 'SUPPLIER';
  invited: number;
  submitted: number;
  declined: number;
  /** Invited, never answered — the reliability gap qualification cannot show. */
  silent: number;
  participationPercent: string | null;
  averageResponseDays: number | null;
  revisions: number;
  revisionRequests: number;
}

export interface ScmVendorLine {
  trackerId: string;
  orderId: string;
  orderNumber: string;
  productName: string;
  productSku: string;
  splitQuantity: string;
  currentStage: PlmDashboardItem['currentStage'];
  ownerName: string;
  ageDays: number;
  promisedDeliveryDate: string | null;
  daysUntilDue: number | null;
  blocker: string | null;
  health: 'ON_TRACK' | 'AT_RISK' | 'BLOCKED';
  cadenceStatus: 'GREEN' | 'AMBER' | 'RED' | null;
  updateOverdue: boolean;
  cadenceDueAt: string | null;
  lastUpdateAt: string | null;
  production: { done: number; total: number };
  /** What the vendor last told us about this line — not something we measured. */
  selfReport: {
    reportedAt: string;
    reporterDisplayName: string;
    stepPercent: number | null;
    completedSteps: number | null;
    fabricationPercent: number | null;
    surfaceFinishPercent: number | null;
    assemblyPercent: number | null;
    notes: string | null;
  } | null;
}

export interface ScmDashboard {
  asOf: string;
  period: { label: string; startsOn: string; endsBefore: string };
  basis: string[];
  rfqHealth: {
    open: {
      total: number;
      draft: number;
      awaitingPmApproval: number;
      pmRejected: number;
      approvedNotIssued: number;
      issued: number;
      closedAwaitingAward: number;
      awaitingPmApprovalRfqs: Array<{
        id: string;
        rfqNumber: string;
        title: string;
        lineCount: number;
        inviteeCount: number;
        createdAt: string;
        waitingDays: number;
        rejectedOnce: boolean;
      }>;
    };
    responseTime: {
      averageDays: number | null;
      quotesMeasured: number;
      status: DataMaturity;
      note: string;
      pmApprovalLagDays: number | null;
      pmApprovalsMeasured: number;
    };
    awardCycle: {
      averageDays: number | null;
      rfqsMeasured: number;
      status: DataMaturity;
      note: string;
    };
    participation: {
      invited: number;
      submitted: number;
      percent: string | null;
      status: DataMaturity;
      note: string;
      partners: ScmPartnerParticipation[];
    };
    nonLowestAwards: {
      count: number;
      comparableAwards: number;
      lowestWins: number;
      percent: string | null;
      status: DataMaturity;
      note: string;
      awards: Array<{
        rfqId: string;
        rfqNumber: string;
        title: string;
        awardedTo: string;
        awardedAt: string;
        premiumAmount: string | null;
        premiumPercent: string | null;
        justification: string | null;
        quotesCompared: number;
      }>;
    };
    quoteRevisions: {
      revisions: number;
      revisionRequests: number;
      note: string;
      partners: Array<{
        key: string;
        partnerName: string;
        partnerType: 'VENDOR' | 'SUPPLIER';
        revisions: number;
        revisionRequests: number;
      }>;
    };
  };
  purchaseOrders: {
    open: {
      count: number;
      value: string | null;
      pendingReceipt: number;
      partiallyReceived: number;
      note: string;
    };
    overdue: {
      count: number;
      value: string | null;
      orders: Array<{
        id: string;
        poNumber: string;
        status: string;
        partyName: string;
        expectedDeliveryDate: string | null;
        daysOverdue: number;
        value: string | null;
      }>;
      /** Neither overdue nor on time — simply unmeasurable, and said so. */
      withoutExpectedDate: number;
    };
    adHoc: {
      pendingCount: number;
      pendingValue: string | null;
      oldestPendingAt: string | null;
      approvedThisPeriod: number;
      note: string;
      orders: Array<{
        id: string;
        poNumber: string;
        partyName: string;
        createdAt: string;
        waitingDays: number;
        value: string | null;
      }>;
    };
    cycleTime: {
      averageDays: number | null;
      posMeasured: number;
      awardsInPeriod: number;
      awardsMatched: number;
      status: DataMaturity;
      note: string;
    };
  };
  supplyBase: {
    registered: {
      total: number;
      vendors: number;
      suppliers: number;
      classified: number;
      unclassified: number;
      note: string;
    };
    classification: ScmPartnerBreakdown[];
    onboarded: {
      thisPeriod: number;
      vendors: number;
      suppliers: number;
      percentOfBase: string | null;
      note: string;
    };
    auditQueue: {
      total: number;
      stages: ScmPartnerBreakdown[];
      note: string;
    };
    overrides: {
      count: number;
      note: string;
      partners: Array<{
        id: string;
        partnerName: string;
        partnerType: 'VENDOR' | 'SUPPLIER';
        status: string;
        statusLabel: string;
      }>;
    };
    concentration: {
      totalPoValue: string | null;
      status: DataMaturity;
      note: string;
      topPartnerName: string | null;
      topPartnerPercent: string | null;
      partners: Array<{
        name: string;
        value: string;
        percentOfTotal: string | null;
      }>;
    };
  };
  vendorProjects: {
    vendorCount: number;
    lineCount: number;
    overdueUpdates: number;
    blockedLines: number;
    unlinkedVendorCount: number;
    note: string;
    vendors: Array<{
      key: string;
      vendorName: string;
      vendorId: string | null;
      activeLines: number;
      blockedLines: number;
      overdueUpdates: number;
      dueSoonUpdates: number;
      onScheduleUpdates: number;
      lines: ScmVendorLine[];
    }>;
  };
  sourcingBacklog: {
    total: number;
    intakes: {
      count: number;
      note: string;
      rows: Array<{
        id: string;
        productName: string;
        businessUnit: string;
        lineCount: number;
        hasBom: boolean;
        readySince: string;
        idleDays: number;
      }>;
    };
    draftRfqs: {
      count: number;
      note: string;
      rows: Array<{
        id: string;
        rfqNumber: string;
        title: string;
        lineCount: number;
        inviteeCount: number;
        awaitingPmApproval: boolean;
        fromKickoff: boolean;
        fromBomIntake: boolean;
        idleSince: string;
        idleDays: number;
      }>;
    };
  };
  costPerformance: {
    /**
     * RESTRICTED when the viewer holds the executive grant but not item-cost
     * visibility: the section is withheld rather than the cost-view policy
     * widened.
     */
    status: DataMaturity | 'RESTRICTED';
    note: string;
    projectsWithPlan: number;
    projectsCostComplete: number;
    projectsOverBenchmark: number;
    totalBenchmarkCost: string | null;
    totalNegotiatedCost: string | null;
    varianceAmount: string | null;
    variancePercent: string | null;
    projects: Array<{
      planId: string;
      projectKickoffId: string;
      projectName: string;
      orderNumber: string;
      totalBenchmarkCost: string | null;
      totalNegotiatedCost: string | null;
      varianceAmount: string | null;
      variancePercent: string | null;
      isCostComplete: boolean;
      lineCount: number;
      negotiatedLineCount: number;
    }>;
  };
  qualityOfSupply: {
    ncrs: {
      raisedThisPeriod: number;
      open: number;
      dispositioned: number;
      closed: number;
      status: DataMaturity;
      note: string;
      trend: Array<{ key: string; label: string; value: number }>;
      direction: ScmTrendDirection | null;
      dispositions: Array<{
        disposition: string;
        label: string;
        count: number;
      }>;
      undispositioned: number;
      recent: Array<{
        id: string;
        ncrNumber: string;
        itemName: string;
        itemCode: string;
        partnerName: string;
        poNumber: string;
        grnNumber: string;
        rejectedQuantity: string;
        status: string;
        disposition: string | null;
        raisedAt: string;
      }>;
    };
    partners: Array<{
      key: string;
      partnerName: string;
      partnerType: 'VENDOR' | 'SUPPLIER' | 'AD_HOC';
      ncrCount: number;
      openCount: number;
      returned: number;
      rejectedQuantity: string;
    }>;
    grnBacklog: {
      count: number;
      oldestReceivedAt: string | null;
      note: string;
      rows: Array<{
        id: string;
        grnNumber: string;
        poNumber: string;
        partyName: string;
        receivedDate: string;
        waitingDays: number;
      }>;
    };
    periodLabel: string;
  };
  leadTime: {
    averageDays: number | null;
    quotesMeasured: number;
    status: DataMaturity;
    note: string;
    direction: ScmTrendDirection | null;
    trend: ScmMonthPoint[];
    partners: Array<{
      key: string;
      partnerName: string;
      quotesMeasured: number;
      averageDays: number;
    }>;
  };
}

export interface ScmPartnerBreakdown {
  status: string;
  label: string;
  vendors: number;
  suppliers: number;
  total: number;
}

export function fetchScmDashboard() {
  return apiFetch<ScmDashboard>('/executive/dashboards/scm');
}
