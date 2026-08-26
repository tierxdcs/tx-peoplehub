'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { apiFetch, ApiError } from '../../../lib/api';
import { Employee, PaginatedResult, Vertical } from '../../../lib/types';
import { useConfirm } from '../../../components/ui/confirm';
import { useToast } from '../../../components/ui/toaster';
import { useAuth } from '../../../lib/auth-context';
import { roleLabel } from '../../../lib/status';
import {
  SCard,
  SIGNAL_LINK,
  SignalHeader,
  SignalPage,
} from '../../../components/ui/signal';
import { RegisterToolbar } from '../../../components/ui/register-toolbar';
import { RegisterPagination } from '../../../components/ui/register-pagination';
import { Button } from '../../../components/ui/button';
import { Select } from '../../../components/ui/select';
import { Badge } from '../../../components/ui/badge';
import { StatusBadge } from '../../../components/ui/status-badge';
import { EmptyState } from '../../../components/ui/empty-state';
import { Users } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../../components/ui/table';

export default function EmployeesListPage() {
  const confirm = useConfirm();
  const toast = useToast();
  const { user } = useAuth();
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [verticals, setVerticals] = useState<Vertical[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [verticalFilter, setVerticalFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const limit = 20;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [employeesRes, verticalsRes] = await Promise.all([
        apiFetch<PaginatedResult<Employee>>(
          `/employees?page=${page}&limit=${limit}`,
        ),
        apiFetch<Vertical[]>('/verticals'),
      ]);
      setEmployees(employeesRes.items);
      setTotal(employeesRes.total);
      setVerticals(verticalsRes);
    } catch {
      setError('Failed to load employees');
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleDeactivate(e: Employee) {
    const ok = await confirm({
      title: `Deactivate ${e.firstName} ${e.lastName}?`,
      description:
        'They will lose login access. All their records are kept and this can be reversed.',
      confirmLabel: 'Deactivate',
      destructive: true,
    });
    if (!ok) return;
    try {
      await apiFetch(`/employees/${e.id}/deactivate`, { method: 'PATCH' });
      toast.success('Employee deactivated.');
      await load();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : 'Failed to deactivate',
      );
    }
  }

  async function handleReactivate(e: Employee) {
    const ok = await confirm({
      title: `Activate ${e.firstName} ${e.lastName}?`,
      description:
        'This restores their login access with their existing role, vertical, and manager. It is not a re-hire — no onboarding needed.',
      confirmLabel: 'Activate',
    });
    if (!ok) return;
    try {
      await apiFetch(`/employees/${e.id}/reactivate`, { method: 'PATCH' });
      toast.success('Employee activated.');
      await load();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : 'Failed to activate',
      );
    }
  }

  async function handleDelete(e: Employee) {
    const ok = await confirm({
      title: `Permanently delete ${e.firstName} ${e.lastName}?`,
      description:
        'This removes the account entirely and cannot be undone. It is refused if they still own any reports or business records — deactivate instead in that case. Use this only for mistaken or duplicate accounts.',
      confirmLabel: 'Delete permanently',
      destructive: true,
    });
    if (!ok) return;
    try {
      await apiFetch(`/employees/${e.id}`, { method: 'DELETE' });
      toast.success(`${e.firstName} ${e.lastName} deleted.`);
      await load();
    } catch (err) {
      // Surface the backend's specific blocker list (e.g. "still referenced by
      // 3 payslips, 1 owned customer …") rather than a generic failure.
      toast.error(
        err instanceof ApiError ? err.message : 'Failed to delete employee',
      );
    }
  }

  const verticalName = (id: string | null) =>
    verticals.find((v) => v.id === id)?.name ?? '—';

  const filtered = employees.filter((e) => {
    if (verticalFilter && e.verticalId !== verticalFilter) return false;
    if (statusFilter && e.status !== statusFilter) return false;
    if (search) {
      const haystack = `${e.firstName} ${e.lastName} ${e.email}`.toLowerCase();
      if (!haystack.includes(search.toLowerCase())) return false;
    }
    return true;
  });

  return (
    <SignalPage>
      <SignalHeader
        title="Employees"
        description="Manage employee access, roles and organizational assignments."
        actions={
          <Link href="/admin/employees/new">
            <Button>Create Employee</Button>
          </Link>
        }
      />
      <div className="space-y-4 px-5 pb-7 pt-[18px] lg:px-7">
      <RegisterToolbar title="Employee Register" search={search} onSearchChange={setSearch} searchPlaceholder="Search name or email" filters={<>
        <Select
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
        </Select>
        <Select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="w-44"
        >
          <option value="">All statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="INACTIVE">Inactive</option>
        </Select>
      </>} />

      {error && <p className="text-destructive">{error}</p>}
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <>
          <SCard className="overflow-hidden"><Table>
            <TableHeader><TableRow><TableHead>Employee ID</TableHead><TableHead>Name</TableHead><TableHead>Email</TableHead><TableHead>Vertical</TableHead><TableHead>Role</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
            <TableBody>
              {filtered.map((e) => (
                <TableRow key={e.id}>
                  <TableCell>{e.employeeId}</TableCell>
                  <TableCell>
                    <Link href={`/admin/employees/${e.id}`} className={SIGNAL_LINK}>
                      {e.firstName} {e.lastName}
                    </Link>
                    {e.isSalesHead && (
                      <Badge variant="secondary" className="ml-2">Sales Head</Badge>
                    )}
                    {e.isProjectManager && (
                      <Badge variant="secondary" className="ml-2">Project Manager</Badge>
                    )}
                    {e.isInternalAuditor && (
                      <Badge variant="secondary" className="ml-2">Internal Auditor</Badge>
                    )}
                    {e.isRdHead && (
                      <Badge variant="secondary" className="ml-2">R&D Head</Badge>
                    )}
                  </TableCell>
                  <TableCell>{e.email}</TableCell><TableCell>{verticalName(e.verticalId)}</TableCell><TableCell>{roleLabel(e.role)}</TableCell><TableCell><StatusBadge value={e.status} /></TableCell>
                  <TableCell><div className="flex justify-end gap-2">
                      <Link href={`/admin/employees/${e.id}`}><Button variant="outline" size="sm">Edit</Button></Link>
                      {e.status === 'ACTIVE' ? (
                        <Button variant="outline" size="sm" onClick={() => handleDeactivate(e)}>Deactivate</Button>
                      ) : (
                        <Button variant="outline" size="sm" onClick={() => handleReactivate(e)}>Activate</Button>
                      )}
                      {isSuperAdmin && (
                        <Button variant="destructive" size="sm" onClick={() => handleDelete(e)}>Delete</Button>
                      )}
                    </div></TableCell>
                </TableRow>
              ))}
              {!filtered.length && <TableRow><TableCell colSpan={7} className="p-0"><EmptyState icon={Users} title="No employees match your filters" /></TableCell></TableRow>}
            </TableBody></Table></SCard>
          <RegisterPagination page={page} pageCount={Math.ceil(total / limit)} onPageChange={setPage} disabled={loading} />
        </>
      )}
      </div>
    </SignalPage>
  );
}
