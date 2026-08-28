'use client';

import { ChevronDown, ChevronUp } from 'lucide-react';
import {
  ORG_NODE_HEIGHT,
  ORG_NODE_WIDTH,
  OrgLayoutNode,
} from '../../lib/org-chart';
import { Avatar } from '../ui/avatar';
import { cn } from '../../lib/utils';

/**
 * One card on the org-chart canvas.
 *
 * The wrapper is positioned with left/top (never transform) because the card
 * itself uses transform for its hover/selected lift — the two would otherwise
 * fight. The collapse pill is a sibling button rather than a nested one, so the
 * card stays a single focusable control with its own aria-label.
 */
export function OrgChartNode({
  placed,
  colour,
  selected,
  isMe,
  onChain,
  dimmed,
  onSelect,
  onToggle,
}: {
  placed: OrgLayoutNode;
  /** Department stripe colour (also tints the pill when folded). */
  colour: string;
  selected: boolean;
  isMe: boolean;
  /** On the selected person's reporting line — kept at full opacity. */
  onChain: boolean;
  dimmed: boolean;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
}) {
  const { node, collapsed, directCount, totalCount } = placed;
  const secondary = node.designation ?? node.verticalName ?? node.employeeId;
  // The pill is the rolled-up headcount: everyone underneath at any depth, not
  // just the direct line. Folding hides exactly that set, so the number never
  // changes when you collapse — only its tint does.
  const countLabel = `${directCount} direct · ${totalCount} in total`;

  return (
    <div
      className={cn(
        'absolute transition-opacity',
        dimmed && !onChain && 'opacity-30',
      )}
      style={{
        left: placed.x,
        top: placed.y,
        width: ORG_NODE_WIDTH,
        height: ORG_NODE_HEIGHT,
      }}
    >
      <button
        type="button"
        onClick={() => onSelect(node.id)}
        aria-label={`${node.fullName}${secondary ? `, ${secondary}` : ''}`}
        aria-pressed={selected}
        className={cn(
          'absolute inset-0 flex items-center gap-2.5 overflow-hidden rounded-lg border bg-card pl-3.5 pr-2.5 text-left transition-[transform,border-color,background-color]',
          'hover:-translate-y-0.5 hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transform-none motion-reduce:transition-none',
          selected && 'border-primary bg-primary/5 ring-2 ring-primary/40',
          !selected && isMe && 'border-primary/60',
        )}
      >
        <span
          aria-hidden="true"
          className="absolute inset-y-0 left-0 w-1"
          style={{ backgroundColor: colour }}
        />
        <Avatar
          name={node.fullName}
          imageUrl={node.photoUrl}
          className="size-11 border border-border/60 text-sm"
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold leading-tight">
            {node.fullName}
          </span>
          <span className="mt-0.5 block truncate text-[11px] leading-tight text-muted-foreground">
            {secondary ?? '—'}
          </span>
        </span>
      </button>

      {isMe && (
        <span className="pointer-events-none absolute -top-2 right-2 rounded bg-primary px-1 py-px text-[9px] font-bold uppercase tracking-wide text-primary-foreground">
          You
        </span>
      )}

      {directCount > 0 && (
        <button
          type="button"
          onClick={() => onToggle(node.id)}
          aria-expanded={!collapsed}
          title={countLabel}
          aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${node.fullName}'s team (${countLabel})`}
          className={cn(
            'absolute -bottom-2.5 left-1/2 z-10 flex h-5 -translate-x-1/2 items-center gap-0.5 rounded-full border bg-card px-1.5 text-[10px] font-semibold tabular-nums text-muted-foreground transition-colors hover:border-primary/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          )}
          style={
            collapsed
              ? {
                  backgroundColor: `${colour}26`,
                  borderColor: `${colour}80`,
                  color: colour,
                }
              : undefined
          }
        >
          {collapsed ? (
            <ChevronDown className="size-3" />
          ) : (
            <ChevronUp className="size-3" />
          )}
          {totalCount}
        </button>
      )}
    </div>
  );
}
