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
