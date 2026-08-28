'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Network } from 'lucide-react';
import {
  OrgChartNeighbourhood,
  fetchEmployeeOrgChart,
  orgProfileHref,
} from '../../lib/org-chart';
import { Skeleton } from '../ui/skeleton';
import { cn } from '../../lib/utils';
import { OrgNodeCard } from './org-node-card';

/**
 * Loads one employee's manager / self / direct reports. Exported so a page that
 * already needs the employee's identity (the directory profile) can render its
 * header from the same single request that feeds the chart.
 */
export function useEmployeeOrgChart(employeeId: string | null | undefined) {
  const [data, setData] = useState<OrgChartNeighbourhood | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!employeeId) return;
    let live = true;
    setLoading(true);
    setError(false);
    fetchEmployeeOrgChart(employeeId)
      .then((res) => {
        if (live) setData(res);
      })
      .catch(() => {
        if (live) setError(true);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [employeeId]);

  return { data, loading, error };
}

/** Tiny uppercase row label above each tier of the mini chart. */
function Tier({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
      {children}
    </div>
  );
}

/** The vertical connector between two tiers. */
function Stem({ className }: { className?: string }) {
  return <span className={cn('w-px bg-border', className)} aria-hidden="true" />;
}

/**
 * The mini org chart embedded on a profile page: the manager above, the profile
 * owner highlighted in the middle, their direct reports below. Every node links
 * to that person's own profile (and their own mini chart).
 *
 * Pass `data` when the host already fetched it, otherwise pass `employeeId` and
 * this fetches it.
 */
export function MiniOrgChart({
  employeeId,
  data: provided,
  currentUserId,
  className,
}: {
  employeeId?: string;
  data?: OrgChartNeighbourhood | null;
  currentUserId?: string | null;
  className?: string;
}) {
  const fetched = useEmployeeOrgChart(provided ? null : employeeId);
  const data = provided ?? fetched.data;
  const loading = provided ? false : fetched.loading;

  if (loading) {
    return (
      <div className={cn('flex flex-col items-center gap-2', className)}>
        <Skeleton className="h-[52px] w-[200px]" />
        <Skeleton className="h-[52px] w-[200px]" />
      </div>
    );
  }
  if (!data) {
    return (
      <p className={cn('text-sm text-muted-foreground', className)}>
        Reporting structure unavailable.
      </p>
    );
  }

  const { manager, employee, reports } = data;

  return (
    <div className={cn('flex flex-col items-center', className)}>
      {manager ? (
        <>
          <Tier>Reports to</Tier>
          <OrgNodeCard
            node={manager}
            href={orgProfileHref(manager.id, currentUserId)}
            compact
          />
          <Stem className="h-4" />
        </>
      ) : (
        // No manager recorded — top of the company, so no node above.
        <p className="mb-2.5 text-[11.5px] text-muted-foreground">
          Top of the reporting structure — no manager above.
        </p>
      )}

      <OrgNodeCard
        node={employee}
        href={orgProfileHref(employee.id, currentUserId)}
        highlighted
      />

      {reports.length > 0 ? (
        <>
          <Stem className="h-4" />
          <Tier>
            Direct report{reports.length === 1 ? '' : 's'} · {reports.length}
          </Tier>
          <div className="flex flex-wrap justify-center gap-x-3 gap-y-2">
            {reports.map((report) => (
              <div key={report.id} className="flex flex-col items-center">
                <Stem className="h-3" />
                <OrgNodeCard
                  node={report}
                  href={orgProfileHref(report.id, currentUserId)}
                  compact
                />
              </div>
            ))}
          </div>
        </>
      ) : (
        <p className="mt-2.5 text-[11.5px] text-muted-foreground">
          No direct reports.
        </p>
      )}

      {/* The whole-company tree lives in the Org Chart tab under My Profile. */}
      <Link
        href={`/profile?tab=org-chart&focus=${employee.id}`}
        className="mt-4 inline-flex items-center gap-1.5 text-[12px] font-medium text-primary hover:underline"
      >
        <Network className="size-3.5" />
        View full org chart
      </Link>
    </div>
  );
}
