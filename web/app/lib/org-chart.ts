import { apiFetch } from './api';

/**
 * Org chart client — a read-only view of the reporting structure that already
 * exists on Employee.reportingManagerId, with the photo onboarding captured.
 * Both the profile mini chart and the full-company page read these two
 * endpoints and share the tree/href helpers below, so "who is a root", "who
 * are my children" and "where does a node link to" are each defined once.
 */

export interface OrgChartNode {
  id: string;
  employeeId: string;
  firstName: string;
  lastName: string;
  fullName: string;
  designation: string | null;
  verticalName: string | null;
  email: string;
  /**
   * Manager within the chart being viewed — the backend already normalises this
   * to null when the manager isn't part of it, so `=== null` IS "this is a
   * root"; never re-derive it from anything else.
   */
  reportingManagerId: string | null;
  directReportCount: number;
  /** Short-lived signed URL; null means "render initials". */
  photoUrl: string | null;
}

export interface CompanyOrgChart {
  nodes: OrgChartNode[];
  rootIds: string[];
}

export interface OrgChartNeighbourhood {
  manager: OrgChartNode | null;
  employee: OrgChartNode;
  reports: OrgChartNode[];
}

/** The whole company hierarchy (flat). */
export const fetchCompanyOrgChart = () =>
  apiFetch<CompanyOrgChart>('/employees/org-chart');

/** One employee's manager / self / direct reports, for a profile mini chart. */
export const fetchEmployeeOrgChart = (employeeId: string) =>
  apiFetch<OrgChartNeighbourhood>(`/employees/${employeeId}/org-chart`);

export interface OrgTreeNode extends OrgChartNode {
  children: OrgTreeNode[];
  /** 0 for a root; used to pick the default expansion depth. */
  depth: number;
}

function byName(a: OrgChartNode, b: OrgChartNode) {
  return a.fullName.localeCompare(b.fullName);
}

/**
 * Turn the flat node list into a forest. Roots come from the backend's rootIds;
 * anyone the walk can't reach from a root (only possible if the reporting data
 * contains a cycle) is promoted to a root of their own, so a bad chain shows up
 * as an extra top-level branch instead of hanging the render or silently
 * dropping people.
 */
export function buildOrgTree(chart: CompanyOrgChart): OrgTreeNode[] {
  const byId = new Map<string, OrgTreeNode>(
    chart.nodes.map((node) => [node.id, { ...node, children: [], depth: 0 }]),
  );
  for (const node of byId.values()) {
    if (!node.reportingManagerId) continue;
    const parent = byId.get(node.reportingManagerId);
    if (parent && parent.id !== node.id) parent.children.push(node);
  }

  const visited = new Set<string>();
  const walk = (node: OrgTreeNode, depth: number) => {
    node.depth = depth;
    // Drop any child already placed — the only way that happens is a cycle.
    node.children = node.children.filter((child) => !visited.has(child.id));
    node.children.sort(byName);
    for (const child of node.children) {
      visited.add(child.id);
      walk(child, depth + 1);
    }
  };

  const roots: OrgTreeNode[] = [];
  const seeds = [
    ...chart.rootIds,
    // Cycle fallback, in a stable order.
    ...[...byId.keys()].sort(),
  ];
  for (const id of seeds) {
    const node = byId.get(id);
    if (!node || visited.has(id)) continue;
    visited.add(id);
    roots.push(node);
    walk(node, 0);
  }
  roots.sort(byName);
  return roots;
}

/**
 * Ids to start expanded: every node down to `maxDepth`, so the page opens on
 * the top of the company plus one level rather than the whole tree. A node is
 * "expanded" when ITS children are visible.
 */
export function defaultExpandedIds(
  roots: OrgTreeNode[],
  maxDepth = 1,
): Set<string> {
  const expanded = new Set<string>();
  const visit = (node: OrgTreeNode) => {
    if (node.depth <= maxDepth) expanded.add(node.id);
    node.children.forEach(visit);
  };
  roots.forEach(visit);
  return expanded;
}

/**
 * The chain of managers above `id`, root-first (empty when the id is a root or
 * isn't in the forest). Expanding these is what makes a focused person visible
 * without expanding the whole tree.
 */
export function ancestorIds(roots: OrgTreeNode[], id: string): string[] {
  const find = (node: OrgTreeNode, trail: string[]): string[] | null => {
    if (node.id === id) return trail;
    for (const child of node.children) {
      const hit = find(child, [...trail, node.id]);
      if (hit) return hit;
    }
    return null;
  };
  for (const root of roots) {
    const hit = find(root, []);
    if (hit) return hit;
  }
  return [];
}

/** Every id in the forest (for "expand all"). */
export function allNodeIds(roots: OrgTreeNode[]): Set<string> {
  const ids = new Set<string>();
  const visit = (node: OrgTreeNode) => {
    ids.add(node.id);
    node.children.forEach(visit);
  };
  roots.forEach(visit);
  return ids;
}

/**
 * Where a chart node links to: your own node goes to My Profile, everyone
 * else's to the company directory profile (which carries their own mini chart).
 */
export function orgProfileHref(
  nodeId: string,
  currentUserId?: string | null,
): string {
  return nodeId === currentUserId ? '/profile' : `/people/${nodeId}`;
}
