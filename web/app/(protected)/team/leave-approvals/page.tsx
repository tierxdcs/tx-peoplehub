'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2 } from 'lucide-react';
import { useAuth, roleHome } from '../../../lib/auth-context';
import { apiFetch, ApiError } from '../../../lib/api';
import {
  Employee,
  LeaveRequest,
  LeaveType,
  PaginatedResult,
} from '../../../lib/types';
import { PageContainer } from '../../../components/ui/page-container';
import { PageHeader } from '../../../components/ui/page-header';
import { Card, CardContent } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Avatar } from '../../../components/ui/avatar';
import { Skeleton } from '../../../components/ui/skeleton';
import { EmptyState } from '../../../components/ui/empty-state';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../components/ui/table';
import { useToast } from '../../../components/ui/toaster';
import { useConfirm } from '../../../components/ui/confirm';

/**
 * Backend-enforced scope: /leave-requests/pending-approval is server-shaped
 * (Manager -> direct reports only; a Manager's own request never appears
 * here since the query filters on employee.reportingManagerId === caller,
 * and self-approval is separately blocked at approve/reject time). This
 * page trusts whatever the endpoint returns rather than re-deriving scope.
 */
export default function TeamLeaveApprovalsPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const allowed =
    user?.role === 'MANAGER' ||
    user?.role === 'ADMIN' ||
    user?.role === 'SUPER_ADMIN';

  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([]);
  const [employeeNames, setEmployeeNames] = useState<Record<string, string>>(
    {},
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [comments, setComments] = useState<Record<string, string>>({});
  const [acting, setActing] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [reqRes, typesRes] = await Promise.all([
        apiFetch<PaginatedResult<LeaveRequest>>(
          '/leave-requests/pending-approval?page=1&limit=100',
        ),
        apiFetch<LeaveType[]>('/leave-types'),
      ]);
      setRequests(reqRes.items);
      setLeaveTypes(typesRes);

      const ids = [...new Set(reqRes.items.map((r) => r.employeeId))];
      const resolved: Record<string, string> = {};
      await Promise.all(
        ids.map(async (id) => {
          try {
            const emp = await apiFetch<Employee>(`/employees/${id}`);
            resolved[id] = `${emp.firstName} ${emp.lastName}`;
          } catch {
            resolved[id] = id;
          }
        }),
      );
      setEmployeeNames(resolved);
    } catch {
      setError('Failed to load pending approvals');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authLoading || !user || !allowed) return;
    load();
  }, [authLoading, user, allowed, load]);

  if (authLoading || !user) return null;
  if (!allowed) {
    router.replace(roleHome(user.role));
    return null;
  }

  const leaveTypeName = (id: string) =>
    leaveTypes.find((t) => t.id === id)?.name ?? '—';

  async function act(id: string, action: 'approve' | 'reject') {
    const ok = await confirm(
      action === 'approve'
        ? { title: 'Approve this leave request?' }
        : {
            title: 'Reject this leave request?',
            description: 'The employee will be notified of the rejection.',
            destructive: true,
          },
    );
    if (!ok) return;
    setActing(id);
    try {
      await apiFetch(`/leave-requests/${id}/${action}`, {
        method: 'PATCH',
        body: JSON.stringify({ approverComments: comments[id] || undefined }),
      });
      await load();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : `Failed to ${action} request`,
      );
    } finally {
      setActing(null);
    }
  }

  return (
    <PageContainer>
      <PageHeader
        title="Team Leave Approvals"
        description="Leave requests from your reports awaiting your decision."
      />

      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

      <Card>
        <CardContent className={loading || requests.length === 0 ? 'pt-6' : 'p-0'}>
          {loading ? (
            <Skeleton className="h-40 w-full" />
          ) : requests.length === 0 ? (
            <EmptyState
              icon={CheckCircle2}
              tone="positive"
              title="All caught up"
              description="No leave requests are waiting for your approval right now."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Dates</TableHead>
                  <TableHead className="text-right">Days</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Comment</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {requests.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Avatar name={employeeNames[r.employeeId] ?? '?'} />
                        <span className="font-medium">
                          {employeeNames[r.employeeId] ?? '…'}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>{leaveTypeName(r.leaveTypeId)}</TableCell>
                    <TableCell>
                      {r.startDate.slice(0, 10)} → {r.endDate.slice(0, 10)}
                    </TableCell>
                    <TableCell className="text-right">
                      {r.numberOfDays}
                    </TableCell>
                    <TableCell className="max-w-[220px] truncate">
                      {r.reason}
                    </TableCell>
                    <TableCell>
                      <Input
                        className="w-40"
                        placeholder="Optional comment"
                        value={comments[r.id] ?? ''}
                        onChange={(e) =>
                          setComments((c) => ({ ...c, [r.id]: e.target.value }))
                        }
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          size="sm"
                          disabled={acting === r.id}
                          onClick={() => act(r.id, 'approve')}
                        >
                          Approve
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          disabled={acting === r.id}
                          onClick={() => act(r.id, 'reject')}
                        >
                          Reject
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </PageContainer>
  );
}
