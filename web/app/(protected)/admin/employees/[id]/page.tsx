'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { apiFetch, ApiError } from '../../../../lib/api';
import { Employee, PaginatedResult, Vertical } from '../../../../lib/types';
import {
  EmployeeForm,
  EmployeeFormValues,
} from '../_components/employee-form';
import { Badge } from '../../../../components/ui/badge';
import { Button } from '../../../../components/ui/button';
import { Card, CardContent } from '../../../../components/ui/card';
import { useToast } from '../../../../components/ui/toaster';
import { useConfirm } from '../../../../components/ui/confirm';

export default function EditEmployeePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [verticals, setVerticals] = useState<Vertical[]>([]);
  const [candidateManagers, setCandidateManagers] = useState<Employee[]>([]);
  const [currentSalesHead, setCurrentSalesHead] = useState<Employee | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [designating, setDesignating] = useState(false);

  const load = useCallback(async () => {
    const [employeeRes, verticalsRes, employeesRes] = await Promise.all([
      apiFetch<Employee>(`/employees/${id}`),
      apiFetch<Vertical[]>('/verticals'),
      apiFetch<PaginatedResult<Employee>>('/employees?page=1&limit=100'),
    ]);
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
    setCurrentSalesHead(
      employeesRes.items.find((e) => e.isSalesHead) ?? null,
    );
  }, [id]);

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, [load]);

  async function handleSubmit(values: EmployeeFormValues) {
    await apiFetch<Employee>(`/employees/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(values),
    });
    router.push('/admin/employees');
  }

  async function designateSalesHead() {
    if (!employee) return;
    // Reflect the atomic backend swap as an explicit, understood action.
    const replacing =
      currentSalesHead && currentSalesHead.id !== employee.id
        ? `This will remove ${currentSalesHead.firstName} ${currentSalesHead.lastName}'s Sales Head designation and assign it to ${employee.firstName} ${employee.lastName}. Continue?`
        : `Designate ${employee.firstName} ${employee.lastName} as the Sales Head?`;
    const ok = await confirm({
      title: 'Designate Sales Head',
      description: replacing,
      confirmLabel: 'Designate',
    });
    if (!ok) return;
    setDesignating(true);
    try {
      await apiFetch(`/employees/${employee.id}/designate-sales-head`, {
        method: 'PATCH',
      });
      toast.success('Sales Head designated');
      await load();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : 'Failed to designate Sales Head',
      );
    } finally {
      setDesignating(false);
    }
  }

  if (loading) return <p>Loading…</p>;
  if (!employee) return <p>Employee not found.</p>;

  const salesVerticalId = verticals.find((v) => v.code === 'SALES')?.id;
  const isSalesVertical =
    !!salesVerticalId && employee.verticalId === salesVerticalId;

  return (
    <div>
      <h1 className="flex items-center gap-2">
        Edit {employee.firstName} {employee.lastName}
        {employee.isSalesHead && <Badge variant="info">Sales Head</Badge>}
      </h1>

      {/* Sales Head designation — only meaningful for Sales-vertical staff. */}
      {isSalesVertical && (
        <Card className="my-4 max-w-xl">
          <CardContent className="flex items-center justify-between gap-4 p-4">
            <div className="text-sm">
              <div className="font-medium">Sales Head designation</div>
              <div className="text-muted-foreground">
                {employee.isSalesHead
                  ? 'This employee is the current Sales Head.'
                  : currentSalesHead
                    ? `Current Sales Head: ${currentSalesHead.firstName} ${currentSalesHead.lastName}`
                    : 'No Sales Head is currently designated.'}
              </div>
            </div>
            {!employee.isSalesHead && (
              <Button
                variant="outline"
                disabled={designating}
                onClick={designateSalesHead}
              >
                Designate as Sales Head
              </Button>
            )}
          </CardContent>
        </Card>
      )}

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
