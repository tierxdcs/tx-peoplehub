import type { PlmDashboardItem } from './plm';
import { dominantBlockers } from './plm-workspace';
import type { ProjectProgress } from './project-kickoff';

const HEALTH_PRIORITY = { BLOCKED: 0, AT_RISK: 1, ON_TRACK: 2 } as const;

function dateRank(value: string | null): number {
  return value ? new Date(value).getTime() : Number.POSITIVE_INFINITY;
}

export function priorityProjects(
  projects: ProjectProgress[],
  limit = 4,
): ProjectProgress[] {
  return [...projects]
    .sort(
      (left, right) =>
        HEALTH_PRIORITY[left.health] - HEALTH_PRIORITY[right.health] ||
        dateRank(left.nextDueDate) - dateRank(right.nextDueDate) ||
        new Date(right.updatedAt).getTime() -
          new Date(left.updatedAt).getTime(),
    )
    .slice(0, limit);
}

export function urgentLifecycleWork(
  items: PlmDashboardItem[],
  limit = 4,
): PlmDashboardItem[] {
  return [...items]
    .sort(
      (left, right) =>
        HEALTH_PRIORITY[left.health] - HEALTH_PRIORITY[right.health] ||
        (left.daysUntilDue ?? Number.POSITIVE_INFINITY) -
          (right.daysUntilDue ?? Number.POSITIVE_INFINITY) ||
        right.ageDays - left.ageDays,
    )
    .slice(0, limit);
}

export function portfolioHealth(projects: ProjectProgress[]) {
  return {
    onTrack: projects.filter((project) => project.health === 'ON_TRACK').length,
    atRisk: projects.filter((project) => project.health === 'AT_RISK').length,
    blocked: projects.filter((project) => project.health === 'BLOCKED').length,
  };
}

/** Same canonical blocker aggregation used by the full PLM workspace. */
export function portfolioBlockers(items: PlmDashboardItem[], limit = 5) {
  return dominantBlockers(items, limit);
}
