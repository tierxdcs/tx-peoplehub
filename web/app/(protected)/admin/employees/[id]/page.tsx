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
import { useAuth } from '../../../../lib/auth-context';

export default function EditEmployeePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const { user } = useAuth();
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';
  // Designations are ADMIN/SUPER_ADMIN actions (mirrors the backend @Roles).
  const canDesignate = user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN';
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

  /**
   * Project Manager is a multi-holder capability (like Scrum Master, unlike the
   * single-holder Sales Head) — designate/revoke is a simple flag flip with no
   * swap. Backend restricts the target to MANAGER-or-above; we only surface the
   * control for those roles so it never just 403s.
   */
  async function setProjectManager(next: boolean) {
    if (!employee) return;
    const ok = await confirm({
      title: next ? 'Designate Project Manager' : 'Revoke Project Manager',
      description: next
        ? `Designate ${employee.firstName} ${employee.lastName} as a Project Manager? They’ll be able to run project kickoffs.`
        : `Revoke ${employee.firstName} ${employee.lastName}’s Project Manager designation?`,
      confirmLabel: next ? 'Designate' : 'Revoke',
      destructive: !next,
    });
    if (!ok) return;
    setDesignating(true);
    try {
      await apiFetch(
        `/employees/${employee.id}/${next ? 'designate' : 'revoke'}-project-manager`,
        { method: 'PATCH' },
      );
      toast.success(
        next ? 'Project Manager designated' : 'Project Manager revoked',
      );
      await load();
    } catch (err) {
      toast.error(
        err instanceof ApiError
          ? err.message
          : 'Failed to update Project Manager designation',
      );
    } finally {
      setDesignating(false);
    }
  }

  async function setInternalAuditor(next: boolean) {
    if (!employee) return;
    const ok = await confirm({
      title: next ? 'Designate Internal Auditor' : 'Revoke Internal Auditor',
      description: next
        ? `Designate ${employee.firstName} ${employee.lastName} as an Internal Auditor? They’ll be able to conduct and finalize vendor audits.`
        : `Revoke ${employee.firstName} ${employee.lastName}’s Internal Auditor designation?`,
      confirmLabel: next ? 'Designate' : 'Revoke',
      destructive: !next,
    });
    if (!ok) return;
    setDesignating(true);
    try {
      await apiFetch(
        `/employees/${employee.id}/${next ? 'designate' : 'revoke'}-internal-auditor`,
        { method: 'PATCH' },
      );
      toast.success(
        next ? 'Internal Auditor designated' : 'Internal Auditor revoked',
      );
      await load();
    } catch (err) {
      toast.error(
        err instanceof ApiError
          ? err.message
          : 'Failed to update Internal Auditor designation',
      );
    } finally {
      setDesignating(false);
    }
  }

  async function setRdHead(next: boolean) {
    if (!employee) return;
    const ok = await confirm({
      title: next ? 'Designate R&D Head' : 'Revoke R&D Head',
      description: next
        ? `Designate ${employee.firstName} ${employee.lastName} as an R&D Head? They’ll be able to approve/reject BOMs and manage Item Master technical data. (They must be in the R&D vertical.)`
        : `Revoke ${employee.firstName} ${employee.lastName}’s R&D Head designation?`,
      confirmLabel: next ? 'Designate' : 'Revoke',
      destructive: !next,
    });
    if (!ok) return;
    setDesignating(true);
    try {
      await apiFetch(
        `/employees/${employee.id}/${next ? 'designate' : 'revoke'}-rd-head`,
        { method: 'PATCH' },
      );
      toast.success(next ? 'R&D Head designated' : 'R&D Head revoked');
      await load();
    } catch (err) {
      toast.error(
        err instanceof ApiError
          ? err.message
          : 'Failed to update R&D Head designation',
      );
    } finally {
      setDesignating(false);
    }
  }

  async function handleDelete() {
    if (!employee) return;
    const ok = await confirm({
      title: `Permanently delete ${employee.firstName} ${employee.lastName}?`,
      description:
        'This removes the account entirely and cannot be undone. It is refused if they still own any reports or business records — deactivate instead in that case. Use this only for mistaken or duplicate accounts.',
      confirmLabel: 'Delete permanently',
      destructive: true,
    });
    if (!ok) return;
    try {
      await apiFetch(`/employees/${employee.id}`, { method: 'DELETE' });
      toast.success('Employee deleted.');
      router.push('/admin/employees');
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : 'Failed to delete employee',
      );
    }
  }

  if (loading) return <p>Loading…</p>;
  if (!employee) return <p>Employee not found.</p>;

  const salesVerticalId = verticals.find((v) => v.code === 'SALES')?.id;
  const isSalesVertical =
    !!salesVerticalId && employee.verticalId === salesVerticalId;
  const rndVerticalId = verticals.find((v) => v.code === 'RND')?.id;
  const isRndVertical =
    !!rndVerticalId && employee.verticalId === rndVerticalId;
  // PM & Internal Auditor eligibility both mirror the backend: MANAGER or
  // above, any vertical.
  const managerOrAbove =
    employee.role === 'MANAGER' ||
    employee.role === 'ADMIN' ||
    employee.role === 'SUPER_ADMIN';

  return (
    <div>
      <h1 className="flex items-center gap-2">
        Edit {employee.firstName} {employee.lastName}
        {employee.isSalesHead && <Badge variant="info">Sales Head</Badge>}
        {employee.isProjectManager && (
          <Badge variant="info">Project Manager</Badge>
        )}
        {employee.isInternalAuditor && (
          <Badge variant="info">Internal Auditor</Badge>
        )}
        {employee.isRdHead && <Badge variant="info">R&D Head</Badge>}
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

      {/* Project Manager designation — role MANAGER or above, any vertical.
          Multi-holder: designate/revoke is a plain flag flip (no swap). */}
      {managerOrAbove && (
        <Card className="my-4 max-w-xl">
          <CardContent className="flex items-center justify-between gap-4 p-4">
            <div className="text-sm">
              <div className="font-medium">Project Manager designation</div>
              <div className="text-muted-foreground">
                {employee.isProjectManager
                  ? 'This employee is a Project Manager and can run project kickoffs.'
                  : 'Not a Project Manager. Designate to allow running project kickoffs.'}
              </div>
            </div>
            {canDesignate && (
              <Button
                variant={employee.isProjectManager ? 'destructive' : 'outline'}
                disabled={designating}
                onClick={() => setProjectManager(!employee.isProjectManager)}
              >
                {employee.isProjectManager
                  ? 'Revoke Project Manager'
                  : 'Designate as Project Manager'}
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* Internal Auditor designation — role MANAGER or above, any vertical.
          Multi-holder flag flip; conducts/finalizes vendor audits. */}
      {managerOrAbove && (
        <Card className="my-4 max-w-xl">
          <CardContent className="flex items-center justify-between gap-4 p-4">
            <div className="text-sm">
              <div className="font-medium">Internal Auditor designation</div>
              <div className="text-muted-foreground">
                {employee.isInternalAuditor
                  ? 'This employee is an Internal Auditor and can conduct vendor audits.'
                  : 'Not an Internal Auditor. Designate to allow conducting vendor audits.'}
              </div>
            </div>
            {canDesignate && (
              <Button
                variant={employee.isInternalAuditor ? 'destructive' : 'outline'}
                disabled={designating}
                onClick={() => setInternalAuditor(!employee.isInternalAuditor)}
              >
                {employee.isInternalAuditor
                  ? 'Revoke Internal Auditor'
                  : 'Designate as Internal Auditor'}
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* R&D Head designation — R&D-vertical only (backend enforces this too).
          Multi-holder; grants technical BOM approval + Item Master authority.
          Shown for any R&D-vertical employee, or for an existing holder (so it
          can always be revoked even if their vertical later changed). */}
      {(isRndVertical || employee.isRdHead) && (
        <Card className="my-4 max-w-xl">
          <CardContent className="flex items-center justify-between gap-4 p-4">
            <div className="text-sm">
              <div className="font-medium">R&D Head designation</div>
              <div className="text-muted-foreground">
                {employee.isRdHead
                  ? 'This employee is an R&D Head and can approve/reject BOMs and manage Item Master data.'
                  : 'Not an R&D Head. Designate to grant technical BOM approval authority.'}
              </div>
            </div>
            {canDesignate && (
              <Button
                variant={employee.isRdHead ? 'destructive' : 'outline'}
                disabled={designating || (!employee.isRdHead && !isRndVertical)}
                onClick={() => setRdHead(!employee.isRdHead)}
              >
                {employee.isRdHead ? 'Revoke R&D Head' : 'Designate as R&D Head'}
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
          // Pass the true role (including SUPER_ADMIN) so the form can lock it
          // rather than silently downgrading the CEO to ADMIN on save.
          role: employee.role ?? 'EMPLOYEE',
          verticalId: employee.verticalId ?? '',
          reportingManagerId: employee.reportingManagerId ?? '',
        }}
        verticals={verticals}
        candidateManagers={candidateManagers}
        onSubmit={handleSubmit}
        submitLabel="Save changes"
      />

      {/* Permanent delete — SUPER_ADMIN only. The backend refuses if the
          employee still owns reports or business records. */}
      {isSuperAdmin && (
        <Card className="my-4 max-w-xl border-destructive/40">
          <CardContent className="flex items-center justify-between gap-4 p-4">
            <div className="text-sm">
              <div className="font-medium">Delete permanently</div>
              <div className="text-muted-foreground">
                Removes the account entirely. Refused if they still own reports
                or business records — deactivate instead in that case.
              </div>
            </div>
            <Button variant="destructive" onClick={handleDelete}>
              Delete
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
