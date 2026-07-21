'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '../../../../lib/api';
import { useAuth } from '../../../../lib/auth-context';
import { Employee, PaginatedResult, Vertical } from '../../../../lib/types';
import {
  EmployeeForm,
  EmployeeFormValues,
} from '../_components/employee-form';

export default function NewEmployeePage() {
  const router = useRouter();
  const { user } = useAuth();
  const [verticals, setVerticals] = useState<Vertical[]>([]);
  const [candidateManagers, setCandidateManagers] = useState<Employee[]>([]);
  const [created, setCreated] = useState<Employee | null>(null);
  const [createdPassword, setCreatedPassword] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      apiFetch<Vertical[]>('/verticals'),
      apiFetch<PaginatedResult<Employee>>('/employees?page=1&limit=100'),
    ]).then(([verticalsRes, employeesRes]) => {
      setVerticals(verticalsRes);
      setCandidateManagers(
        employeesRes.items.filter(
          (e) =>
            e.status === 'ACTIVE' &&
            (e.role === 'MANAGER' || e.role === 'SUPER_ADMIN'),
        ),
      );
    });
  }, []);

  async function handleSubmit(values: EmployeeFormValues) {
    const employee = await apiFetch<Employee>('/employees', {
      method: 'POST',
      body: JSON.stringify(values),
    });
    setCreated(employee);
    setCreatedPassword(values.password ?? null);
  }

  if (created) {
    return (
      <div>
        <h1>Employee created</h1>
        <p>
          <strong>{created.employeeId}</strong> — {created.firstName}{' '}
          {created.lastName} ({created.email})
        </p>
        <p>
          Initial password: <code>{createdPassword}</code>
        </p>
        <button onClick={() => router.push('/admin/employees')}>
          Back to list
        </button>
      </div>
    );
  }

  return (
    <div>
      <h1>Create Employee</h1>
      <EmployeeForm
        mode="create"
        verticals={verticals}
        candidateManagers={candidateManagers}
        onSubmit={handleSubmit}
        submitLabel="Create"
        callerIsSuperAdmin={user?.role === 'SUPER_ADMIN'}
      />
    </div>
  );
}
