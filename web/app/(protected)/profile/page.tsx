'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '../../lib/auth-context';
import { apiFetch } from '../../lib/api';
import { Employee, Vertical } from '../../lib/types';

export default function ProfilePage() {
  const { user, loading: authLoading } = useAuth();
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [verticalName, setVerticalName] = useState<string | null>(null);
  const [managerName, setManagerName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading || !user) return;

    apiFetch<Employee>(`/employees/${user.sub}`)
      .then(async (me) => {
        setEmployee(me);

        if (me.verticalId) {
          const verticals = await apiFetch<Vertical[]>('/verticals');
          setVerticalName(
            verticals.find((v) => v.id === me.verticalId)?.name ?? null,
          );
        }

        if (me.reportingManagerId) {
          const manager = await apiFetch<Employee>(
            `/employees/${me.reportingManagerId}`,
          );
          setManagerName(`${manager.firstName} ${manager.lastName}`);
        }
      })
      .finally(() => setLoading(false));
  }, [authLoading, user]);

  if (authLoading || loading || !employee) return <p>Loading…</p>;

  return (
    <div>
      <h1>My Profile</h1>
      <dl>
        <dt>Name</dt>
        <dd>
          {employee.firstName} {employee.lastName}
        </dd>
        <dt>Employee ID</dt>
        <dd>{employee.employeeId}</dd>
        <dt>Vertical</dt>
        <dd>{verticalName ?? '—'}</dd>
        <dt>Manager</dt>
        <dd>{managerName ?? '—'}</dd>
        <dt>Role</dt>
        <dd>{employee.role}</dd>
      </dl>
    </div>
  );
}
