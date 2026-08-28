'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronRight,
  Crosshair,
  Maximize2,
  Minus,
  Plus,
  Search,
} from 'lucide-react';
import {
  ORG_GAP_Y,
  ORG_NODE_HEIGHT,
  ORG_NODE_WIDTH,
  OrgTreeNode,
  buildOrgTree,
  buildParentMap,
  chainToRoot,
  collapsibleIds,
  departmentColours,
  departmentOf,
  fetchCompanyOrgChart,
  indexById,
  initialCollapsedIds,
  layoutOrgTree,
  matchingNodeIds,
} from '../../lib/org-chart';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Avatar } from '../ui/avatar';
import { Skeleton } from '../ui/skeleton';
import { cn } from '../../lib/utils';
import { OrgChartNode } from './org-chart-node';
import { OrgChartDrawer } from './org-chart-drawer';

/** Zoom bounds, and the "too small to read" floor that stops auto-fitting. */
const MIN_SCALE = 0.3;
const MAX_SCALE = 1.6;
const MIN_FIT_SCALE = 0.6;
const LEGIBLE_SCALE = 0.8;
const FIT_MARGIN = 48;

interface View {
  scale: number;
  tx: number;
  ty: number;
}

/**
 * The company org chart as one interactive flow chart: a tidy top-down tree on a
 * pannable/zoomable canvas, with the selected person's reporting line as a strip
 * above it. That strip replaces the old ego-centric "your reporting structure"
 * panel — it says the same thing (your chain up to the top) without duplicating
 * the tree, and it works for the person at the top too.
 *
 * Reads the existing GET /employees/org-chart; no new data fetching.
 */
