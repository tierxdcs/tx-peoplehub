'use client';

import { useMemo, useState } from 'react';
import { Employee, EmploymentType, Vertical } from '../../../../lib/types';
import { Role } from '../../../../lib/jwt';
import { Card, CardContent } from '../../../../components/ui/card';
import { Input } from '../../../../components/ui/input';
import { Select } from '../../../../components/ui/select';
import { Field } from '../../../../components/ui/field';
import { Button } from '../../../../components/ui/button';

export interface EmployeeFormValues {
  firstName: string;
  lastName: string;
  email: string;
  password?: string;
  role: 'ADMIN' | 'MANAGER' | 'EMPLOYEE' | 'SUPER_ADMIN';
  // Optional: a SUPER_ADMIN (e.g. the CEO) may have no vertical and reports to
  // no one. Omitted from the payload when empty so the API leaves them unset.
  verticalId?: string;
  reportingManagerId?: string;
  // Optional HR/profile attributes (shown as roster columns).
  designation?: string;
  employmentType?: EmploymentType;
  workLocation?: string;
}

const EMPLOYMENT_TYPES: { value: EmploymentType; label: string }[] = [
  { value: 'FULL_TIME_PERMANENT', label: 'Full-time (Permanent)' },
  { value: 'CONTRACT', label: 'Contract' },
  { value: 'INTERN', label: 'Intern' },
  { value: 'PART_TIME', label: 'Part-time' },
];

interface EmployeeFormProps {
  mode: 'create' | 'edit';
  initial?: Partial<EmployeeFormValues>;
  verticals: Vertical[];
  candidateManagers: Employee[];
  onSubmit: (values: EmployeeFormValues) => Promise<void>;
  submitLabel: string;
  /**
   * Whether the CURRENT signed-in user is a SUPER_ADMIN. Only a super admin may
   * grant the ADMIN role, so the option is shown to them alone. This mirrors —
   * but does not replace — the server-side rule (assertMayAssignRole); the
   * backend rejects an ADMIN grant from anyone else regardless of the UI.
   */
  callerIsSuperAdmin: boolean;
}

const NON_PRIVILEGED_ROLES: Array<'MANAGER' | 'EMPLOYEE'> = [
  'MANAGER',
  'EMPLOYEE',
];

