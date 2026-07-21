'use client';

import { useMemo, useState } from 'react';
import { Employee, EmploymentType, Vertical } from '../../../../lib/types';
import { Role } from '../../../../lib/jwt';

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
}

const ASSIGNABLE_ROLES: Array<'ADMIN' | 'MANAGER' | 'EMPLOYEE'> = [
  'ADMIN',
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
  const [verticalId, setVerticalId] = useState(initial?.verticalId ?? '');
  const [managerId, setManagerId] = useState(
    initial?.reportingManagerId ?? '',
  );
  const [designation, setDesignation] = useState(initial?.designation ?? '');
  const [employmentType, setEmploymentType] = useState<EmploymentType | ''>(
    initial?.employmentType ?? '',
  );
  const [workLocation, setWorkLocation] = useState(initial?.workLocation ?? '');
  const [managerSearch, setManagerSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Client-side convenience only: same-vertical managers surface first, but
  // this is not a backend-enforced constraint (an admin could still call the
  // API directly with a cross-vertical manager).
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

    // SUPER_ADMIN is exempt from vertical/manager (matches the backend rule);
    // every other role must have both.
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
        // Omit entirely for a SUPER_ADMIN so the API doesn't get an empty
        // string where it expects a UUID or nothing.
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
    <form onSubmit={handleSubmit} style={{ maxWidth: 480 }}>
      <Field label="First name">
        <input
          value={firstName}
          onChange={(e) => setFirstName(e.target.value)}
          required
          style={inputStyle}
        />
      </Field>
      <Field label="Last name">
        <input
          value={lastName}
          onChange={(e) => setLastName(e.target.value)}
          required
          style={inputStyle}
        />
      </Field>
      <Field label="Email">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          style={inputStyle}
        />
      </Field>
      {mode === 'create' && (
        <Field label="Initial password">
          <input
            type="text"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            style={inputStyle}
          />
        </Field>
      )}
      <Field label="Role">
        {isSuperAdmin ? (
          // The CEO/SUPER_ADMIN role can't be reassigned from this form —
          // showing it disabled prevents a silent downgrade to ADMIN.
          <select value="SUPER_ADMIN" disabled style={inputStyle}>
            <option value="SUPER_ADMIN">SUPER_ADMIN</option>
          </select>
        ) : (
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as Role & typeof role)}
            style={inputStyle}
          >
            {ASSIGNABLE_ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        )}
      </Field>
      {!isSuperAdmin && (
        <>
          <Field label="Vertical">
            <select
              value={verticalId}
              onChange={(e) => setVerticalId(e.target.value)}
              required
              style={inputStyle}
            >
              <option value="">Select a vertical…</option>
              {verticals.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Reporting manager">
            <input
              placeholder="Filter by name or email"
              value={managerSearch}
              onChange={(e) => setManagerSearch(e.target.value)}
              style={{ ...inputStyle, marginBottom: 6 }}
            />
            <select
              value={managerId}
              onChange={(e) => setManagerId(e.target.value)}
              required
              style={inputStyle}
            >
              <option value="">Select a manager…</option>
              {managerOptions.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.firstName} {m.lastName} ({m.employeeId}, {m.role})
                </option>
              ))}
            </select>
          </Field>
        </>
      )}

      <Field label="Designation">
        <input
          value={designation}
          onChange={(e) => setDesignation(e.target.value)}
          placeholder="e.g. Senior Design Engineer"
          style={inputStyle}
        />
      </Field>
      <Field label="Employment type">
        <select
          value={employmentType}
          onChange={(e) =>
            setEmploymentType(e.target.value as EmploymentType | '')
          }
          style={inputStyle}
        >
          <option value="">Not set</option>
          {EMPLOYMENT_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Work location">
        <input
          value={workLocation}
          onChange={(e) => setWorkLocation(e.target.value)}
          placeholder="e.g. Bengaluru"
          style={inputStyle}
        />
      </Field>

      {error && <p style={{ color: 'crimson' }}>{error}</p>}

      <button type="submit" disabled={submitting} style={{ padding: 8 }}>
        {submitting ? 'Saving…' : submitLabel}
      </button>
    </form>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{ display: 'block', marginBottom: 4 }}>{label}</label>
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: 8,
  boxSizing: 'border-box',
};
