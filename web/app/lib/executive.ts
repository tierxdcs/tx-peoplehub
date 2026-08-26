import { apiFetch } from './api';

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
