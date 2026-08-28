import { describe, expect, it } from 'vitest';
import {
  CompanyOrgChart,
  OrgChartNode,
  allNodeIds,
  ancestorIds,
  buildOrgTree,
  defaultExpandedIds,
  orgProfileHref,
} from './org-chart';

function node(
  id: string,
  reportingManagerId: string | null = null,
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
    expect(allNodeIds(roots).size).toBe(CHART.nodes.length);
  });

  it('does not hang or lose people when the reporting data contains a cycle', () => {
    const cyclic: CompanyOrgChart = {
      nodes: [node('a', 'b'), node('b', 'a'), node('c', 'b')],
      rootIds: [],
    };
    const roots = buildOrgTree(cyclic);
    // The cycle surfaces as a top-level branch instead of dropping anyone.
    expect(allNodeIds(roots)).toEqual(new Set(['a', 'b', 'c']));
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

describe('defaultExpandedIds', () => {
  it('opens the top two levels, not the whole tree', () => {
    const roots = buildOrgTree(CHART);
    const expanded = defaultExpandedIds(roots);
    expect(expanded.has('ceo')).toBe(true);
    expect(expanded.has('cto')).toBe(true);
    // Depth 2 stays collapsed, so dev1/dev2's own reports are not pre-opened.
    expect(expanded.has('dev1')).toBe(false);
  });

  it('honours a shallower depth', () => {
    const roots = buildOrgTree(CHART);
    const expanded = defaultExpandedIds(roots, 0);
    expect([...expanded].sort()).toEqual(['ceo', 'orphan']);
  });
});

describe('ancestorIds', () => {
  it('returns the manager chain root-first', () => {
    const roots = buildOrgTree(CHART);
    expect(ancestorIds(roots, 'dev1')).toEqual(['ceo', 'cto']);
  });

  it('is empty for a root and for an unknown id', () => {
    const roots = buildOrgTree(CHART);
    expect(ancestorIds(roots, 'ceo')).toEqual([]);
    expect(ancestorIds(roots, 'nobody')).toEqual([]);
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
