import { describe, expect, it } from 'vitest';
import type { PlmDashboardItem } from './plm';
import {
  dominantBlockers,
  filterAndSortPlmItems,
  groupPlmItemsByOrder,
  type PlmWorkspaceFilters,
} from './plm-workspace';

const filters: PlmWorkspaceFilters = {
  search: '',
  customer: 'ALL',
  owner: 'ALL',
  stage: 'ALL',
  health: 'ALL',
  flowType: 'ALL',
  sort: 'URGENCY',
};

function item(overrides: Partial<PlmDashboardItem>): PlmDashboardItem {
  return {
    trackerId: 'tracker-1',
    orderId: 'order-1',
    orderNumber: 'ORD-2026-0001',
    customerName: 'Customer One',
    productName: 'Floor Rack',
    productSku: 'RACK-1',
    flowType: 'VENDOR',
    currentStage: 'PRODUCTION',
    ownerName: 'Project Owner',
    ageDays: 4,
    promisedDeliveryDate: '2026-09-01T00:00:00.000Z',
    daysUntilDue: 10,
    blocker: null,
    health: 'ON_TRACK',
    production: { done: 1, total: 2 },
    hasPendingPing: false,
    updatedAt: '2026-08-20T00:00:00.000Z',
    ...overrides,
  };
}

describe('PLM workspace list helpers', () => {
  it('searches by order, product and SKU and applies every register filter', () => {
    const matching = item({ trackerId: 'matching' });
    const other = item({
      trackerId: 'other',
      orderId: 'order-2',
      orderNumber: 'ORD-2026-0002',
      customerName: 'Other Customer',
      ownerName: 'Other Owner',
      productName: 'Power unit',
      productSku: 'PDU-2',
      flowType: 'IN_HOUSE',
      currentStage: 'QC',
      health: 'BLOCKED',
    });

    expect(
      filterAndSortPlmItems([matching, other], {
        ...filters,
        search: 'rack-1',
      }),
    ).toEqual([matching]);
    expect(
      filterAndSortPlmItems([matching, other], {
        ...filters,
        customer: 'Customer One',
        owner: 'Project Owner',
        stage: 'PRODUCTION',
        health: 'ON_TRACK',
        flowType: 'VENDOR',
      }),
    ).toEqual([matching]);
  });

  it('sorts by real delivery urgency or longest days in stage', () => {
    const calm = item({ trackerId: 'calm', daysUntilDue: 20, ageDays: 12 });
    const urgent = item({ trackerId: 'urgent', daysUntilDue: 2, ageDays: 2 });
    const unknown = item({
      trackerId: 'unknown',
      daysUntilDue: null,
      promisedDeliveryDate: null,
      ageDays: 30,
    });

    expect(
      filterAndSortPlmItems([calm, unknown, urgent], filters).map(
        (row) => row.trackerId,
      ),
    ).toEqual(['urgent', 'calm', 'unknown']);
    expect(
      filterAndSortPlmItems([calm, unknown, urgent], {
        ...filters,
        sort: 'DAYS_IN_STAGE',
      }).map((row) => row.trackerId),
    ).toEqual(['unknown', 'calm', 'urgent']);
  });

  it('summarizes dominant blockers and groups lines by order', () => {
    const rows = [
      item({ trackerId: 'a', blocker: 'Challan required' }),
      item({ trackerId: 'b', blocker: 'Challan required' }),
      item({ trackerId: 'c', orderId: 'order-2', blocker: 'QC required' }),
    ];

    expect(dominantBlockers(rows)).toEqual([
      { reason: 'Challan required', count: 2 },
      { reason: 'QC required', count: 1 },
    ]);
    expect(
      groupPlmItemsByOrder(rows).map((group) => [
        group.orderId,
        group.lines.length,
      ]),
    ).toEqual([
      ['order-1', 2],
      ['order-2', 1],
    ]);
  });
});
