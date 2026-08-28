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
 * Where a chart node links to: your own node goes to My Profile, everyone
 * else's to the company directory profile (which carries their own mini chart).
 */
export function orgProfileHref(
  nodeId: string,
  currentUserId?: string | null,
): string {
  return nodeId === currentUserId ? '/profile' : `/people/${nodeId}`;
}

/** child id -> parent id, taken from the tree the walk actually built (so it is
 *  cycle-free by construction, unlike following reportingManagerId blindly). */
export function buildParentMap(roots: OrgTreeNode[]): Map<string, string> {
  const parents = new Map<string, string>();
  const visit = (node: OrgTreeNode) => {
    for (const child of node.children) {
      parents.set(child.id, node.id);
      visit(child);
    }
  };
  roots.forEach(visit);
  return parents;
}

/** The manager chain above `id`, root-first, from a prebuilt parent map. */
export function chainToRoot(
  parents: Map<string, string>,
  id: string,
): string[] {
  const chain: string[] = [];
  let cursor = parents.get(id);
  while (cursor) {
    chain.unshift(cursor);
    cursor = parents.get(cursor);
  }
  return chain;
}

/** Every id in the forest, indexed. */
export function indexById(roots: OrgTreeNode[]): Map<string, OrgTreeNode> {
  const byId = new Map<string, OrgTreeNode>();
  const visit = (node: OrgTreeNode) => {
    byId.set(node.id, node);
    node.children.forEach(visit);
  };
  roots.forEach(visit);
  return byId;
}

/** Everyone underneath `node`, at any depth (the headcount a fold hides). */
export function descendantCount(node: OrgTreeNode): number {
  return node.children.reduce(
    (total, child) => total + 1 + descendantCount(child),
    0,
  );
}

/** Nodes that can be folded at all, i.e. the ones that have reports. */
export function collapsibleIds(roots: OrgTreeNode[]): Set<string> {
  const ids = new Set<string>();
  const visit = (node: OrgTreeNode) => {
    if (node.children.length > 0) ids.add(node.id);
    node.children.forEach(visit);
  };
  roots.forEach(visit);
  return ids;
}

/**
 * What starts folded: every manager from `fromDepth` down, so the chart opens on
 * the top three levels rather than the entire company. Collapse state is stored
 * as the folded set (empty = fully expanded), which makes "expand all" a clear.
 */
export function initialCollapsedIds(
  roots: OrgTreeNode[],
  fromDepth = 2,
): Set<string> {
  const ids = new Set<string>();
  const visit = (node: OrgTreeNode) => {
    if (node.depth >= fromDepth && node.children.length > 0) ids.add(node.id);
    node.children.forEach(visit);
  };
  roots.forEach(visit);
  return ids;
}

/** Node box geometry — shared by the layout pass and the cards that render it. */
export const ORG_NODE_WIDTH = 208;
export const ORG_NODE_HEIGHT = 62;
export const ORG_GAP_X = 26;
export const ORG_GAP_Y = 66;

export interface OrgLayoutNode {
  node: OrgTreeNode;
  /** Left/top of the card in canvas space (cards are absolutely positioned). */
  x: number;
  y: number;
  /** Reports hidden by this node being folded (0 when it is open). */
  hiddenCount: number;
  collapsed: boolean;
}

export interface OrgLayoutEdge {
  parentId: string;
  childId: string;
  /** Bottom-centre of the parent card. */
  x1: number;
  y1: number;
  /** Top-centre of the child card. */
  x2: number;
  y2: number;
}

export interface OrgLayout {
  nodes: OrgLayoutNode[];
  edges: OrgLayoutEdge[];
  width: number;
  height: number;
}

/**
 * Tidy top-down layout of the visible tree: leaves take the next slot on the x
 * axis, a parent centres over the span of its visible children, and depth maps
 * straight to y. Folded nodes are laid out as leaves, so folding genuinely
 * reclaims horizontal space and no two cards can overlap for any tree shape.
 */
