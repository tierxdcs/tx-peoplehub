'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Ban, CheckCircle2, KeyRound } from 'lucide-react';
import { apiFetch, ApiError } from '../../../lib/api';
import { useAuth } from '../../../lib/auth-context';
import { Employee, PaginatedResult, Vertical } from '../../../lib/types';
import { roleLabel } from '../../../lib/status';
import {
  SCard,
  SIGNAL_BTN_GHOST,
  SIGNAL_BTN_PRIMARY,
  SIGNAL_DIALOG,
  SIGNAL_DIALOG_TITLE,
  SIGNAL_FAINT,
  SignalHeader,
  SignalPage,
} from '../../../components/ui/signal';
import { cn } from '../../../lib/utils';
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
  const [denyTarget, setDenyTarget] = useState<Employee | null>(null);
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
    <SignalPage>
      <SignalHeader
        title="Pending Access"
        description="Review onboarded employees and grant their ERP role, reporting line and initial login access."
      />
      <div className="space-y-4 px-5 pb-7 pt-[18px] lg:px-7">

      {error && <p className="text-sm text-destructive">{error}</p>}

      <SCard className="overflow-hidden">
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
                    className={cn('py-12 text-center', SIGNAL_FAINT)}
                  >
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
                    <TableCell className="space-x-2 text-right">
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => setDenyTarget(employee)}
                      >
                        <Ban /> Deny Access
                      </Button>
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
      </SCard>

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

      {denyTarget && (
        <DenyAccessDialog
          employee={denyTarget}
          onClose={() => setDenyTarget(null)}
          onDenied={() => {
            setDenyTarget(null);
            load();
          }}
        />
      )}

      {granted && (
        <Dialog open onOpenChange={(open) => !open && setGranted(null)}>
          <DialogContent className={SIGNAL_DIALOG}>
            <DialogHeader>
              <div className="mb-2 flex size-10 items-center justify-center rounded-full bg-success/15 text-success">
                <CheckCircle2 />
              </div>
              <DialogTitle className={SIGNAL_DIALOG_TITLE}>
                Access granted
              </DialogTitle>
              <DialogDescription>
                The employee can now sign in to the ERP.
              </DialogDescription>
            </DialogHeader>
            <p className="text-[13px]">
              {granted.firstName} {granted.lastName} can now log in using{' '}
              <strong className="font-semibold">{granted.email}</strong>.
            </p>
            <DialogFooter>
              <button
                type="button"
                className={SIGNAL_BTN_PRIMARY}
                onClick={() => setGranted(null)}
              >
                Done
              </button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      </div>
    </SignalPage>
  );
}

function DenyAccessDialog({
  employee,
  onClose,
  onDenied,
}: {
  employee: Employee;
  onClose: () => void;
  onDenied: () => void;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function deny() {
    if (reason.trim().length < 3) {
      setError('Please provide a reason for denying access');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await apiFetch(`/employees/${employee.id}/deny-access`, {
        method: 'PATCH',
        body: JSON.stringify({ reason: reason.trim() }),
      });
      onDenied();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to deny access');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className={SIGNAL_DIALOG}>
        <DialogHeader>
          <DialogTitle className={SIGNAL_DIALOG_TITLE}>
            Deny ERP access?
          </DialogTitle>
          <DialogDescription>
            {employee.firstName} {employee.lastName} will remain in the employee
            roster, but will not be able to sign in. This decision is audited.
          </DialogDescription>
        </DialogHeader>
        <Field label="Reason" required>
          <Input
            autoFocus
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Why is access being denied?"
          />
        </Field>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <button
            type="button"
            className={SIGNAL_BTN_GHOST}
            onClick={onClose}
            disabled={submitting}
          >
            Cancel
          </button>
          <Button variant="destructive" onClick={deny} disabled={submitting}>
            {submitting ? 'Denying…' : 'Deny Access'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
      <DialogContent className={cn('sm:max-w-xl', SIGNAL_DIALOG)}>
        <DialogHeader>
          <DialogTitle className={SIGNAL_DIALOG_TITLE}>
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
            <button type="button" className={SIGNAL_BTN_GHOST} onClick={onClose}>
              Cancel
            </button>
            <button
              type="submit"
              className={SIGNAL_BTN_PRIMARY}
              disabled={submitting}
            >
              {submitting ? 'Granting…' : 'Grant Access'}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
