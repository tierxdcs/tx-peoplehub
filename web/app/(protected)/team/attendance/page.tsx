'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Users } from 'lucide-react';
import { useAuth, roleHome } from '../../../lib/auth-context';
import { apiFetch } from '../../../lib/api';
import { addDaysStr, todayDateStr } from '../../../lib/date';
import { Attendance, AttendanceStatus, Employee } from '../../../lib/types';
import { cn } from '../../../lib/utils';
import { PageContainer } from '../../../components/ui/page-container';
import { PageHeader } from '../../../components/ui/page-header';
import { Card, CardContent } from '../../../components/ui/card';
import { Input } from '../../../components/ui/input';
import { Field } from '../../../components/ui/field';
import { Avatar } from '../../../components/ui/avatar';
import { Skeleton } from '../../../components/ui/skeleton';
import { EmptyState } from '../../../components/ui/empty-state';

/**
 * Colour per attendance status, matching the app-wide status semantics
 * (green=present, red=absent, blue=on-leave, amber=half-day). Rendered as a
 * small dot in each grid cell + explained in the legend below the grid.
 */
const STATUS_DOT: Record<AttendanceStatus, string> = {
  PRESENT: 'bg-success',
  ABSENT: 'bg-destructive',
  ON_LEAVE: 'bg-info',
  HALF_DAY: 'bg-warning',
};

const STATUS_LABEL: Record<AttendanceStatus, string> = {
  PRESENT: 'Present',
  ABSENT: 'Absent',
  ON_LEAVE: 'On Leave',
  HALF_DAY: 'Half Day',
};

/**
 * GET /attendance/team is Manager-only on the backend (unlike almost every
 * other "team" endpoint in this app) — gated to MANAGER here to match, not
 * Admin/SuperAdmin too.
 */
export default function TeamAttendancePage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const allowed = user?.role === 'MANAGER';

  const [from, setFrom] = useState(addDaysStr(todayDateStr(), -6));
  const [to, setTo] = useState(todayDateStr());
  const [records, setRecords] = useState<Attendance[]>([]);
  const [team, setTeam] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const [recordsRes, teamRes] = await Promise.all([
        apiFetch<Attendance[]>(`/attendance/team?from=${from}&to=${to}`),
        apiFetch<Employee[]>(`/employees/${user.sub}/team`),
      ]);
      setRecords(recordsRes);
      setTeam(teamRes);
    } catch {
      setError('Failed to load team attendance');
    } finally {
      setLoading(false);
    }
  }, [from, to, user]);

  useEffect(() => {
    if (authLoading || !user || !allowed) return;
    load();
  }, [authLoading, user, allowed, load]);

  if (authLoading || !user) return null;
  if (!allowed) {
    router.replace(roleHome(user.role));
    return null;
  }

  const dates: string[] = [];
  for (let d = from; d <= to; d = addDaysStr(d, 1)) {
    dates.push(d);
    if (dates.length > 60) break; // sane cap on the grid width
  }

  const statusFor = (
    employeeId: string,
    date: string,
  ): AttendanceStatus | null =>
    records.find(
      (r) => r.employeeId === employeeId && r.date.slice(0, 10) === date,
    )?.status ?? null;

  return (
    <PageContainer>
      <PageHeader
        title="Team Attendance"
        description="Day-by-day attendance for your reports over the selected range."
      />

      <Card className="mb-4">
        <CardContent className="flex flex-wrap items-end gap-4 p-4">
          <Field label="From" htmlFor="from" className="w-auto">
            <Input
              id="from"
              type="date"
              value={from}
              max={to}
              onChange={(e) => setFrom(e.target.value)}
              className="w-44"
            />
          </Field>
          <Field label="To" htmlFor="to" className="w-auto">
            <Input
              id="to"
              type="date"
              value={to}
              min={from}
              onChange={(e) => setTo(e.target.value)}
              className="w-44"
            />
          </Field>
        </CardContent>
      </Card>

      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

      <Card>
        <CardContent className={loading || team.length === 0 ? 'pt-6' : 'p-0'}>
          {loading ? (
            <Skeleton className="h-40 w-full" />
          ) : team.length === 0 ? (
            <EmptyState
              icon={Users}
              title="No reports"
              description="You don't have any reports to show attendance for."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="sticky left-0 z-10 bg-card px-3 py-2 text-left font-medium text-muted-foreground">
                      Employee
                    </th>
                    {dates.map((d) => (
                      <th
                        key={d}
                        className="px-2 py-2 text-center text-xs font-medium text-muted-foreground"
                      >
                        {d.slice(5)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {team.map((e) => (
                    <tr key={e.id} className="border-b last:border-0">
                      <td className="sticky left-0 z-10 bg-card px-3 py-2">
                        <div className="flex items-center gap-2">
                          <Avatar
                            name={`${e.firstName} ${e.lastName}`}
                            className="size-6 text-[10px]"
                          />
                          <span className="whitespace-nowrap">
                            {e.firstName} {e.lastName}
                          </span>
                        </div>
                      </td>
                      {dates.map((d) => {
                        const status = statusFor(e.id, d);
                        return (
                          <td key={d} className="px-2 py-2 text-center">
                            {status ? (
                              <span
                                title={STATUS_LABEL[status]}
                                className={cn(
                                  'inline-block size-2.5 rounded-full',
                                  STATUS_DOT[status],
                                )}
                              />
                            ) : (
                              <span className="text-muted-foreground/40">
                                ·
                              </span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Legend */}
      {!loading && team.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted-foreground">
          {(Object.keys(STATUS_LABEL) as AttendanceStatus[]).map((s) => (
            <span key={s} className="flex items-center gap-1.5">
              <span
                className={cn('inline-block size-2.5 rounded-full', STATUS_DOT[s])}
              />
              {STATUS_LABEL[s]}
            </span>
          ))}
          <span className="flex items-center gap-1.5">
            <span className="text-muted-foreground/40">·</span>
            No record
          </span>
        </div>
      )}
    </PageContainer>
  );
}