export function layoutOrgTree(
  roots: OrgTreeNode[],
  collapsed: Set<string>,
): OrgLayout {
  const stepX = ORG_NODE_WIDTH + ORG_GAP_X;
  const stepY = ORG_NODE_HEIGHT + ORG_GAP_Y;
  const nodes: OrgLayoutNode[] = [];
  const at = new Map<string, OrgLayoutNode>();
  let slot = 0;

  const place = (node: OrgTreeNode, depth: number): number => {
    const isFolded = collapsed.has(node.id) && node.children.length > 0;
    const visibleChildren = isFolded ? [] : node.children;

    let x: number;
    if (visibleChildren.length === 0) {
      x = slot * stepX;
      slot += 1;
    } else {
      const childXs = visibleChildren.map((child) => place(child, depth + 1));
      x = (childXs[0] + childXs[childXs.length - 1]) / 2;
    }

    const placed: OrgLayoutNode = {
      node,
      x,
      y: depth * stepY,
      collapsed: isFolded,
      hiddenCount: isFolded ? descendantCount(node) : 0,
    };
    nodes.push(placed);
    at.set(node.id, placed);
    return x;
  };

  roots.forEach((root) => place(root, 0));

  const edges: OrgLayoutEdge[] = [];
  for (const placed of nodes) {
    if (placed.collapsed) continue;
    for (const child of placed.node.children) {
      const childPos = at.get(child.id);
      if (!childPos) continue;
      edges.push({
        parentId: placed.node.id,
        childId: child.id,
        x1: placed.x + ORG_NODE_WIDTH / 2,
        y1: placed.y + ORG_NODE_HEIGHT,
        x2: childPos.x + ORG_NODE_WIDTH / 2,
        y2: childPos.y,
      });
    }
  }

  return {
    nodes,
    edges,
    width: nodes.reduce((max, n) => Math.max(max, n.x + ORG_NODE_WIDTH), 0),
    height: nodes.reduce((max, n) => Math.max(max, n.y + ORG_NODE_HEIGHT), 0),
  };
}

/** Live search: name, job title or department, case-insensitive. */
export function matchingNodeIds(
  roots: OrgTreeNode[],
  query: string,
): Set<string> {
  const needle = query.trim().toLowerCase();
  const hits = new Set<string>();
  if (!needle) return hits;
  for (const node of indexById(roots).values()) {
    const haystack = [node.fullName, node.designation, node.verticalName]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    if (haystack.includes(needle)) hits.add(node.id);
  }
  return hits;
}

/** The department label a node is coloured and grouped by. */
export function departmentOf(node: OrgChartNode): string {
  return node.verticalName ?? 'Unassigned';
}

/**
 * Department colours, assigned from a fixed palette in stable (alphabetical)
 * order so the same company always gets the same legend. Deliberately no blue —
 * blue is the interaction accent (selection ring, active reporting line), and
 * the two must not read as the same signal. Mid-tone hues so one value stays
 * legible in both themes.
 */
const DEPARTMENT_PALETTE = [
  '#8B5CF6',
  '#10B981',
  '#F59E0B',
  '#06B6D4',
  '#EC4899',
  '#84CC16',
  '#F97316',
  '#14B8A6',
  '#A855F7',
  '#EF4444',
];
const UNASSIGNED_COLOUR = '#94A3B8';

export function departmentColours(nodes: OrgChartNode[]): Map<string, string> {
  const names = [...new Set(nodes.map(departmentOf))]
    .filter((name) => name !== 'Unassigned')
    .sort((a, b) => a.localeCompare(b));
  const colours = new Map<string, string>();
  names.forEach((name, index) => {
    colours.set(name, DEPARTMENT_PALETTE[index % DEPARTMENT_PALETTE.length]);
  });
  colours.set('Unassigned', UNASSIGNED_COLOUR);
  return colours;
}
