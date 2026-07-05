'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { apiFetch } from '../../../../lib/api';
import { Employee, PaginatedResult, Vertical } from '../../../../lib/types';
import {
  EmployeeForm,
  EmployeeFormValues,
} from '../_components/employee-form';

export default function EditEmployeePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [verticals, setVerticals] = useState<Vertical[]>([]);
  const [candidateManagers, setCandidateManagers] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      apiFetch<Employee>(`/employees/${id}`),
      apiFetch<Vertical[]>('/verticals'),
      apiFetch<PaginatedResult<Employee>>('/employees?page=1&limit=100'),
    ])
      .then(([employeeRes, verticalsRes, employeesRes]) => {
        setEmployee(employeeRes);
        setVerticals(verticalsRes);
        setCandidateManagers(
          employeesRes.items.filter(
            (e) =>
              e.status === 'ACTIVE' &&
              e.id !== employeeRes.id &&
              (e.role === 'MANAGER' || e.role === 'SUPER_ADMIN'),
          ),
        );
      })
      .finally(() => setLoading(false));
  }, [id]);

  async function handleSubmit(values: EmployeeFormValues) {
    await apiFetch<Employee>(`/employees/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(values),
    });
    router.push('/admin/employees');
  }

  if (loading) return <p>Loading…</p>;
  if (!employee) return <p>Employee not found.</p>;

  return (
    <div>
      <h1>
        Edit {employee.firstName} {employee.lastName}
      </h1>
      <EmployeeForm
        mode="edit"
        initial={{
          firstName: employee.firstName,
          lastName: employee.lastName,
          email: employee.email,
          role: employee.role as 'ADMIN' | 'MANAGER' | 'EMPLOYEE',
          verticalId: employee.verticalId ?? '',
          reportingManagerId: employee.reportingManagerId ?? '',
        }}
        verticals={verticals}
        candidateManagers={candidateManagers}
        onSubmit={handleSubmit}
        submitLabel="Save changes"
      />
    </div>
  );
}
