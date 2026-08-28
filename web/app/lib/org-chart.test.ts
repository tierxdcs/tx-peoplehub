import { describe, expect, it } from 'vitest';
import {
  CompanyOrgChart,
  ORG_GAP_X,
  ORG_NODE_WIDTH,
  OrgChartNode,
  buildOrgTree,
  buildParentMap,
  chainToRoot,
  collapsibleIds,
  departmentColours,
  departmentOf,
  descendantCount,
  indexById,
  initialCollapsedIds,
  layoutOrgTree,
  matchingNodeIds,
  orgProfileHref,
} from './org-chart';

function node(
  id: string,
  reportingManagerId: string | null = null,
  extra: Partial<OrgChartNode> = {},
): OrgChartNode {
  return {
    id,
    employeeId: `EMP-${id}`,
    firstName: id,
    lastName: 'X',
    fullName: `${id} X`,
    designation: null,
    verticalName: null,
    email: `${id}@example.com`,
    reportingManagerId,
    directReportCount: 0,
    photoUrl: null,
    ...extra,
  };
}

/**
 *   ceo
 *   ├── cto ── dev1, dev2
 *   └── cfo
 *   orphan   (manager not in the chart — the API already nulled the link)
 */
const CHART: CompanyOrgChart = {
  nodes: [
    node('ceo'),
    node('cto', 'ceo'),
    node('cfo', 'ceo'),
    node('dev1', 'cto'),
    node('dev2', 'cto'),
    node('orphan'),
  ],
  rootIds: ['ceo', 'orphan'],
};

describe('buildOrgTree', () => {
  it('nests each person under their manager', () => {
    const roots = buildOrgTree(CHART);
    expect(roots.map((r) => r.id)).toEqual(['ceo', 'orphan']);
    const ceo = roots[0];
    expect(ceo.children.map((c) => c.id)).toEqual(['cfo', 'cto']);
    expect(ceo.children[1].children.map((c) => c.id)).toEqual(['dev1', 'dev2']);
  });

  it('stamps depth from the root', () => {
    const roots = buildOrgTree(CHART);
    expect(roots[0].depth).toBe(0);
    expect(roots[0].children[1].depth).toBe(1);
    expect(roots[0].children[1].children[0].depth).toBe(2);
  });

  it('keeps a root with no reports as its own branch', () => {
    const roots = buildOrgTree(CHART);
    expect(roots[1].children).toEqual([]);
  });

  it('places everyone exactly once', () => {
    const roots = buildOrgTree(CHART);
    expect(indexById(roots).size).toBe(CHART.nodes.length);
  });

  it('does not hang or lose people when the reporting data contains a cycle', () => {
    const cyclic: CompanyOrgChart = {
      nodes: [node('a', 'b'), node('b', 'a'), node('c', 'b')],
      rootIds: [],
    };
    const roots = buildOrgTree(cyclic);
    // The cycle surfaces as a top-level branch instead of dropping anyone.
    expect(new Set(indexById(roots).keys())).toEqual(new Set(['a', 'b', 'c']));
    expect(roots).toHaveLength(1);
  });

  it('ignores a self-reporting link rather than nesting a node under itself', () => {
    const roots = buildOrgTree({
      nodes: [node('solo', 'solo')],
      rootIds: [],
    });
    expect(roots.map((r) => r.id)).toEqual(['solo']);
    expect(roots[0].children).toEqual([]);
  });
});

describe('parent map', () => {
  it('returns the manager chain root-first', () => {
    const parents = buildParentMap(buildOrgTree(CHART));
    expect(chainToRoot(parents, 'dev1')).toEqual(['ceo', 'cto']);
  });

  it('is empty for a root and for an unknown id', () => {
    const parents = buildParentMap(buildOrgTree(CHART));
    expect(chainToRoot(parents, 'ceo')).toEqual([]);
    expect(chainToRoot(parents, 'nobody')).toEqual([]);
  });

  it('cannot loop on cyclic reporting data', () => {
    const parents = buildParentMap(
      buildOrgTree({
        nodes: [node('a', 'b'), node('b', 'a')],
        rootIds: [],
      }),
    );
    expect(chainToRoot(parents, 'b').length).toBeLessThanOrEqual(1);
  });
});

describe('collapse sets', () => {
  it('counts everyone underneath a node', () => {
    const roots = buildOrgTree(CHART);
    expect(descendantCount(roots[0])).toBe(4);
    expect(descendantCount(roots[0].children[1])).toBe(2);
    expect(descendantCount(roots[1])).toBe(0);
  });

  it('only offers a fold to nodes that have reports', () => {
    const roots = buildOrgTree(CHART);
    expect([...collapsibleIds(roots)].sort()).toEqual(['ceo', 'cto']);
  });

  it('starts folded from the third level down, not at the top', () => {
    const deep = buildOrgTree({
      nodes: [
        node('ceo'),
        node('vp', 'ceo'),
        node('mgr', 'vp'),
        node('ic', 'mgr'),
      ],
      rootIds: ['ceo'],
    });
    // ceo (0) and vp (1) stay open; mgr (2) has reports so it folds.
    expect([...initialCollapsedIds(deep)]).toEqual(['mgr']);
  });
});

