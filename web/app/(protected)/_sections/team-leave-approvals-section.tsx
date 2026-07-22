'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2 } from 'lucide-react';
import { useAuth, roleHome } from '../../lib/auth-context';
import { apiFetch, ApiError } from '../../lib/api';
import {
  Employee,
  LeaveRequest,
  LeaveType,
  PaginatedResult,
} from '../../lib/types';
import { PageContainer } from '../../components/ui/page-container';
import { PageHeader } from '../../components/ui/page-header';
import { Card, CardContent } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Avatar } from '../../components/ui/avatar';
import { Skeleton } from '../../components/ui/skeleton';
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
import { SignatureSetupInline } from '../../components/ui/signature-setup-inline';

/**
 * Team leave-approval queue — reusable as a standalone route and as a profile
 * tab (spec: personal + team self-service lives under My Profile). When
 * `embedded`, drops the PageContainer/PageHeader and never redirects (the
 * profile page only mounts this tab for allowed roles).
 *
 * Backend-enforced scope: /leave-requests/pending-approval is server-shaped
 * (Manager -> direct reports only; a Manager's own request never appears here,
 * and self-approval is separately blocked at approve/reject time). This trusts
 * whatever the endpoint returns rather than re-deriving scope.
 */
export function TeamLeaveApprovalsSection({
  embedded = false,
}: {
  embedded?: boolean;
}) {
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
  const [hasSignature, setHasSignature] = useState(true);

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

  // Whether the approving manager has a signature configured — drives the
  // just-in-time setup prompt above the queue.
  useEffect(() => {
    if (authLoading || !user || !allowed) return;
    apiFetch<Employee>(`/employees/${user.sub}`)
      .then((me) => setHasSignature(!!me.signatureText))
      .catch(() => setHasSignature(true));
  }, [authLoading, user, allowed]);

  if (authLoading || !user) return null;
  if (!allowed) {
    // Standalone route redirects; embedded never does (profile gates the tab).
    if (!embedded) router.replace(roleHome(user.role));
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

  const body = (
    <>
      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

      {!hasSignature && !loading && requests.length > 0 && (
        <div className="mb-4">
          <SignatureSetupInline onSaved={() => setHasSignature(true)} />
        </div>
      )}

      <Card>
        <CardContent
          className={loading || requests.length === 0 ? 'pt-6' : 'p-0'}
        >
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
            <>
              <div className="space-y-3 p-3 md:hidden">
                {requests.map((r) => (
                  <article
                    key={r.id}
                    className="space-y-3 rounded-lg border p-4"
                  >
                    <div className="flex items-center gap-3">
                      <Avatar name={employeeNames[r.employeeId] ?? '?'} />
                      <div className="min-w-0">
                        <p className="truncate font-medium">
                          {employeeNames[r.employeeId] ?? '…'}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {leaveTypeName(r.leaveTypeId)} · {r.numberOfDays}{' '}
                          day(s)
                        </p>
                      </div>
                    </div>
                    <dl className="grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <dt className="text-xs text-muted-foreground">Dates</dt>
                        <dd>
                          {r.startDate.slice(0, 10)} → {r.endDate.slice(0, 10)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted-foreground">
                          Reason
                        </dt>
                        <dd className="break-words">{r.reason}</dd>
                      </div>
                    </dl>
                    <Input
                      placeholder="Optional approval comment"
                      value={comments[r.id] ?? ''}
                      onChange={(e) =>
                        setComments((c) => ({ ...c, [r.id]: e.target.value }))
                      }
                    />
                    <div className="grid grid-cols-2 gap-3">
                      <Button
                        disabled={acting === r.id}
                        onClick={() => act(r.id, 'approve')}
                      >
                        Approve
                      </Button>
                      <Button
                        variant="destructive"
                        disabled={acting === r.id}
                        onClick={() => act(r.id, 'reject')}
                      >
                        Reject
                      </Button>
                    </div>
                  </article>
                ))}
              </div>
              <div className="hidden md:block">
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
                              setComments((c) => ({
                                ...c,
                                [r.id]: e.target.value,
                              }))
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
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </>
  );

  if (embedded) return body;
  return (
    <PageContainer>
      <PageHeader
        title="Team Leave Approvals"
        description="Leave requests from your reports awaiting your decision."
      />
      {body}
    </PageContainer>
  );
}
