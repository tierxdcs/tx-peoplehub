'use client';

import { useCallback, useEffect, useState } from 'react';
import { CalendarOff } from 'lucide-react';
import { apiFetch, ApiError } from '../../lib/api';
import { todayDateStr } from '../../lib/date';
import { Attendance, PaginatedResult } from '../../lib/types';
import { PageContainer } from '../../components/ui/page-container';
import { PageHeader } from '../../components/ui/page-header';
import { Card, CardContent } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Skeleton } from '../../components/ui/skeleton';
import { StatusBadge } from '../../components/ui/status-badge';
import { EmptyState } from '../../components/ui/empty-state';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table';
import { useToast } from '../../components/ui/toaster';
import { useConfirm } from '../../components/ui/confirm';

function formatTime(iso: string | null): string {
  return iso ? new Date(iso).toLocaleTimeString() : '—';
}

export default function MyAttendancePage() {
  const toast = useToast();
  const confirm = useConfirm();
  const [history, setHistory] = useState<Attendance[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState(false);
  const limit = 20;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<PaginatedResult<Attendance>>(
        `/attendance/me?page=${page}&limit=${limit}`,
      );
      setHistory(res.items);
      setTotal(res.total);
    } catch {
      setError('Failed to load attendance history');
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    load();
  }, [load]);

  const today = todayDateStr();
  const todayRecord = history.find((a) => a.date.slice(0, 10) === today);

  async function handleCheckIn() {
    if (!(await confirm({ title: 'Check in now?', confirmLabel: 'Check in' })))
      return;
    setActing(true);
    try {
      await apiFetch('/attendance/check-in', { method: 'POST' });
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Check-in failed');
    } finally {
      setActing(false);
    }
  }

  async function handleCheckOut() {
    if (!(await confirm({ title: 'Check out now?', confirmLabel: 'Check out' })))
      return;
    setActing(true);
    try {
      await apiFetch('/attendance/check-out', { method: 'POST' });
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Check-out failed');
    } finally {
      setActing(false);
    }
  }

  // Today's status line + the action that applies to the current state.
  const onLeave = todayRecord?.status === 'ON_LEAVE';
  const checkedIn = !!todayRecord?.checkInTime;
  const checkedOut = !!todayRecord?.checkOutTime;

  let statusLine: string;
  if (onLeave) statusLine = 'On approved leave today — no check-in required.';
  else if (!checkedIn) statusLine = 'Not checked in yet.';
  else if (!checkedOut)
    statusLine = `Checked in at ${formatTime(todayRecord!.checkInTime)}.`;
  else
    statusLine = `Checked in at ${formatTime(
      todayRecord!.checkInTime,
    )}, out at ${formatTime(todayRecord!.checkOutTime)}.`;

  return (
    <PageContainer>
      <PageHeader title="My Attendance" />

      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

      {/* Today's status + action */}
      <Card className="mb-6">
        <CardContent className="flex flex-wrap items-center justify-between gap-4 p-6">
          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Today · {today}
            </div>
            <div className="mt-1 text-lg font-medium">{statusLine}</div>
          </div>
          {loading ? (
            <Skeleton className="h-10 w-32" />
          ) : onLeave ? (
            <StatusBadge value="ON_LEAVE" />
          ) : !checkedIn ? (
            <Button size="lg" disabled={acting} onClick={handleCheckIn}>
              Check In
            </Button>
          ) : !checkedOut ? (
            <Button size="lg" disabled={acting} onClick={handleCheckOut}>
              Check Out
            </Button>
          ) : (
            <Button size="lg" variant="outline" disabled>
              Done for today
            </Button>
          )}
        </CardContent>
      </Card>

      {/* History */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Check In</TableHead>
                <TableHead>Check Out</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 4 }).map((__, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-4 w-20" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : history.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="p-0">
                    <EmptyState
                      icon={CalendarOff}
                      title="No attendance records yet"
                      description="Your check-in history will appear here."
                    />
                  </TableCell>
                </TableRow>
              ) : (
                history.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="font-medium">
                      {a.date.slice(0, 10)}
                    </TableCell>
                    <TableCell>{formatTime(a.checkInTime)}</TableCell>
                    <TableCell>{formatTime(a.checkOutTime)}</TableCell>
                    <TableCell>
                      <StatusBadge value={a.status} />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="mt-4 flex items-center gap-3">
        <Button
          variant="outline"
          size="sm"
          disabled={page <= 1}
          onClick={() => setPage((p) => p - 1)}
        >
          Prev
        </Button>
        <span className="text-sm text-muted-foreground">
          Page {page} of {Math.max(1, Math.ceil(total / limit))}
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={page * limit >= total}
          onClick={() => setPage((p) => p + 1)}
        >
          Next
        </Button>
      </div>
    </PageContainer>
  );
}