export function OrgChartPanel({
  focusId,
  meId,
  className,
}: {
  /** Select + centre this person on load (e.g. ?focus= from a profile link). */
  focusId?: string | null;
  /** The signed-in employee — gets the YOU chip and the "Jump to me" target. */
  meId?: string | null;
  className?: string;
}) {
  const [roots, setRoots] = useState<OrgTreeNode[] | null>(null);
  const [error, setError] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [view, setView] = useState<View>({ scale: 1, tx: 0, ty: 0 });
  const [pendingCentre, setPendingCentre] = useState<string | null>(null);
  const [needsFit, setNeedsFit] = useState(false);
  const [dragging, setDragging] = useState(false);

  const viewportRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    x: number;
    y: number;
    tx: number;
    ty: number;
  } | null>(null);

  useEffect(() => {
    let live = true;
    fetchCompanyOrgChart()
      .then((chart) => {
        if (!live) return;
        const tree = buildOrgTree(chart);
        const parents = buildParentMap(tree);
        const start =
          [focusId, meId].find((id) => id && parents.has(id)) ?? null;
        const folded = initialCollapsedIds(tree);
        // Never open on top of a folded ancestor of the person we start on.
        if (start)
          for (const id of chainToRoot(parents, start)) folded.delete(id);
        setRoots(tree);
        setCollapsed(folded);
        setSelectedId(start ?? focusId ?? meId ?? tree[0]?.id ?? null);
        setNeedsFit(true);
      })
      .catch(() => {
        if (live) setError(true);
      });
    return () => {
      live = false;
    };
  }, [focusId, meId]);

  const byId = useMemo(
    () => (roots ? indexById(roots) : new Map<string, OrgTreeNode>()),
    [roots],
  );
  const parents = useMemo(
    () => (roots ? buildParentMap(roots) : new Map<string, string>()),
    [roots],
  );
  const colours = useMemo(() => departmentColours([...byId.values()]), [byId]);
  const layout = useMemo(
    () => layoutOrgTree(roots ?? [], collapsed),
    [roots, collapsed],
  );

  const searching = query.trim().length > 0;
  const matches = useMemo(
    () =>
      searching && roots ? matchingNodeIds(roots, query) : new Set<string>(),
    [roots, query, searching],
  );

  const chain = useMemo(() => {
    if (!selectedId || !byId.has(selectedId)) return [] as OrgTreeNode[];
    return [...chainToRoot(parents, selectedId), selectedId]
      .map((id) => byId.get(id))
      .filter((node): node is OrgTreeNode => Boolean(node));
  }, [selectedId, byId, parents]);
  const chainIds = useMemo(() => new Set(chain.map((n) => n.id)), [chain]);

  /** Unfold everyone above `ids` so they are actually on the canvas. */
  const reveal = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return;
      setCollapsed((prev) => {
        const next = new Set(prev);
        let changed = false;
        for (const id of ids) {
          for (const ancestor of chainToRoot(parents, id)) {
            if (next.delete(ancestor)) changed = true;
          }
        }
        return changed ? next : prev;
      });
    },
    [parents],
  );

  const centreOn = useCallback(
    (id: string, scaleOverride?: number) => {
      const vp = viewportRef.current;
      const placed = layout.nodes.find((n) => n.node.id === id);
      if (!vp || !placed) return;
      const { width, height } = vp.getBoundingClientRect();
      const scale = scaleOverride ?? view.scale;
      setView({
        scale,
        tx: width / 2 - (placed.x + ORG_NODE_WIDTH / 2) * scale,
        ty: height / 2 - (placed.y + ORG_NODE_HEIGHT / 2) * scale,
      });
    },
    [layout, view.scale],
  );

  const fitToView = useCallback(() => {
    const vp = viewportRef.current;
    if (!vp || layout.nodes.length === 0) return;
    const { width, height } = vp.getBoundingClientRect();
    const raw = Math.min(
      (width - FIT_MARGIN) / layout.width,
      (height - FIT_MARGIN) / layout.height,
      1,
    );
    // On a narrow viewport a true fit would shrink the cards past legibility —
    // keep a readable scale and centre on the selection instead.
    if (raw < MIN_FIT_SCALE) {
      const onCanvas =
        selectedId && layout.nodes.some((n) => n.node.id === selectedId);
      centreOn(
        onCanvas ? (selectedId as string) : layout.nodes[0].node.id,
        LEGIBLE_SCALE,
      );
      return;
    }
    const scale = Math.max(raw, MIN_SCALE);
    setView({
      scale,
      tx: Math.max((width - layout.width * scale) / 2, FIT_MARGIN / 2),
      ty: FIT_MARGIN / 2,
    });
  }, [layout, centreOn, selectedId]);

  // Fit / recentre once the layout for the new state exists.
  useEffect(() => {
    if (!needsFit || layout.nodes.length === 0) return;
    setNeedsFit(false);
    fitToView();
  }, [needsFit, layout, fitToView]);

  useEffect(() => {
    if (!pendingCentre || layout.nodes.length === 0) return;
    setPendingCentre(null);
    centreOn(pendingCentre);
  }, [pendingCentre, layout, centreOn]);

  // Searching auto-opens the path to every match, so hits are never hidden
  // inside a folded subtree.
  useEffect(() => {
    if (!searching || matches.size === 0) return;
    reveal([...matches]);
  }, [searching, matches, reveal]);

  const select = useCallback(
    (id: string, options?: { drawer?: boolean; centre?: boolean }) => {
      reveal([id]);
      setSelectedId(id);
      if (options?.drawer) setDrawerOpen(true);
      if (options?.centre !== false) setPendingCentre(id);
    },
    [reveal],
  );

  const zoomBy = useCallback((factor: number, cx?: number, cy?: number) => {
    setView((prev) => {
      const scale = Math.min(
        MAX_SCALE,
        Math.max(MIN_SCALE, prev.scale * factor),
      );
      const vp = viewportRef.current;
      const rect = vp?.getBoundingClientRect();
      const anchorX = cx ?? (rect ? rect.width / 2 : 0);
      const anchorY = cy ?? (rect ? rect.height / 2 : 0);
      const ratio = scale / prev.scale;
      return {
        scale,
        tx: anchorX - (anchorX - prev.tx) * ratio,
        ty: anchorY - (anchorY - prev.ty) * ratio,
      };
    });
  }, []);

  // Scroll-to-zoom needs a non-passive listener to stop the page scrolling.
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = vp.getBoundingClientRect();
      zoomBy(
        Math.exp(-event.deltaY * 0.0015),
        event.clientX - rect.left,
        event.clientY - rect.top,
      );
    };
    vp.addEventListener('wheel', onWheel, { passive: false });
    return () => vp.removeEventListener('wheel', onWheel);
  }, [zoomBy, roots]);

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest('button,a,input')) return;
    dragRef.current = {
      x: event.clientX,
      y: event.clientY,
      tx: view.tx,
      ty: view.ty,
    };
    setDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const start = dragRef.current;
    if (!start) return;
    setView((prev) => ({
      ...prev,
      tx: start.tx + (event.clientX - start.x),
      ty: start.ty + (event.clientY - start.y),
    }));
  }

  function endDrag(event: React.PointerEvent<HTMLDivElement>) {
    if (!dragRef.current) return;
    dragRef.current = null;
    setDragging(false);
    event.currentTarget.releasePointerCapture(event.pointerId);
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
      <div className={cn('rounded-xl border bg-card p-4', className)}>
        <Skeleton className="h-9 w-full max-w-md" />
        <Skeleton className="mt-3 h-10 w-full" />
        <Skeleton className="mt-3 h-[420px] w-full" />
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

  const total = byId.size;
  const levels =
    layout.nodes.length > 0
      ? Math.max(...[...byId.values()].map((n) => n.depth)) + 1
      : 0;
  const selected = selectedId ? (byId.get(selectedId) ?? null) : null;
  const selectedManager = selected
    ? (byId.get(parents.get(selected.id) ?? '') ?? null)
    : null;
  const departments = [...colours.entries()].filter(([name]) =>
    [...byId.values()].some((n) => departmentOf(n) === name),
  );
  const noResults = searching && matches.size === 0;

  return (
    <div className={cn('overflow-hidden rounded-xl border bg-card', className)}>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b p-3">
        <div className="mr-auto">
          <h2 className="text-[15px] font-bold tracking-[-.2px]">
            Company org chart
          </h2>
          <p className="text-[11.5px] text-muted-foreground">
            {total} {total === 1 ? 'person' : 'people'} · {levels} level
            {levels === 1 ? '' : 's'}
            {selected ? ` · viewing ${selected.fullName}` : ''}
          </p>
        </div>

        <div className="relative w-full sm:w-[236px]">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find a person or role"
            aria-label="Search the org chart by name, role or department"
            className="h-9 pl-8 text-[13px] md:h-9"
          />
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setCollapsed(new Set())}
        >
          Expand all
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            const fold = collapsibleIds(roots);
            for (const root of roots) fold.delete(root.id);
            setCollapsed(fold);
            setNeedsFit(true);
          }}
        >
          Collapse
        </Button>
        {meId && byId.has(meId) && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => select(meId, { centre: true })}
          >
            <Crosshair className="mr-1.5 size-3.5" />
            Jump to me
          </Button>
        )}
      </div>

      {/* Reporting line of the selected person — replaces the old ego panel. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b bg-muted/30 px-3 py-2">
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          Reporting line
        </span>
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {chain.map((node, index) => (
            <span key={node.id} className="flex shrink-0 items-center gap-1">
              {index > 0 && (
                <ChevronRight
                  className="size-3 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
              )}
              <button
                type="button"
                onClick={() => select(node.id, { drawer: true, centre: true })}
                className={cn(
                  'flex items-center gap-1.5 rounded-full border px-1.5 py-0.5 text-[11.5px] font-medium transition-colors hover:bg-muted',
                  node.id === selectedId
                    ? 'border-primary/60 bg-primary/10 text-foreground'
                    : 'border-transparent text-muted-foreground',
                )}
              >
                <Avatar
                  name={node.fullName}
                  imageUrl={node.photoUrl}
                  className="size-5 text-[9px]"
                />
                {node.fullName}
                {node.id === meId && (
                  <span className="rounded bg-primary px-1 text-[8.5px] font-bold uppercase tracking-wide text-primary-foreground">
                    You
                  </span>
                )}
              </button>
            </span>
          ))}
        </div>
        <span className="shrink-0 text-[11.5px] text-muted-foreground">
          {selected && selectedManager
            ? `Reports to ${selectedManager.fullName}`
            : 'Top of the structure — no manager above.'}
        </span>
      </div>

      {/* Canvas */}
      <div
        ref={viewportRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        className="relative h-[min(68vh,600px)] touch-none select-none overflow-hidden"
        style={{
          backgroundImage:
            'radial-gradient(circle, hsl(var(--border)) 1px, transparent 1px)',
          backgroundSize: '22px 22px',
          backgroundPosition: `${view.tx}px ${view.ty}px`,
          cursor: dragging ? 'grabbing' : 'grab',
        }}
      >
        <div
          className="absolute left-0 top-0 origin-top-left"
          style={{
            width: layout.width,
            height: layout.height,
            transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`,
          }}
        >
          <svg
            className="absolute left-0 top-0 overflow-visible"
            width={Math.max(layout.width, 1)}
            height={Math.max(layout.height, 1)}
            aria-hidden="true"
          >
            {layout.edges.map((edge) => {
              const active =
                chainIds.has(edge.parentId) && chainIds.has(edge.childId);
              const midY = edge.y1 + ORG_GAP_Y / 2;
              return (
                <path
                  key={`${edge.parentId}-${edge.childId}`}
                  d={`M ${edge.x1} ${edge.y1} V ${midY} H ${edge.x2} V ${edge.y2}`}
                  fill="none"
                  stroke={active ? 'hsl(var(--primary))' : 'hsl(var(--border))'}
                  strokeWidth={active ? 2 : 1.5}
                  strokeLinejoin="round"
                />
              );
            })}
          </svg>

          {layout.nodes.map((placed) => (
            <OrgChartNode
              key={placed.node.id}
              placed={placed}
              colour={
                colours.get(departmentOf(placed.node)) ?? 'hsl(var(--border))'
              }
              selected={placed.node.id === selectedId}
              isMe={placed.node.id === meId}
              onChain={chainIds.has(placed.node.id)}
              dimmed={searching && !matches.has(placed.node.id)}
              onSelect={(id) => select(id, { drawer: true, centre: false })}
              onToggle={(id) =>
                setCollapsed((prev) => {
                  const next = new Set(prev);
                  if (!next.delete(id)) next.add(id);
                  return next;
                })
              }
            />
          ))}
        </div>

        {noResults && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <p className="rounded-lg border bg-card px-3 py-2 text-[12.5px] text-muted-foreground">
              No one matches “{query.trim()}”.
            </p>
          </div>
        )}

        {/* Zoom controls */}
        <div className="absolute bottom-3 left-3 flex items-center gap-0.5 rounded-lg border bg-card/95 p-0.5">
          <ZoomButton label="Zoom out" onClick={() => zoomBy(1 / 1.2)}>
            <Minus className="size-3.5" />
          </ZoomButton>
          <span className="w-11 text-center text-[11px] font-semibold tabular-nums text-muted-foreground">
            {Math.round(view.scale * 100)}%
          </span>
          <ZoomButton label="Zoom in" onClick={() => zoomBy(1.2)}>
            <Plus className="size-3.5" />
          </ZoomButton>
          <ZoomButton label="Fit to view" onClick={fitToView}>
            <Maximize2 className="size-3.5" />
          </ZoomButton>
        </div>

        {/* Department legend */}
        {departments.length > 0 && (
          <div className="absolute bottom-3 right-3 flex max-w-[60%] flex-wrap justify-end gap-x-2.5 gap-y-1 rounded-lg border bg-card/95 px-2 py-1.5">
            {departments.map(([name, colour]) => (
              <span
                key={name}
                className="flex items-center gap-1 text-[10.5px] text-muted-foreground"
              >
                <span
                  aria-hidden="true"
                  className="size-2 rounded-full"
                  style={{ backgroundColor: colour }}
                />
                {name}
              </span>
            ))}
          </div>
        )}

        {drawerOpen && selected && (
          <OrgChartDrawer
            node={selected}
            manager={selectedManager}
            colour={colours.get(departmentOf(selected)) ?? 'hsl(var(--border))'}
            meId={meId}
            onClose={() => setDrawerOpen(false)}
            onNavigate={(id) => select(id, { drawer: true, centre: true })}
          />
        )}
      </div>
    </div>
  );
}

function ZoomButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {children}
    </button>
  );
}