describe('layoutOrgTree', () => {
  it('gives leaves their own column and centres each parent over its children', () => {
    const roots = buildOrgTree(CHART);
    const layout = layoutOrgTree(roots, new Set());
    const at = (id: string) => layout.nodes.find((n) => n.node.id === id)!;
    const step = ORG_NODE_WIDTH + ORG_GAP_X;

    // Leaves, left to right: cfo, dev1, dev2, orphan.
    expect(at('cfo').x).toBe(0);
    expect(at('dev1').x).toBe(step);
    expect(at('dev2').x).toBe(step * 2);
    expect(at('orphan').x).toBe(step * 3);
    // cto sits over dev1..dev2, ceo over cfo..cto.
    expect(at('cto').x).toBe(step * 1.5);
    expect(at('ceo').x).toBe((at('cfo').x + at('cto').x) / 2);
  });

  it('never overlaps two cards on the same row', () => {
    const layout = layoutOrgTree(buildOrgTree(CHART), new Set());
    const rows = new Map<number, number[]>();
    for (const placed of layout.nodes) {
      rows.set(placed.y, [...(rows.get(placed.y) ?? []), placed.x]);
    }
    for (const xs of rows.values()) {
      const sorted = [...xs].sort((a, b) => a - b);
      for (let i = 1; i < sorted.length; i += 1) {
        expect(sorted[i] - sorted[i - 1]).toBeGreaterThanOrEqual(
          ORG_NODE_WIDTH,
        );
      }
    }
  });

  it('maps depth to distinct rows', () => {
    const layout = layoutOrgTree(buildOrgTree(CHART), new Set());
    const at = (id: string) => layout.nodes.find((n) => n.node.id === id)!;
    expect(at('ceo').y).toBe(0);
    expect(at('cto').y).toBeGreaterThan(at('ceo').y);
    expect(at('dev1').y).toBeGreaterThan(at('cto').y);
  });

  it('a folded node lays out as a leaf and reports the headcount it hides', () => {
    const layout = layoutOrgTree(buildOrgTree(CHART), new Set(['cto']));
    const ids = layout.nodes.map((n) => n.node.id).sort();
    expect(ids).toEqual(['ceo', 'cfo', 'cto', 'orphan']);
    const cto = layout.nodes.find((n) => n.node.id === 'cto')!;
    expect(cto.collapsed).toBe(true);
    expect(cto.hiddenCount).toBe(2);
    // Folding reclaims the space its subtree used.
    expect(layout.width).toBe(3 * (ORG_NODE_WIDTH + ORG_GAP_X) - ORG_GAP_X);
  });

  it('drops the edges under a folded node', () => {
    const layout = layoutOrgTree(buildOrgTree(CHART), new Set(['cto']));
    expect(layout.edges.map((e) => e.childId).sort()).toEqual(['cfo', 'cto']);
  });

  it('draws each edge from the parent bottom-centre to the child top-centre', () => {
    const layout = layoutOrgTree(buildOrgTree(CHART), new Set());
    const at = (id: string) => layout.nodes.find((n) => n.node.id === id)!;
    const edge = layout.edges.find((e) => e.childId === 'dev1')!;
    expect(edge.parentId).toBe('cto');
    expect(edge.x1).toBe(at('cto').x + ORG_NODE_WIDTH / 2);
    expect(edge.x2).toBe(at('dev1').x + ORG_NODE_WIDTH / 2);
    expect(edge.y2).toBe(at('dev1').y);
    expect(edge.y1).toBeLessThan(edge.y2);
  });

  it('handles an empty forest', () => {
    const layout = layoutOrgTree([], new Set());
    expect(layout).toMatchObject({ nodes: [], edges: [], width: 0, height: 0 });
  });
});

describe('matchingNodeIds', () => {
  const searchable = buildOrgTree({
    nodes: [
      node('ceo', null, { fullName: 'Asha Rao', designation: 'CEO' }),
      node('cto', 'ceo', {
        fullName: 'Bela Nair',
        designation: 'Head of Engineering',
        verticalName: 'Technology',
      }),
    ],
    rootIds: ['ceo'],
  });

  it('matches on name, job title or department, case-insensitively', () => {
    expect(matchingNodeIds(searchable, 'asha')).toEqual(new Set(['ceo']));
    expect(matchingNodeIds(searchable, 'ENGINEER')).toEqual(new Set(['cto']));
    expect(matchingNodeIds(searchable, 'technology')).toEqual(new Set(['cto']));
  });

  it('matches nobody for a blank query or a miss', () => {
    expect(matchingNodeIds(searchable, '   ')).toEqual(new Set());
    expect(matchingNodeIds(searchable, 'zzz')).toEqual(new Set());
  });
});

describe('departmentColours', () => {
  it('is stable in name order and folds people with no vertical into one bucket', () => {
    const nodes = [
      node('a', null, { verticalName: 'Sales' }),
      node('b', null, { verticalName: 'Operations' }),
      node('c', null, { verticalName: 'Sales' }),
      node('d'),
    ];
    const colours = departmentColours(nodes);
    expect(colours.get('Sales')).toBe(colours.get('Sales'));
    expect(colours.get('Operations')).not.toBe(colours.get('Sales'));
    expect(departmentOf(nodes[3])).toBe('Unassigned');
    expect(colours.get('Unassigned')).toBeTruthy();
    // Alphabetical, so adding a person never reshuffles existing colours.
    expect(colours.get('Operations')).toBe(
      departmentColours(nodes).get('Operations'),
    );
  });
});

describe('orgProfileHref', () => {
  it('sends your own node to My Profile', () => {
    expect(orgProfileHref('me', 'me')).toBe('/profile');
  });

  it('sends everyone else to their directory profile', () => {
    expect(orgProfileHref('them', 'me')).toBe('/people/them');
    expect(orgProfileHref('them', null)).toBe('/people/them');
  });
});
