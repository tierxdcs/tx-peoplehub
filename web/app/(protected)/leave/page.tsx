'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarOff, CalendarDays } from 'lucide-react';
import { apiFetch, ApiError } from '../../lib/api';
import { inclusiveDaySpan, todayDateStr } from '../../lib/date';
import {
  Employee,
  LeaveBalance,
  LeaveRequest,
  LeaveType,
  PaginatedResult,
} from '../../lib/types';
import { PageContainer } from '../../components/ui/page-container';
import { PageHeader } from '../../components/ui/page-header';
import { Card, CardContent } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Field } from '../../components/ui/field';
import { Input } from '../../components/ui/input';
import { Select } from '../../components/ui/select';
import { Textarea } from '../../components/ui/textarea';
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
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { useToast } from '../../components/ui/toaster';
import { useConfirm } from '../../components/ui/confirm';
import { SignatureDisplay } from '../../components/ui/signature-display';

export default function MyLeavePage() {
  const toast = useToast();
  const confirm = useConfirm();
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([]);
  const [balances, setBalances] = useState<LeaveBalance[]>([]);
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [approverNames, setApproverNames] = useState<Record<string, string>>(
    {},
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const limit = 20;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [typesRes, balancesRes, requestsRes] = await Promise.all([
        apiFetch<LeaveType[]>('/leave-types'),
        apiFetch<LeaveBalance[]>('/leave-balances/me'),
        apiFetch<PaginatedResult<LeaveRequest>>(
          `/leave-requests/me?page=${page}&limit=${limit}`,
        ),
      ]);
      setLeaveTypes(typesRes);
      setBalances(balancesRes);
      setRequests(requestsRes.items);
      setTotal(requestsRes.total);

      const approverIds = [
        ...new Set(
          requestsRes.items
            .map((r) => r.approverId)
            .filter((id): id is string => !!id),
        ),
      ];
      const resolved: Record<string, string> = {};
      await Promise.all(
        approverIds.map(async (id) => {
          try {
            const emp = await apiFetch<Employee>(`/employees/${id}`);
            resolved[id] = `${emp.firstName} ${emp.lastName}`;
          } catch {
            resolved[id] = 'Admin';
          }
        }),
      );
      setApproverNames(resolved);
    } catch {
      setError('Failed to load leave data');
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    load();
  }, [load]);

  const leaveTypeName = (id: string) =>
    leaveTypes.find((t) => t.id === id)?.name ?? '—';

  const today = todayDateStr();

  async function handleCancel(id: string) {
    const ok = await confirm({
      title: 'Cancel this leave request?',
      description: 'This withdraws the request.',
      confirmLabel: 'Cancel request',
      cancelLabel: 'Keep',
      destructive: true,
    });
    if (!ok) return;
    try {
      await apiFetch(`/leave-requests/${id}/cancel`, { method: 'PATCH' });
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to cancel');
    }
  }

  return (
    <PageContainer>
      <PageHeader
        title="My Leave"
        action={<Button onClick={() => setShowForm(true)}>Request Leave</Button>}
      />

      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

      {/* Balance summary — one card per leave type */}
      <div className="mb-6 flex flex-wrap gap-3">
        {loading
          ? Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-40" />
            ))
          : leaveTypes.map((t) => {
              const balance = balances.find((b) => b.leaveTypeId === t.id);
              const unlimited = t.accrualType === 'UNTRACKED';
              return (
                <Card key={t.id} className="min-w-[160px] flex-1">
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                      <CalendarDays className="size-4" />
                      {t.name} ({t.code})
                    </div>
                    {unlimited ? (
                      <div className="mt-2 text-lg font-medium text-muted-foreground">
                        Unlimited
                      </div>
                    ) : balance ? (
                      <div className="mt-2">
                        <span className="text-2xl font-semibold">
                          {balance.remaining}
                        </span>
                        <span className="ml-1 text-sm text-muted-foreground">
                          / {balance.allocated} left
                        </span>
                      </div>
                    ) : (
                      <div className="mt-2 text-sm text-muted-foreground">—</div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
      </div>

      {/* Request history */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Type</TableHead>
                <TableHead>Dates</TableHead>
                <TableHead className="text-right">Days</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Approver</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 6 }).map((__, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-4 w-20" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : requests.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="p-0">
                    <EmptyState
                      icon={CalendarOff}
                      title="No leave requests yet"
                      description="When you request leave, it'll show up here with its status."
                    />
                  </TableCell>
                </TableRow>
              ) : (
                requests.map((r) => {
                  const canCancel =
                    r.status === 'PENDING' ||
                    (r.status === 'APPROVED' &&
                      r.startDate.slice(0, 10) > today);
                  return (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">
                        {leaveTypeName(r.leaveTypeId)}
                      </TableCell>
                      <TableCell>
                        {r.startDate.slice(0, 10)} → {r.endDate.slice(0, 10)}
                      </TableCell>
                      <TableCell className="text-right">
                        {r.numberOfDays}
                      </TableCell>
                      <TableCell>
                        <StatusBadge value={r.status} />
                      </TableCell>
                      <TableCell>
                        {r.status === 'APPROVED' ? (
                          <SignatureDisplay
                            text={r.approverSignatureTextSnapshot}
                            font={r.approverSignatureFontSnapshot}
                            approverName={
                              r.approverId
                                ? approverNames[r.approverId] ?? '…'
                                : undefined
                            }
                            date={
                              r.approvedAt ? r.approvedAt.slice(0, 10) : null
                            }
                          />
                        ) : r.approverId ? (
                          approverNames[r.approverId] ?? '…'
                        ) : (
                          '—'
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {canCancel ? (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleCancel(r.id)}
                          >
                            Cancel
                          </Button>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })
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

      {showForm && (
        <RequestLeaveForm
          leaveTypes={leaveTypes.filter((t) => t.isActive)}
          onClose={() => setShowForm(false)}
          onSubmitted={() => {
            setShowForm(false);
            load();
          }}
        />
      )}
    </PageContainer>
  );
}

function RequestLeaveForm({
  leaveTypes,
  onClose,
  onSubmitted,
}: {
  leaveTypes: LeaveType[];
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const today = todayDateStr();
  const [leaveTypeId, setLeaveTypeId] = useState(leaveTypes[0]?.id ?? '');
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [halfDay, setHalfDay] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const numberOfDays = useMemo(() => {
    if (halfDay) return 0.5;
    if (endDate < startDate) return 0;
    return inclusiveDaySpan(startDate, endDate);
  }, [halfDay, startDate, endDate]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!leaveTypeId) {
      setError('Leave type is required');
      return;
    }
    if (endDate < startDate) {
      setError('End date cannot be before start date');
      return;
    }
    if (!reason.trim()) {
      setError('Reason is required');
      return;
    }

    setSubmitting(true);
    try {
      await apiFetch('/leave-requests', {
        method: 'POST',
        body: JSON.stringify({
          leaveTypeId,
          startDate,
          endDate: halfDay ? startDate : endDate,
          numberOfDays,
          reason,
        }),
      });
      onSubmitted();
    } catch (err) {
      // Surface the backend's specific message verbatim (e.g. the overlap
      // conflict) rather than a generic failure string.
      setError(
        err instanceof ApiError ? err.message : 'Failed to submit request',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Request Leave</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Field label="Leave type" htmlFor="leaveType" required>
            <Select
              id="leaveType"
              value={leaveTypeId}
              onChange={(e) => setLeaveTypeId(e.target.value)}
            >
              {leaveTypes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.code})
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Start date" htmlFor="startDate" required>
            <Input
              id="startDate"
              type="date"
              value={startDate}
              onChange={(e) => {
                setStartDate(e.target.value);
                if (e.target.value > endDate) setEndDate(e.target.value);
              }}
            />
          </Field>

          {!halfDay && (
            <Field label="End date" htmlFor="endDate" required>
              <Input
                id="endDate"
                type="date"
                value={endDate}
                min={startDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </Field>
          )}

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={halfDay}
              onChange={(e) => setHalfDay(e.target.checked)}
            />
            Half day
          </label>

          <p className="text-sm text-muted-foreground">
            Number of days: {numberOfDays}
          </p>

          <Field label="Reason" htmlFor="reason" required>
            <Textarea
              id="reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Submitting…' : 'Submit'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
