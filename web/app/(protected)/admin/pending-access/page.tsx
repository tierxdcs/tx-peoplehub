'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, KeyRound, UserCheck } from 'lucide-react';
import { apiFetch, ApiError } from '../../../lib/api';
import { useAuth } from '../../../lib/auth-context';
import { Employee, PaginatedResult, Vertical } from '../../../lib/types';
import { roleLabel } from '../../../lib/status';
import { PageContainer } from '../../../components/ui/page-container';
import { PageHeader } from '../../../components/ui/page-header';
import { Card, CardContent } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Select } from '../../../components/ui/select';
import { Field } from '../../../components/ui/field';
import { Skeleton } from '../../../components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../components/ui/dialog';

// MANAGER / EMPLOYEE are grantable by any admin; ADMIN is added only for a
// SUPER_ADMIN caller (mirrors the backend assertMayAssignRole rule — the API
// rejects an ADMIN grant from anyone else regardless of the UI).
const NON_PRIVILEGED_ROLES: Array<'MANAGER' | 'EMPLOYEE'> = [
  'MANAGER',
  'EMPLOYEE',
];

export default function PendingAccessPage() {
  const [items, setItems] = useState<Employee[]>([]);
  const [verticals, setVerticals] = useState<Vertical[]>([]);
  const [candidateManagers, setCandidateManagers] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [grantTarget, setGrantTarget] = useState<Employee | null>(null);
  const [granted, setGranted] = useState<Employee | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [pendingRes, verticalsRes, employeesRes] = await Promise.all([
        apiFetch<PaginatedResult<Employee>>(
          '/employees/pending-access?page=1&limit=100',
        ),
        apiFetch<Vertical[]>('/verticals'),
        apiFetch<PaginatedResult<Employee>>('/employees?page=1&limit=100'),
      ]);
      setItems(pendingRes.items);
      setVerticals(verticalsRes);
      setCandidateManagers(
        employeesRes.items.filter(
          (e) =>
            e.status === 'ACTIVE' &&
            (e.role === 'MANAGER' || e.role === 'SUPER_ADMIN'),
        ),
      );
    } catch {
      setError('Failed to load pending access queue');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const verticalName = (id: string | null) =>
    verticals.find((v) => v.id === id)?.name ?? '—';

  return (
    <PageContainer>
      <PageHeader
        title="Pending Access"
        description="Review onboarded employees and grant their ERP role, reporting line and initial login access."
      />

      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee ID</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Vertical</TableHead>
                <TableHead>Designation</TableHead>
                <TableHead>Date onboarded</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 3 }).map((_, row) => (
                  <TableRow key={row}>
                    {Array.from({ length: 6 }).map((__, column) => (
                      <TableCell key={column}>
                        <Skeleton className="h-4 w-24" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : items.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="py-12 text-center text-muted-foreground"
                  >
                    <UserCheck className="mx-auto mb-3 size-8 opacity-50" />
                    No employees are awaiting access.
                  </TableCell>
                </TableRow>
              ) : (
                items.map((employee) => (
                  <TableRow key={employee.id}>
                    <TableCell className="font-medium">
                      {employee.employeeId}
                    </TableCell>
                    <TableCell>
                      {employee.firstName} {employee.lastName}
                    </TableCell>
                    <TableCell>{verticalName(employee.verticalId)}</TableCell>
                    <TableCell>{employee.designation ?? '—'}</TableCell>
                    <TableCell>
                      {new Date(employee.createdAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        onClick={() => setGrantTarget(employee)}
                      >
                        <KeyRound /> Grant Access
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {grantTarget && (
        <GrantAccessForm
          employee={grantTarget}
          verticals={verticals}
          candidateManagers={candidateManagers}
          onClose={() => setGrantTarget(null)}
          onGranted={(employee) => {
            setGrantTarget(null);
            setGranted(employee);
            load();
          }}
        />
      )}

      {granted && (
        <Dialog open onOpenChange={(open) => !open && setGranted(null)}>
          <DialogContent>
            <DialogHeader>
              <div className="mb-2 flex size-10 items-center justify-center rounded-full bg-success/15 text-success">
                <CheckCircle2 />
              </div>
              <DialogTitle>Access granted</DialogTitle>
              <DialogDescription>
                The employee can now sign in to the ERP.
              </DialogDescription>
            </DialogHeader>
            <p className="text-sm">
              {granted.firstName} {granted.lastName} can now log in using{' '}
              <strong>{granted.email}</strong>.
            </p>
            <DialogFooter>
              <Button onClick={() => setGranted(null)}>Done</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </PageContainer>
  );
}

function GrantAccessForm({
  employee,
  verticals,
  candidateManagers,
  onClose,
  onGranted,
}: {
  employee: Employee;
  verticals: Vertical[];
  candidateManagers: Employee[];
  onClose: () => void;
  onGranted: (employee: Employee) => void;
}) {
  const { user } = useAuth();
  const callerIsSuperAdmin = user?.role === 'SUPER_ADMIN';
  const assignableRoles: Array<'ADMIN' | 'MANAGER' | 'EMPLOYEE'> =
    callerIsSuperAdmin
      ? ['ADMIN', ...NON_PRIVILEGED_ROLES]
      : [...NON_PRIVILEGED_ROLES];
  const [role, setRole] = useState<'ADMIN' | 'MANAGER' | 'EMPLOYEE'>(
    'EMPLOYEE',
  );
  const [verticalId, setVerticalId] = useState(employee.verticalId ?? '');
  const [managerId, setManagerId] = useState('');
  const [managerSearch, setManagerSearch] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const managerOptions = useMemo(() => {
    return candidateManagers.filter((m) => {
      const haystack = `${m.firstName} ${m.lastName} ${m.email}`.toLowerCase();
      return haystack.includes(managerSearch.toLowerCase());
    });
  }, [candidateManagers, managerSearch]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!verticalId) {
      setError('Vertical is required');
      return;
    }
    if (!managerId) {
      setError('Reporting manager is required');
      return;
    }

    setSubmitting(true);
    try {
      const granted = await apiFetch<Employee>(
        `/employees/${employee.id}/grant-access`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            role,
            verticalId,
            reportingManagerId: managerId,
            password,
          }),
        },
      );
      onGranted(granted);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Failed to grant access',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            Grant access — {employee.firstName} {employee.lastName}
          </DialogTitle>
          <DialogDescription>
            Assign the employee&apos;s ERP permissions and reporting manager.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Field label="Role" required>
            <Select
              value={role}
              onChange={(e) =>
                setRole(e.target.value as 'ADMIN' | 'MANAGER' | 'EMPLOYEE')
              }
            >
              {assignableRoles.map((r) => (
                <option key={r} value={r}>
                  {r === 'ADMIN'
                    ? 'Admin'
                    : r === 'MANAGER'
                      ? 'Manager'
                      : 'Employee'}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Vertical" required>
            <Select
              value={verticalId}
              onChange={(e) => setVerticalId(e.target.value)}
              required
            >
              <option value="">Select a vertical…</option>
              {verticals.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Reporting manager" required>
            <Input
              placeholder="Filter by name or email"
              value={managerSearch}
              onChange={(e) => setManagerSearch(e.target.value)}
              className="mb-2"
            />
            <Select
              value={managerId}
              onChange={(e) => setManagerId(e.target.value)}
              required
            >
              <option value="">Select a manager…</option>
              {managerOptions.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.firstName} {m.lastName} ({m.employeeId}, {roleLabel(m.role)})
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label="Initial password"
            required
            hint="Minimum 8 characters. Share it with the employee securely."
          >
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              autoComplete="new-password"
            />
          </Field>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Granting…' : 'Grant Access'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
