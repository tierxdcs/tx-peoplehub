import type { PlmDashboardItem, PlmStage } from './plm';

export type PlmWorkspaceFilters = {
  search: string;
  customer: string;
  owner: string;
  stage: 'ALL' | PlmStage;
  health: 'ALL' | PlmDashboardItem['health'];
  flowType: 'ALL' | PlmDashboardItem['flowType'];
  sort: 'URGENCY' | 'DAYS_IN_STAGE';
};

export function filterAndSortPlmItems(
  items: PlmDashboardItem[],
  filters: PlmWorkspaceFilters,
) {
  const query = filters.search.trim().toLocaleLowerCase();
  return items
    .filter(
      (item) =>
        (!query ||
          `${item.orderNumber} ${item.productName} ${item.productSku}`
            .toLocaleLowerCase()
            .includes(query)) &&
        (filters.customer === 'ALL' ||
          item.customerName === filters.customer) &&
        (filters.owner === 'ALL' || item.ownerName === filters.owner) &&
        (filters.stage === 'ALL' || item.currentStage === filters.stage) &&
        (filters.health === 'ALL' || item.health === filters.health) &&
        (filters.flowType === 'ALL' || item.flowType === filters.flowType),
    )
    .sort((a, b) => {
      if (filters.sort === 'DAYS_IN_STAGE') return b.ageDays - a.ageDays;
      if (a.daysUntilDue == null && b.daysUntilDue == null)
        return b.ageDays - a.ageDays;
      if (a.daysUntilDue == null) return 1;
      if (b.daysUntilDue == null) return -1;
      return a.daysUntilDue - b.daysUntilDue || b.ageDays - a.ageDays;
    });
}

export function dominantBlockers(items: PlmDashboardItem[], limit = 2) {
  const counts = new Map<string, number>();
  for (const item of items) {
    if (item.blocker)
      counts.set(item.blocker, (counts.get(item.blocker) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason))
    .slice(0, limit);
}

export function groupPlmItemsByOrder(items: PlmDashboardItem[]) {
  const groups = new Map<string, PlmDashboardItem[]>();
  for (const item of items) {
    const existing = groups.get(item.orderId) ?? [];
    existing.push(item);
    groups.set(item.orderId, existing);
  }
  return [...groups.entries()].map(([orderId, lines]) => ({ orderId, lines }));
}
