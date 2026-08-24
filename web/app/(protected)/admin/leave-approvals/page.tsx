'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiFetch, ApiError } from '../../../lib/api';
import {
  Employee,
  LeaveRequest,
  LeaveType,
  PaginatedResult,
  Vertical,
} from '../../../lib/types';
import { useToast } from '../../../components/ui/toaster';
import { useConfirm } from '../../../components/ui/confirm';
import {
  SCard,
  SignalHeader,
  SignalPage,
} from '../../../components/ui/signal';
import { RegisterToolbar } from '../../../components/ui/register-toolbar';
import { RegisterPagination } from '../../../components/ui/register-pagination';
import { Select } from '../../../components/ui/select';
import { Input } from '../../../components/ui/input';
import { Button } from '../../../components/ui/button';
import { EmptyState } from '../../../components/ui/empty-state';
import { ClipboardCheck } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../../components/ui/table';
import { useRegisterList } from '../../../lib/use-register-list';

/**
 * Same /leave-requests/pending-approval endpoint as the Manager screen —
 * the backend returns every PENDING request company-wide for Admin/
 * SuperAdmin callers (no reportingManagerId filter applied server-side).
 * The vertical filter here is client-side only, over that full result set.
 */
export default function AdminLeaveApprovalsPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([]);
  const [verticals, setVerticals] = useState<Vertical[]>([]);
  const [employees, setEmployees] = useState<Record<string, Employee>>({});
  const [verticalFilter, setVerticalFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [comments, setComments] = useState<Record<string, string>>({});
  const [acting, setActing] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [reqRes, typesRes, verticalsRes] = await Promise.all([
        apiFetch<PaginatedResult<LeaveRequest>>(
          '/leave-requests/pending-approval?page=1&limit=100',
        ),
        apiFetch<LeaveType[]>('/leave-types'),
        apiFetch<Vertical[]>('/verticals'),
      ]);
      setRequests(reqRes.items);
      setLeaveTypes(typesRes);
      setVerticals(verticalsRes);

      const ids = [...new Set(reqRes.items.map((r) => r.employeeId))];
      const resolved: Record<string, Employee> = {};
      await Promise.all(
        ids.map(async (id) => {
          try {
            resolved[id] = await apiFetch<Employee>(`/employees/${id}`);
          } catch {
            // leave unresolved; rendered as the raw id
          }
        }),
      );
      setEmployees(resolved);
    } catch {
      setError('Failed to load pending approvals');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const leaveTypeName = (id: string) =>
    leaveTypes.find((t) => t.id === id)?.name ?? '—';
  const verticalName = (id: string | null) =>
    verticals.find((v) => v.id === id)?.name ?? '—';

  const filtered = requests.filter((r) => {
    if (!verticalFilter) return true;
    return employees[r.employeeId]?.verticalId === verticalFilter;
  });
  const register = useRegisterList(filtered, (request) => { const employee = employees[request.employeeId]; return `${employee?.firstName ?? ''} ${employee?.lastName ?? ''} ${request.status} ${leaveTypeName(request.leaveTypeId)} ${verticalName(employee?.verticalId ?? null)} ${request.reason}`; });

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
    <SignalPage>
      <SignalHeader
        title="Leave Approvals"
        description="Review pending leave requests across the company."
      />
      <div className="space-y-4 px-5 pb-7 pt-[18px] lg:px-7">
      <RegisterToolbar title="Approval Queue" search={register.search} onSearchChange={register.setSearch} searchPlaceholder="Search requester, status, type or vertical" filters={<Select
          value={verticalFilter}
          onChange={(e) => setVerticalFilter(e.target.value)}
          className="w-48"
        >
          <option value="">All verticals</option>
          {verticals.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </Select>} />

      {error && <p className="text-destructive">{error}</p>}
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <SCard className="overflow-hidden"><Table>
          <TableHeader><TableRow><TableHead>Employee</TableHead><TableHead>Vertical</TableHead><TableHead>Type</TableHead><TableHead>Dates</TableHead><TableHead>Days</TableHead><TableHead>Reason</TableHead><TableHead>Requested</TableHead><TableHead>Comment</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
          <TableBody>
            {register.visibleItems.map((r) => {
              const emp = employees[r.employeeId];
              return (
                <TableRow key={r.id}>
                  <TableCell>{emp ? `${emp.firstName} ${emp.lastName}` : r.employeeId}</TableCell><TableCell>{verticalName(emp?.verticalId ?? null)}</TableCell><TableCell>{leaveTypeName(r.leaveTypeId)}</TableCell><TableCell>
                    {r.startDate.slice(0, 10)} → {r.endDate.slice(0, 10)}
                  </TableCell><TableCell>{r.numberOfDays}</TableCell><TableCell>{r.reason}</TableCell><TableCell>{new Date(r.createdAt).toLocaleDateString()}</TableCell><TableCell><Input
                      placeholder="Optional comment"
                      value={comments[r.id] ?? ''}
                      onChange={(e) =>
                        setComments((c) => ({ ...c, [r.id]: e.target.value }))
                      }
                      className="min-w-40"
                    /></TableCell>
                  <TableCell><div className="flex justify-end gap-2"><Button size="sm"
                      disabled={acting === r.id}
                      onClick={() => act(r.id, 'approve')}
                    >Approve</Button><Button size="sm" variant="destructive"
                      disabled={acting === r.id}
                      onClick={() => act(r.id, 'reject')}
                    >Reject</Button></div></TableCell>
                </TableRow>
              );
            })}
            {!register.visibleItems.length && <TableRow><TableCell colSpan={9} className="p-0"><EmptyState icon={ClipboardCheck} title="No pending leave requests match your filters" tone="positive" /></TableCell></TableRow>}
          </TableBody></Table></SCard>
      )}
      <RegisterPagination page={register.page} pageCount={register.pageCount} onPageChange={register.setPage} disabled={loading} />
      </div>
    </SignalPage>
  );
}