export function EmployeeForm({
  mode,
  initial,
  verticals,
  candidateManagers,
  onSubmit,
  submitLabel,
  callerIsSuperAdmin,
}: EmployeeFormProps) {
  const [firstName, setFirstName] = useState(initial?.firstName ?? '');
  const [lastName, setLastName] = useState(initial?.lastName ?? '');
  const [email, setEmail] = useState(initial?.email ?? '');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<EmployeeFormValues['role']>(
    initial?.role ?? 'EMPLOYEE',
  );
  // A SUPER_ADMIN (CEO) has no vertical/manager and their role isn't editable
  // here — we can't create SUPER_ADMINs via this form, only edit an existing
  // one without silently downgrading them.
  const isSuperAdmin = role === 'SUPER_ADMIN';
  // Assignable role options: MANAGER / EMPLOYEE for everyone; ADMIN only when
  // the SIGNED-IN user is a super admin (mirrors the backend grant rule).
  const assignableRoles: Array<'ADMIN' | 'MANAGER' | 'EMPLOYEE'> =
    callerIsSuperAdmin ? ['ADMIN', ...NON_PRIVILEGED_ROLES] : [...NON_PRIVILEGED_ROLES];
  // "Protect admins": a non-super-admin editing an already-privileged account
  // (ADMIN/SUPER_ADMIN) cannot change its role at all — lock the field so it
  // can't be demoted or tampered with. The backend enforces this too.
  const targetInitiallyPrivileged =
    initial?.role === 'ADMIN' || initial?.role === 'SUPER_ADMIN';
  const roleLocked =
    isSuperAdmin || (!callerIsSuperAdmin && targetInitiallyPrivileged);
  const [verticalId, setVerticalId] = useState(initial?.verticalId ?? '');
  const [managerId, setManagerId] = useState(initial?.reportingManagerId ?? '');
  const [designation, setDesignation] = useState(initial?.designation ?? '');
  const [employmentType, setEmploymentType] = useState<EmploymentType | ''>(
    initial?.employmentType ?? '',
  );
  const [workLocation, setWorkLocation] = useState(initial?.workLocation ?? '');
  const [managerSearch, setManagerSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Client-side convenience only: same-vertical managers surface first, but
  // this is not a backend-enforced constraint.
  const managerOptions = useMemo(() => {
    const bySearch = candidateManagers.filter((m) => {
      const haystack = `${m.firstName} ${m.lastName} ${m.email}`.toLowerCase();
      return haystack.includes(managerSearch.toLowerCase());
    });
    return bySearch.sort((a, b) => {
      const aMatch = a.verticalId === verticalId ? 0 : 1;
      const bMatch = b.verticalId === verticalId ? 0 : 1;
      return aMatch - bMatch;
    });
  }, [candidateManagers, managerSearch, verticalId]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    // SUPER_ADMIN is exempt from vertical/manager (matches the backend rule).
    if (!isSuperAdmin) {
      if (!verticalId) {
        setError('Vertical is required');
        return;
      }
      if (!managerId) {
        setError('Reporting manager is required');
        return;
      }
    }

    setSubmitting(true);
    try {
      await onSubmit({
        firstName,
        lastName,
        email,
        ...(mode === 'create' ? { password } : {}),
        role,
        ...(verticalId ? { verticalId } : {}),
        ...(managerId ? { reportingManagerId: managerId } : {}),
        ...(designation.trim() ? { designation: designation.trim() } : {}),
        ...(employmentType ? { employmentType } : {}),
        ...(workLocation.trim() ? { workLocation: workLocation.trim() } : {}),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <Card>
        <CardContent className="space-y-4 p-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="First name" required>
              <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} required />
            </Field>
            <Field label="Last name" required>
              <Input value={lastName} onChange={(e) => setLastName(e.target.value)} required />
            </Field>
          </div>

          <Field label="Email" required>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </Field>

          {mode === 'create' && (
            <Field label="Initial password" hint="Minimum 8 characters">
              <Input
                type="text"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
              />
            </Field>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Role">
              {roleLocked ? (
                // Locked: either the target is a SUPER_ADMIN (never downgraded
                // here) or a non-super-admin is editing an existing privileged
                // account (Admin/Super Admin), whose role only a super admin
                // may change. Shown read-only so its current role is visible.
                <Select value={role} disabled>
                  <option value={role}>{role}</option>
                </Select>
              ) : (
                <Select
                  value={role}
                  onChange={(e) => setRole(e.target.value as Role & typeof role)}
                >
                  {assignableRoles.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </Select>
              )}
            </Field>
            {!isSuperAdmin && (
              <Field label="Vertical" required>
                <Select
                  value={verticalId}
                  onChange={(e) => setVerticalId(e.target.value)}
                  required
                >
                  <option value="">Select a vertical…</option>
                  {verticals.map((v) => (
                    <option key={v.id} value={v.id}>{v.name}</option>
                  ))}
                </Select>
              </Field>
            )}
          </div>

          {!isSuperAdmin && (
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
                    {m.firstName} {m.lastName} ({m.employeeId}, {m.role})
                  </option>
                ))}
              </Select>
            </Field>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Designation">
              <Input
                value={designation}
                onChange={(e) => setDesignation(e.target.value)}
                placeholder="e.g. Senior Design Engineer"
              />
            </Field>
            <Field label="Employment type">
              <Select
                value={employmentType}
                onChange={(e) => setEmploymentType(e.target.value as EmploymentType | '')}
              >
                <option value="">Not set</option>
                {EMPLOYMENT_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </Select>
            </Field>
          </div>

          <Field label="Work location">
            <Input
              value={workLocation}
              onChange={(e) => setWorkLocation(e.target.value)}
              placeholder="e.g. Bengaluru"
            />
          </Field>

          {error && <p className="text-sm font-medium text-destructive">{error}</p>}

          <div className="flex justify-end border-t pt-4">
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Saving…' : submitLabel}
            </Button>
          </div>
        </CardContent>
      </Card>
    </form>
  );
}
