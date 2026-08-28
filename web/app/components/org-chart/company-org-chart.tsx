'use client';

import { useEffect, useMemo, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import {
  OrgTreeNode,
  allNodeIds,
  ancestorIds,
  buildOrgTree,
  defaultExpandedIds,
  fetchCompanyOrgChart,
  orgProfileHref,
} from '../../lib/org-chart';
import { Button } from '../ui/button';
import { Skeleton } from '../ui/skeleton';
import { cn } from '../../lib/utils';
import { OrgNodeCard } from './org-node-card';

/**
 * The whole company hierarchy as a collapsible indented tree, over the existing
 * reporting structure (Employee.reportingManagerId).
 *
 * It deliberately does NOT open fully expanded: only the top levels are open on
 * load (plus the manager chain of `focusId`, so a person arriving from someone's
 * mini chart is revealed without unfolding everything), which keeps the tree
 * readable at any company size.
 */
export function CompanyOrgChart({
  focusId,
  currentUserId,
  className,
}: {
  /** Reveal + highlight this person on load (e.g. from ?focus= on a profile link). */
  focusId?: string | null;
  currentUserId?: string | null;
  className?: string;
}) {
  const [roots, setRoots] = useState<OrgTreeNode[] | null>(null);
  const [total, setTotal] = useState(0);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [error, setError] = useState(false);

  useEffect(() => {
    let live = true;
    fetchCompanyOrgChart()
      .then((chart) => {
        if (!live) return;
        const tree = buildOrgTree(chart);
        setRoots(tree);
        setTotal(chart.nodes.length);
        const initial = defaultExpandedIds(tree);
        if (focusId) {
          for (const id of ancestorIds(tree, focusId)) initial.add(id);
        }
        setExpanded(initial);
      })
      .catch(() => {
        if (live) setError(true);
      });
    return () => {
      live = false;
    };
  }, [focusId]);

  const everyId = useMemo(
    () => (roots ? allNodeIds(roots) : new Set<string>()),
    [roots],
  );

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (error) {
    return (
      <p className={cn('text-sm text-muted-foreground', className)}>
        Could not load the org chart.
      </p>
    );
  }

  if (!roots) {
    return (
      <div className={cn('space-y-2', className)}>
        <Skeleton className="h-[52px] w-[264px]" />
        <Skeleton className="ml-8 h-[52px] w-[264px]" />
        <Skeleton className="ml-16 h-[52px] w-[264px]" />
      </div>
    );
  }

  if (roots.length === 0) {
    return (
      <p className={cn('text-sm text-muted-foreground', className)}>
        No active employees to chart yet.
      </p>
    );
  }

  return (
    <div className={className}>
      <div className="mb-3 flex items-center gap-2">
        <span className="text-xs text-muted-foreground">{total} people</span>
        <div className="ml-auto flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setExpanded(new Set(everyId))}
          >
            Expand all
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setExpanded(new Set(roots.map((r) => r.id)))}
          >
            Collapse to top
          </Button>
        </div>
      </div>

      <ul className="space-y-0.5 overflow-x-auto">
        {roots.map((root) => (
          <Branch
            key={root.id}
            node={root}
            expanded={expanded}
            onToggle={toggle}
            currentUserId={currentUserId}
            focusId={focusId}
          />
        ))}
      </ul>
    </div>
  );
}

/**
 * One row plus, when expanded, its reports indented beneath it. Root nodes
 * render with nothing above them — a root is simply a node the API gave no
 * in-chart manager.
 */
function Branch({
  node,
  expanded,
  onToggle,
  currentUserId,
  focusId,
}: {
  node: OrgTreeNode;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  currentUserId?: string | null;
  focusId?: string | null;
}) {
  const hasChildren = node.children.length > 0;
  const isOpen = hasChildren && expanded.has(node.id);

  return (
    <li>
      <div className="flex items-center gap-1.5">
        {hasChildren ? (
          <button
            type="button"
            onClick={() => onToggle(node.id)}
            aria-expanded={isOpen}
            aria-label={`${isOpen ? 'Collapse' : 'Expand'} ${node.fullName}'s team`}
            className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted"
          >
            <ChevronRight
              className={cn(
                'size-4 transition-transform',
                isOpen && 'rotate-90',
              )}
            />
          </button>
        ) : (
          <span className="size-6 shrink-0" aria-hidden="true" />
        )}
        <OrgNodeCard
          node={node}
          href={orgProfileHref(node.id, currentUserId)}
          highlighted={node.id === focusId}
          className="my-0.5 w-[264px]"
        />
        {hasChildren && !isOpen && (
          <button
            type="button"
            onClick={() => onToggle(node.id)}
            className="text-[11.5px] text-muted-foreground hover:underline"
          >
            show {node.children.length} report
            {node.children.length === 1 ? '' : 's'}
          </button>
        )}
      </div>

      {isOpen && (
        <ul className="ml-[23px] border-l pl-3.5">
          {node.children.map((child) => (
            <Branch
              key={child.id}
              node={child}
              expanded={expanded}
              onToggle={onToggle}
              currentUserId={currentUserId}
              focusId={focusId}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
