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
import {
  SCard,
  SIGNAL_BTN_OUTLINE,
  SIGNAL_MUTED,
  SignalHeader,
  SignalPage,
} from '../../../../components/ui/signal';
import { cn } from '../../../../lib/utils';

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
      <SignalPage>
        <SignalHeader
          backHref="/admin/employees"
          backLabel="Employees"
          title="Employee created"
        />
        <div className="space-y-4 px-5 pb-7 pt-[18px] lg:px-7">
          <SCard className="max-w-2xl px-5 py-[18px]">
            <p className="text-[13px]">
              <strong className="font-bold">{created.employeeId}</strong> —{' '}
              {created.firstName} {created.lastName} ({created.email})
            </p>
            <p className={cn('mt-2 text-[13px]', SIGNAL_MUTED)}>
              Initial password:{' '}
              <span className="font-semibold tabular-nums text-[#1B1B1B] dark:text-[#EDEDED]">
                {createdPassword}
              </span>
            </p>
            <button
              className={cn('mt-4', SIGNAL_BTN_OUTLINE)}
              onClick={() => router.push('/admin/employees')}
            >
              Back to list
            </button>
          </SCard>
        </div>
      </SignalPage>
    );
  }

  return (
    <SignalPage>
      <SignalHeader
        backHref="/admin/employees"
        backLabel="Employees"
        title="Create Employee"
      />
      <div className="space-y-4 px-5 pb-7 pt-[18px] lg:px-7">
        <div className="max-w-3xl">
          <EmployeeForm
            mode="create"
            verticals={verticals}
            candidateManagers={candidateManagers}
            onSubmit={handleSubmit}
            submitLabel="Create"
            callerIsSuperAdmin={user?.role === 'SUPER_ADMIN'}
          />
        </div>
      </div>
    </SignalPage>
  );
}
