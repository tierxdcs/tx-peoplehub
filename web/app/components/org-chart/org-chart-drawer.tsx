'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { ExternalLink, X } from 'lucide-react';
import {
  BOARD_LABEL,
  OrgTreeNode,
  departmentOf,
  descendantCount,
  orgProfileHref,
} from '../../lib/org-chart';
import { Avatar } from '../ui/avatar';
import { cn } from '../../lib/utils';

/**
 * Detail panel for the selected person. It shows only what the (company-wide)
 * org-chart endpoint returns plus what the tree itself knows — team sizes and
 * the level in the structure. Work location and tenure aren't part of that
 * payload, so they render as "—" rather than triggering a second, more
 * privileged employee read.
 */
export function OrgChartDrawer({
  node,
  manager,
  colour,
  meId,
  boardAbove = false,
  onClose,
  onNavigate,
}: {
  node: OrgTreeNode;
  manager: OrgTreeNode | null;
  colour: string;
  meId?: string | null;
  /** The company top answers to the board rather than to nobody. */
  boardAbove?: boolean;
  onClose: () => void;
  onNavigate: (id: string) => void;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const total = descendantCount(node);

  return (
    <>
      <button
        type="button"
        aria-label="Close details"
        onClick={onClose}
        className="absolute inset-0 z-20 cursor-default bg-background/40"
      />
      <aside
        aria-label={`${node.fullName} details`}
        className="absolute inset-y-0 right-0 z-30 flex w-full max-w-[330px] flex-col border-l bg-card"
      >
        <div className="flex items-start gap-3 border-b p-4">
          <Avatar
            name={node.fullName}
            imageUrl={node.photoUrl}
            className="size-11"
          />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[15px] font-bold tracking-[-.2px]">
              {node.fullName}
            </div>
            <div className="truncate text-[12px] text-muted-foreground">
              {node.designation ?? 'No job title recorded'}
            </div>
            <span
              className="mt-1.5 inline-flex items-center gap-1.5 text-[11px] font-medium"
              style={{ color: colour }}
            >
              <span
                aria-hidden="true"
                className="size-2 rounded-full"
                style={{ backgroundColor: colour }}
              />
              {departmentOf(node)}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close details"
            className="-mr-1 -mt-1 flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-muted"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <div className="grid grid-cols-3 gap-2 text-center">
            <Stat label="Direct" value={node.children.length} />
            <Stat label="Total org" value={total} />
            <Stat label="Level" value={node.depth + 1} />
          </div>

          <dl className="mt-4 space-y-2.5">
            <Row label="Employee ID" value={node.employeeId} />
            <Row
              label="Email"
              value={
                <a
                  href={`mailto:${node.email}`}
                  className="text-primary hover:underline"
                >
                  {node.email}
                </a>
              }
            />
            <Row label="Location" value={null} />
            <Row label="Tenure" value={null} />
            <Row
              label="Reports to"
              value={
                manager ? (
                  <button
                    type="button"
                    onClick={() => onNavigate(manager.id)}
                    className="text-primary hover:underline"
                  >
                    {manager.fullName}
                  </button>
                ) : boardAbove ? (
                  BOARD_LABEL
                ) : (
                  'Top of the structure'
                )
              }
            />
          </dl>

          <div className="mt-4">
            <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Direct reports{' '}
              {node.children.length > 0 && `· ${node.children.length}`}
            </div>
            {node.children.length === 0 ? (
              <p className="mt-1.5 text-[12.5px] text-muted-foreground">
                No direct reports.
              </p>
            ) : (
              <ul className="mt-1.5 space-y-1">
                {node.children.map((child) => (
                  <li key={child.id}>
                    <button
                      type="button"
                      onClick={() => onNavigate(child.id)}
                      className="flex w-full items-center gap-2 rounded-md border border-transparent px-1.5 py-1 text-left hover:border-border hover:bg-muted/60"
                    >
                      <Avatar
                        name={child.fullName}
                        imageUrl={child.photoUrl}
                        className="size-6 text-[10px]"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12.5px] font-medium leading-tight">
                          {child.fullName}
                        </span>
                        <span className="block truncate text-[11px] leading-tight text-muted-foreground">
                          {child.designation ??
                            `${child.children.length} report${child.children.length === 1 ? '' : 's'}`}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="border-t p-3">
          <Link
            href={orgProfileHref(node.id, meId)}
            className="inline-flex items-center gap-1.5 text-[12px] font-medium text-primary hover:underline"
          >
            <ExternalLink className="size-3.5" />
            Open {node.id === meId ? 'my profile' : 'full profile'}
          </Link>
        </div>
      </aside>
    </>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border bg-muted/40 px-1 py-2">
      <div className="text-[17px] font-bold tabular-nums leading-none">
        {value}
      </div>
      <div className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
    </div>
  );
}

function Row({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode | null;
}) {
  return (
    <div className={cn('flex items-baseline gap-3')}>
      <dt className="w-[92px] shrink-0 text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="min-w-0 flex-1 break-words text-[12.5px]">
        {value ?? '—'}
      </dd>
    </div>
  );
}
