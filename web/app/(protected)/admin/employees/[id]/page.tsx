'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { apiFetch, ApiError } from '../../../../lib/api';
import { Employee, PaginatedResult, Vertical } from '../../../../lib/types';
import { EmployeeForm, EmployeeFormValues } from '../_components/employee-form';
import { Badge } from '../../../../components/ui/badge';
import { Button } from '../../../../components/ui/button';
import {
  SCard,
  SCardTitle,
  SIGNAL_BTN_OUTLINE,
  SIGNAL_BTN_PRIMARY,
  SIGNAL_DIALOG,
  SIGNAL_DIALOG_TITLE,
  SIGNAL_EYEBROW,
  SIGNAL_HAIRLINE,
  SIGNAL_MUTED,
  SignalHeader,
  SignalPage,
} from '../../../../components/ui/signal';
import { cn } from '../../../../lib/utils';
import { Skeleton } from '../../../../components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '../../../../components/ui/dialog';
import { useToast } from '../../../../components/ui/toaster';
import { useConfirm } from '../../../../components/ui/confirm';
import { useAuth } from '../../../../lib/auth-context';
import { EmployeePhotoField } from '../../../../components/ui/employee-photo-field';
import {
  getEmployeePhotoUrl,
  removeEmployeePhoto,
  setEmployeePhoto,
} from '../../../../lib/employee-photo';
import { ProvisioningChecklist } from '../../../../components/provisioning/provisioning-checklist';

export default function EditEmployeePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  // Where to return after save/delete/back — the page that linked here (e.g.
  // the HR roster) via ?from=, defaulting to the admin employees list. Only
  // internal absolute paths are honoured, so ?from can't redirect off-site.
  const fromParam = searchParams.get('from');
  const returnTo =
    fromParam && fromParam.startsWith('/') ? fromParam : '/admin/employees';
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
  // The generated temporary password from a force-reset — held in state ONLY to
  // show once in the dialog below; never persisted or logged.
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  // Signed URL for the current photo (null while loading or if none).
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);

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
    setCurrentSalesHead(employeesRes.items.find((e) => e.isSalesHead) ?? null);
    // Photo signed URL is fetched separately (short-lived, on-demand). A
    // failure here shouldn't block the rest of the page.
    if (employeeRes.photoStorageKey) {
      try {
        const res = await getEmployeePhotoUrl(employeeRes.id);
        setPhotoUrl(res.url);
      } catch {
        setPhotoUrl(null);
      }
    } else {
      setPhotoUrl(null);
    }
  }, [id]);

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, [load]);

  async function handleSubmit(values: EmployeeFormValues) {
    await apiFetch<Employee>(`/employees/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(values),
    });
    router.push(returnTo);
  }

  // Photo: the field uploads the bytes to R2 and hands back a storageKey; we
  // then persist it (or clear it) and reload the signed preview URL.
  async function handlePhotoUploaded(storageKey: string) {
    if (!employee) return;
    try {
      await setEmployeePhoto(employee.id, storageKey);
      toast.success('Photo updated');
      await load();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : 'Failed to save photo',
      );
    }
  }

  async function handlePhotoRemove() {
    if (!employee) return;
    try {
      await removeEmployeePhoto(employee.id);
      toast.success('Photo removed');
      await load();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : 'Failed to remove photo',
      );
    }
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
        err instanceof ApiError
          ? err.message
          : 'Failed to designate Sales Head',
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

  async function setQcInspector(next: boolean) {
    if (!employee) return;
    const ok = await confirm({
      title: next ? 'Designate QC Inspector' : 'Revoke QC Inspector',
      description: next
        ? `Designate ${employee.firstName} ${employee.lastName} as a QC Inspector? They’ll be able to inspect incoming goods and finalize the QC gate on Goods Receipt Notes.`
        : `Revoke ${employee.firstName} ${employee.lastName}’s QC Inspector designation?`,
      confirmLabel: next ? 'Designate' : 'Revoke',
      destructive: !next,
    });
    if (!ok) return;
    setDesignating(true);
    try {
      await apiFetch(
        `/employees/${employee.id}/${next ? 'designate' : 'revoke'}-qc-inspector`,
        { method: 'PATCH' },
      );
      toast.success(next ? 'QC Inspector designated' : 'QC Inspector revoked');
      await load();
    } catch (err) {
      toast.error(
        err instanceof ApiError
          ? err.message
          : 'Failed to update QC Inspector designation',
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

  async function setAccountsHead(next: boolean) {
    if (!employee) return;
    const ok = await confirm({
      title: next
        ? 'Designate Finance/Accounts Head'
        : 'Revoke Finance/Accounts Head',
      description: next
        ? `Designate ${employee.firstName} ${employee.lastName} as the sole Finance/Accounts Head? Any existing holder will be replaced.`
        : `Revoke ${employee.firstName} ${employee.lastName}’s Finance/Accounts Head designation? Finance approvals will stop until a new head is assigned.`,
      confirmLabel: next ? 'Designate' : 'Revoke',
      destructive: !next,
    });
    if (!ok) return;
    setDesignating(true);
    try {
      await apiFetch(
        `/employees/${employee.id}/${next ? 'designate' : 'revoke'}-accounts-head`,
        { method: 'PATCH' },
      );
      toast.success(
        next
          ? 'Finance/Accounts Head designated'
          : 'Finance/Accounts Head revoked',
      );
      await load();
    } catch (err) {
      toast.error(
        err instanceof ApiError
          ? err.message
          : 'Failed to update Finance/Accounts Head',
      );
    } finally {
      setDesignating(false);
    }
  }

  /**
   * Executive Dashboards access — a discretionary CEO grant, not a designation
   * tied to a vertical, title or seniority. Multi-holder (no swap), SuperAdmin
   * only, and it lets the holder see company-wide cost and margin data, so the
   * confirmation says so out loud.
   */
  async function setExecutiveDashboardAccess(next: boolean) {
    if (!employee) return;
    const ok = await confirm({
      title: next
        ? 'Grant Executive Dashboards access'
        : 'Revoke Executive Dashboards access',
      description: next
        ? `Give ${employee.firstName} ${employee.lastName} access to the Executive Dashboards section? They will see company-wide sales, cost and margin figures regardless of their vertical.`
        : `Revoke ${employee.firstName} ${employee.lastName}’s Executive Dashboards access? The section will disappear from their navigation immediately.`,
      confirmLabel: next ? 'Grant access' : 'Revoke access',
      destructive: !next,
    });
    if (!ok) return;
    setDesignating(true);
    try {
      await apiFetch(
        `/employees/${employee.id}/${next ? 'grant' : 'revoke'}-executive-dashboard-access`,
        { method: 'PATCH' },
      );
      toast.success(
        next
          ? 'Executive Dashboards access granted'
          : 'Executive Dashboards access revoked',
      );
      await load();
    } catch (err) {
      toast.error(
        err instanceof ApiError
          ? err.message
          : 'Failed to update Executive Dashboards access',
      );
    } finally {
      setDesignating(false);
    }
  }

  async function setQmsHead(next: boolean) {
    if (!employee) return;
    const ok = await confirm({
      title: next ? 'Designate QMS Head' : 'Revoke QMS Head',
      description: next
        ? `Designate ${employee.firstName} ${employee.lastName} as the sole QMS approver? Any existing holder will be replaced.`
        : 'QMS approvals will stop until a new head is assigned.',
      confirmLabel: next ? 'Designate' : 'Revoke',
      destructive: !next,
    });
    if (!ok) return;
    setDesignating(true);
    try {
      await apiFetch(
        `/employees/${employee.id}/${next ? 'designate' : 'revoke'}-qms-head`,
        { method: 'PATCH' },
      );
      toast.success(next ? 'QMS Head designated' : 'QMS Head revoked');
      await load();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : 'Failed to update QMS Head',
      );
    } finally {
      setDesignating(false);
    }
  }

  async function setDesignHead(next: boolean) {
    if (!employee) return;
    const ok = await confirm({
      title: next ? 'Designate Design Head' : 'Revoke Design Head',
      description: next
        ? `Designate ${employee.firstName} ${employee.lastName} as the sole design release authority? Any existing holder will be replaced.`
        : 'Design releases will stop until a new Design Head is assigned.',
      confirmLabel: next ? 'Designate' : 'Revoke',
      destructive: !next,
    });
    if (!ok) return;
    setDesignating(true);
    try {
      await apiFetch(
        `/employees/${employee.id}/${next ? 'designate' : 'revoke'}-design-head`,
        { method: 'PATCH' },
      );
      toast.success(next ? 'Design Head designated' : 'Design Head revoked');
      await load();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : 'Failed to update Design Head',
      );
    } finally {
      setDesignating(false);
    }
  }

  async function setProductionHead(next: boolean) {
    if (!employee) return;
    const ok = await confirm({
      title: next ? 'Designate Production Head' : 'Revoke Production Head',
      description: next
        ? `Designate ${employee.firstName} ${employee.lastName} as a Production Head? They’ll be able to review PLM designs, assign tracker owners, and advance production handoffs.`
        : `Revoke ${employee.firstName} ${employee.lastName}’s Production Head designation?`,
      confirmLabel: next ? 'Designate' : 'Revoke',
      destructive: !next,
    });
    if (!ok) return;
    setDesignating(true);
    try {
      await apiFetch(
        `/employees/${employee.id}/${next ? 'designate' : 'revoke'}-production-head`,
        { method: 'PATCH' },
      );
      toast.success(
        next ? 'Production Head designated' : 'Production Head revoked',
      );
      await load();
    } catch (err) {
      toast.error(
        err instanceof ApiError
          ? err.message
          : 'Failed to update Production Head designation',
      );
    } finally {
      setDesignating(false);
    }
  }

  async function setScmHead(next: boolean) {
    if (!employee) return;
    const ok = await confirm({
      title: next ? 'Designate SCM Head' : 'Revoke SCM Head',
      description: next
        ? `Designate ${employee.firstName} ${employee.lastName} as the sole SCM Head and SCM vertical owner? Any existing SCM Head will be replaced.`
        : 'This will also clear this employee as the SCM vertical owner. Assign a replacement to restore SCM owner-based routing.',
      confirmLabel: next ? 'Designate' : 'Revoke',
      destructive: !next,
    });
    if (!ok) return;
    setDesignating(true);
    try {
      await apiFetch(
        `/employees/${employee.id}/${next ? 'designate' : 'revoke'}-scm-head`,
        { method: 'PATCH' },
      );
      toast.success(next ? 'SCM Head designated' : 'SCM Head revoked');
      await load();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : 'Failed to update SCM Head',
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
      router.push(returnTo);
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : 'Failed to delete employee',
      );
    }
  }

  /**
   * Offboard = soft-delete (deactivate). Reversible, and unlike hard-delete it
   * works even when the employee owns reports/records — the right default for
   * someone leaving. Reactivate restores their login with the same
   * role/vertical/manager.
   */
  async function handleToggleActive() {
    if (!employee) return;
    const deactivating = employee.status === 'ACTIVE';
    const ok = await confirm(
      deactivating
        ? {
            title: `Offboard ${employee.firstName} ${employee.lastName}?`,
            description:
              'Deactivates their account and revokes login immediately. Their records are preserved and this can be reversed by reactivating. Use this when someone leaves the company.',
            confirmLabel: 'Offboard',
            destructive: true,
          }
        : {
            title: `Reactivate ${employee.firstName} ${employee.lastName}?`,
            description:
              'Restores their login with the existing role, vertical and manager. This is not a re-hire.',
            confirmLabel: 'Reactivate',
          },
    );
    if (!ok) return;
    try {
      await apiFetch(
        `/employees/${employee.id}/${deactivating ? 'deactivate' : 'reactivate'}`,
        { method: 'PATCH' },
      );
      toast.success(
        deactivating ? 'Employee offboarded.' : 'Employee reactivated.',
      );
      await load();
    } catch (err) {
      toast.error(
        err instanceof ApiError
          ? err.message
          : `Failed to ${deactivating ? 'offboard' : 'reactivate'} employee`,
      );
    }
  }

  async function handleResetPassword() {
    if (!employee) return;
    const ok = await confirm({
      title: `Reset ${employee.firstName} ${employee.lastName}’s password?`,
      description:
        'Generates a one-time temporary password (shown to you once), forces them to set a new password on next login, and signs them out of all current sessions. Use when a user is locked out or their credentials may be compromised.',
      confirmLabel: 'Reset password',
      destructive: true,
    });
    if (!ok) return;
    setResetting(true);
    try {
      const res = await apiFetch<{ temporaryPassword: string }>(
        `/employees/${employee.id}/reset-password`,
        { method: 'PATCH' },
      );
      setTempPassword(res.temporaryPassword);
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : 'Failed to reset password',
      );
    } finally {
      setResetting(false);
    }
  }

  if (loading) {
    return (
      <SignalPage>
        <div className="px-5 py-[18px] lg:px-7">
          <Skeleton className="mb-4 h-6 w-24" />
          <Skeleton className="mb-6 h-9 w-64" />
          <Skeleton className="h-64 w-full max-w-2xl" />
        </div>
      </SignalPage>
    );
  }
  if (!employee) {
    return (
      <SignalPage>
        <SignalHeader
          backHref={returnTo}
          backLabel="Employees"
          title="Employee"
        />
        <div className="px-5 pb-7 pt-[18px] lg:px-7">
          <p className="text-[13px] text-destructive">Employee not found.</p>
        </div>
      </SignalPage>
    );
  }

  const salesVerticalId = verticals.find((v) => v.code === 'SALES')?.id;
  const isSalesVertical =
    !!salesVerticalId && employee.verticalId === salesVerticalId;
  const rndVerticalId = verticals.find((v) => v.code === 'RND')?.id;
  const isRndVertical =
    !!rndVerticalId && employee.verticalId === rndVerticalId;
  const scmVerticalId = verticals.find((v) => v.code === 'SCM')?.id;
  const isScmVertical =
    !!scmVerticalId && employee.verticalId === scmVerticalId;
  // R&D Head eligibility mirrors the backend: R&D-vertical employees, or a
  // SUPER_ADMIN (exempt from the vertical requirement — company-wide holder).
  const rdHeadEligible = isRndVertical || employee.role === 'SUPER_ADMIN';
  // PM & Internal Auditor eligibility both mirror the backend: MANAGER or
  // above, any vertical.
  const managerOrAbove =
    employee.role === 'MANAGER' ||
    employee.role === 'ADMIN' ||
    employee.role === 'SUPER_ADMIN';

  const hasAnyDesignationCard =
    isSalesVertical ||
    managerOrAbove ||
    canDesignate ||
    employee.isRdHead ||
    isSuperAdmin ||
    employee.isAccountsHead ||
    employee.isQmsHead ||
    employee.isDesignHead ||
    employee.isProductionHead ||
    employee.isScmHead ||
    employee.hasExecutiveDashboardAccess;

  return (
    <SignalPage>
      <SignalHeader
        backHref={returnTo}
        backLabel="Employees"
        title={`${employee.firstName} ${employee.lastName}`}
        description={
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="tabular-nums">{employee.employeeId}</span>
            {employee.isSalesHead && <Badge variant="info">Sales Head</Badge>}
            {employee.isProjectManager && (
              <Badge variant="info">Project Manager</Badge>
            )}
            {employee.isInternalAuditor && (
              <Badge variant="info">Internal Auditor</Badge>
            )}
            {employee.isQcInspector && (
              <Badge variant="info">QC Inspector</Badge>
            )}
            {employee.isRdHead && <Badge variant="info">R&D Head</Badge>}
            {employee.isAccountsHead && (
              <Badge variant="info">Finance/Accounts Head</Badge>
            )}
            {employee.isQmsHead && <Badge variant="info">QMS Head</Badge>}
            {employee.isDesignHead && <Badge variant="info">Design Head</Badge>}
            {employee.isProductionHead && (
              <Badge variant="info">Production Head</Badge>
            )}
            {employee.isScmHead && <Badge variant="info">SCM Head</Badge>}
            {employee.hasExecutiveDashboardAccess && (
              <Badge variant="info">Executive Dashboards</Badge>
            )}
          </span>
        }
      />
      <div className="px-5 pb-7 pt-[18px] lg:px-7">
        <div className="max-w-2xl space-y-3.5">
          {/* Core details first — the primary reason to open this page. */}
          <h2 className={SIGNAL_EYEBROW}>Details</h2>
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
              designation: employee.designation ?? '',
              employmentType: employee.employmentType ?? undefined,
              workLocation: employee.workLocation ?? '',
              territory: employee.territory ?? '',
            }}
            verticals={verticals}
            candidateManagers={candidateManagers}
            onSubmit={handleSubmit}
            submitLabel="Save changes"
            callerIsSuperAdmin={isSuperAdmin}
          />

          {/* Photo — used for ID cards and other collaterals. Set/replace/remove
          uses the same presigned direct-to-R2 upload as onboarding. */}
          <SCard className="px-5 py-[18px]">
            <SCardTitle title="Photo" />
            <div className="mt-3.5">
              <EmployeePhotoField
                previewUrl={photoUrl}
                onUploaded={handlePhotoUploaded}
                onRemove={photoUrl ? handlePhotoRemove : undefined}
              />
            </div>
          </SCard>

          {/* Designations & roles — capability grants, secondary to the details. */}
          {hasAnyDesignationCard && (
            <h2 className={cn('pt-3.5', SIGNAL_EYEBROW)}>
              Designations &amp; roles
            </h2>
          )}

          {/* Sales Head designation — only meaningful for Sales-vertical staff. */}
          {isSalesVertical && (
            <SCard className="flex items-center justify-between gap-4 px-5 py-[18px]">
              <div className="text-[13px]">
                <div className="font-semibold">Sales Head designation</div>
                <div className={cn('mt-0.5', SIGNAL_MUTED)}>
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
            </SCard>
          )}

          {/* Project Manager designation — role MANAGER or above, any vertical.
          Multi-holder: designate/revoke is a plain flag flip (no swap). */}
          {managerOrAbove && (
            <SCard className="flex items-center justify-between gap-4 px-5 py-[18px]">
              <div className="text-[13px]">
                <div className="font-semibold">Project Manager designation</div>
                <div className={cn('mt-0.5', SIGNAL_MUTED)}>
                  {employee.isProjectManager
                    ? 'This employee is a Project Manager and can run project kickoffs.'
                    : 'Not a Project Manager. Designate to allow running project kickoffs.'}
                </div>
              </div>
              {canDesignate && (
                <Button
                  variant={
                    employee.isProjectManager ? 'destructive' : 'outline'
                  }
                  disabled={designating}
                  onClick={() => setProjectManager(!employee.isProjectManager)}
                >
                  {employee.isProjectManager
                    ? 'Revoke Project Manager'
                    : 'Designate as Project Manager'}
                </Button>
              )}
            </SCard>
          )}

          {/* Internal Auditor designation — role MANAGER or above, any vertical.
          Multi-holder flag flip; conducts/finalizes vendor audits. */}
          {managerOrAbove && (
            <SCard className="flex items-center justify-between gap-4 px-5 py-[18px]">
              <div className="text-[13px]">
                <div className="font-semibold">
                  Internal Auditor designation
                </div>
                <div className={cn('mt-0.5', SIGNAL_MUTED)}>
                  {employee.isInternalAuditor
                    ? 'This employee is an Internal Auditor and can conduct vendor audits.'
                    : 'Not an Internal Auditor. Designate to allow conducting vendor audits.'}
                </div>
              </div>
              {canDesignate && (
                <Button
                  variant={
                    employee.isInternalAuditor ? 'destructive' : 'outline'
                  }
                  disabled={designating}
                  onClick={() =>
                    setInternalAuditor(!employee.isInternalAuditor)
                  }
                >
                  {employee.isInternalAuditor
                    ? 'Revoke Internal Auditor'
                    : 'Designate as Internal Auditor'}
                </Button>
              )}
            </SCard>
          )}

          {/* QC Inspector designation — role MANAGER or above, any vertical.
          Multi-holder flag flip; inspects incoming goods at the GRN QC gate.
          Distinct from Internal Auditor (supplier auditing vs. incoming-goods
          inspection). */}
          {managerOrAbove && (
            <SCard className="flex items-center justify-between gap-4 px-5 py-[18px]">
              <div className="text-[13px]">
                <div className="font-semibold">QC Inspector designation</div>
                <div className={cn('mt-0.5', SIGNAL_MUTED)}>
                  {employee.isQcInspector
                    ? 'This employee is a QC Inspector and can inspect incoming goods and finalize the GRN QC gate.'
                    : 'Not a QC Inspector. Designate to allow inspecting incoming goods on Goods Receipt Notes.'}
                </div>
              </div>
              {canDesignate && (
                <Button
                  variant={employee.isQcInspector ? 'destructive' : 'outline'}
                  disabled={designating}
                  onClick={() => setQcInspector(!employee.isQcInspector)}
                >
                  {employee.isQcInspector
                    ? 'Revoke QC Inspector'
                    : 'Designate as QC Inspector'}
                </Button>
              )}
            </SCard>
          )}

          {/* R&D Head designation — grants technical BOM approval + Item Master
          authority (multi-holder). The R&D Head is the BOM approver. Shown to
          any admin so the control is discoverable; the button is enabled only
          for R&D-vertical employees (the backend enforces the same rule), with
          the requirement spelled out when it isn't met. Also shown for an
          existing holder so it can always be revoked. */}
          {(canDesignate || employee.isRdHead) && (
            <SCard className="flex items-center justify-between gap-4 px-5 py-[18px]">
              <div className="text-[13px]">
                <div className="font-semibold">R&D Head designation</div>
                <div className={cn('mt-0.5', SIGNAL_MUTED)}>
                  {employee.isRdHead
                    ? 'This employee is an R&D Head and can approve/reject BOMs and manage Item Master data.'
                    : rdHeadEligible
                      ? 'Not an R&D Head. Designate to grant technical BOM approval authority (the BOM approver).'
                      : 'Only an employee in the R&D vertical (or a SUPER_ADMIN) can be an R&D Head. Move this employee to the R&D vertical first to enable this.'}
                </div>
              </div>
              {canDesignate && (
                <Button
                  variant={employee.isRdHead ? 'destructive' : 'outline'}
                  disabled={
                    designating || (!employee.isRdHead && !rdHeadEligible)
                  }
                  onClick={() => setRdHead(!employee.isRdHead)}
                >
                  {employee.isRdHead
                    ? 'Revoke R&D Head'
                    : 'Designate as R&D Head'}
                </Button>
              )}
            </SCard>
          )}

          {(isSuperAdmin || employee.isAccountsHead) && (
            <SCard className="flex items-center justify-between gap-4 px-5 py-[18px]">
              <div className="text-[13px]">
                <div className="font-semibold">
                  Finance/Accounts Head designation
                </div>
                <div className={cn('mt-0.5', SIGNAL_MUTED)}>
                  {employee.isAccountsHead
                    ? 'This employee is the sole approver for all Finance & Accounts transactions.'
                    : 'Designate as the sole Finance & Accounts approver. Any current holder will be replaced.'}
                </div>
              </div>
              {isSuperAdmin && (
                <Button
                  variant={employee.isAccountsHead ? 'destructive' : 'outline'}
                  disabled={designating}
                  onClick={() => setAccountsHead(!employee.isAccountsHead)}
                >
                  {employee.isAccountsHead
                    ? 'Revoke Accounts Head'
                    : 'Designate as Accounts Head'}
                </Button>
              )}
            </SCard>
          )}

          {(isSuperAdmin || employee.isQmsHead) && (
            <SCard className="flex items-center justify-between gap-4 px-5 py-[18px]">
              <div className="text-[13px]">
                <div className="font-semibold">QMS Head designation</div>
                <div className={cn('mt-0.5', SIGNAL_MUTED)}>
                  {employee.isQmsHead
                    ? 'This employee is the sole approver for QMS templates, plans and inspection reviews.'
                    : 'Designate as the sole QMS approval authority.'}
                </div>
              </div>
              {isSuperAdmin && (
                <Button
                  variant={employee.isQmsHead ? 'destructive' : 'outline'}
                  disabled={designating}
                  onClick={() => setQmsHead(!employee.isQmsHead)}
                >
                  {employee.isQmsHead
                    ? 'Revoke QMS Head'
                    : 'Designate as QMS Head'}
                </Button>
              )}
            </SCard>
          )}

          {(isSuperAdmin || employee.isScmHead) && (
            <SCard className="flex items-center justify-between gap-4 px-5 py-[18px]">
              <div className="text-[13px]">
                <div className="font-semibold">SCM Head designation</div>
                <div className={cn('mt-0.5', SIGNAL_MUTED)}>
                  {employee.isScmHead
                    ? 'This employee is the sole SCM Head and the owner of the SCM vertical.'
                    : isScmVertical
                      ? 'Designate as the sole SCM Head and automatically assign this employee as the SCM vertical owner.'
                      : 'Only an active employee in the SCM vertical can be designated as SCM Head. Move this employee to SCM first.'}
                </div>
              </div>
              {isSuperAdmin && (
                <Button
                  variant={employee.isScmHead ? 'destructive' : 'outline'}
                  disabled={
                    designating || (!employee.isScmHead && !isScmVertical)
                  }
                  onClick={() => setScmHead(!employee.isScmHead)}
                >
                  {employee.isScmHead
                    ? 'Revoke SCM Head'
                    : 'Designate as SCM Head'}
                </Button>
              )}
            </SCard>
          )}

          {(isSuperAdmin || employee.isDesignHead) && (
            <SCard className="flex items-center justify-between gap-4 px-5 py-[18px]">
              <div className="text-[13px]">
                <div className="font-semibold">Design Head designation</div>
                <div className={cn('mt-0.5', SIGNAL_MUTED)}>
                  {employee.isDesignHead
                    ? 'This employee is the sole approver and production-release authority for design documents.'
                    : 'Designate as the sole Design Engineering release authority.'}
                </div>
              </div>
              {isSuperAdmin && (
                <Button
                  variant={employee.isDesignHead ? 'destructive' : 'outline'}
                  disabled={designating}
                  onClick={() => setDesignHead(!employee.isDesignHead)}
                >
                  {employee.isDesignHead
                    ? 'Revoke Design Head'
                    : 'Designate as Design Head'}
                </Button>
              )}
            </SCard>
          )}

          {(isSuperAdmin || employee.isProductionHead) && (
            <SCard className="flex items-center justify-between gap-4 px-5 py-[18px]">
              <div className="text-[13px]">
                <div className="font-semibold">Production Head designation</div>
                <div className={cn('mt-0.5', SIGNAL_MUTED)}>
                  {employee.isProductionHead
                    ? 'This employee can review PLM designs, assign tracker owners, and advance production handoffs.'
                    : 'Designate as a PLM Design Review and production-handoff authority.'}
                </div>
              </div>
              {isSuperAdmin && (
                <Button
                  variant={
                    employee.isProductionHead ? 'destructive' : 'outline'
                  }
                  disabled={
                    designating ||
                    (!employee.isProductionHead && !managerOrAbove)
                  }
                  onClick={() => setProductionHead(!employee.isProductionHead)}
                >
                  {employee.isProductionHead
                    ? 'Revoke Production Head'
                    : 'Designate as Production Head'}
                </Button>
              )}
            </SCard>
          )}

          {/* Executive Dashboards access — the CEO's discretionary grant. Listed
          with the designations because it is managed the same way, but it is not
          a role: any active employee in any vertical can hold it, and it gates
          the whole Executive Dashboards section (Sales today, Finance and
          Production later). */}
          {(isSuperAdmin || employee.hasExecutiveDashboardAccess) && (
            <SCard className="flex items-center justify-between gap-4 px-5 py-[18px]">
              <div className="text-[13px]">
                <div className="font-semibold">Executive Dashboards access</div>
                <div className={cn('mt-0.5', SIGNAL_MUTED)}>
                  {employee.hasExecutiveDashboardAccess
                    ? 'This employee can open the Executive Dashboards section, including company-wide cost and margin figures.'
                    : 'Grant access to the Executive Dashboards section. Granted at the CEO’s discretion to any employee, in any vertical — the holder sees cost and margin data company-wide.'}
                </div>
              </div>
              {isSuperAdmin && (
                <Button
                  variant={
                    employee.hasExecutiveDashboardAccess
                      ? 'destructive'
                      : 'outline'
                  }
                  disabled={designating}
                  onClick={() =>
                    setExecutiveDashboardAccess(
                      !employee.hasExecutiveDashboardAccess,
                    )
                  }
                >
                  {employee.hasExecutiveDashboardAccess
                    ? 'Revoke access'
                    : 'Grant access'}
                </Button>
              )}
            </SCard>
          )}

          {/* Force password reset — Admin/SuperAdmin, for another employee who has
          login access. Generates a one-time password + forces change + kills
          their sessions. */}
          {canDesignate && employee.id !== user?.sub && (
            <SCard className="flex items-center justify-between gap-4 px-5 py-[18px]">
              <div className="text-[13px]">
                <div className="font-semibold">Reset password</div>
                <div className={cn('mt-0.5', SIGNAL_MUTED)}>
                  Generate a one-time temporary password, force a change on next
                  login, and sign this user out of all sessions.
                </div>
              </div>
              <Button
                variant="outline"
                disabled={resetting}
                onClick={handleResetPassword}
              >
                {resetting ? 'Resetting…' : 'Reset password'}
              </Button>
            </SCard>
          )}

          {/* One-time reveal of the generated temporary password. Not stored or
          logged anywhere — closing the dialog discards it. */}
          <Dialog
            open={tempPassword !== null}
            onOpenChange={(o) => !o && setTempPassword(null)}
          >
            <DialogContent className={SIGNAL_DIALOG}>
              <DialogHeader>
                <DialogTitle className={SIGNAL_DIALOG_TITLE}>
                  Temporary password
                </DialogTitle>
                <DialogDescription>
                  Share this with {employee.firstName} securely. It is shown
                  once — it can’t be retrieved again. They must set their own
                  password on next login.
                </DialogDescription>
              </DialogHeader>
              <div
                className={cn(
                  'rounded-lg border bg-black/[.03] px-3.5 py-3 text-[17px] font-semibold tracking-wide tabular-nums dark:bg-white/[.04]',
                  SIGNAL_HAIRLINE,
                )}
              >
                {tempPassword}
              </div>
              <DialogFooter>
                <button
                  type="button"
                  className={SIGNAL_BTN_OUTLINE}
                  onClick={() => {
                    if (tempPassword) {
                      void navigator.clipboard?.writeText(tempPassword);
                      toast.success('Copied to clipboard.');
                    }
                  }}
                >
                  Copy
                </button>
                <button
                  type="button"
                  className={SIGNAL_BTN_PRIMARY}
                  onClick={() => setTempPassword(null)}
                >
                  Done
                </button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Lifecycle — offboard/reactivate + permanent delete. */}
          <h2 className={cn('pt-3.5', SIGNAL_EYEBROW)}>Lifecycle</h2>

          {/* Offboarding — soft deactivate/reactivate (Admin/SUPER_ADMIN). The
          safe, reversible way to remove someone who is leaving; preserves their
          records (unlike permanent delete below). */}
          <SCard className="flex items-center justify-between gap-4 px-5 py-[18px]">
            <div className="text-[13px]">
              <div className="font-semibold">
                {employee.status === 'ACTIVE'
                  ? 'Offboard employee'
                  : 'Reactivate employee'}
              </div>
              <div className={cn('mt-0.5', SIGNAL_MUTED)}>
                {employee.status === 'ACTIVE'
                  ? 'Deactivates the account and revokes login. Reversible; records are kept.'
                  : 'This employee is currently offboarded (login revoked). Restore their access.'}
              </div>
            </div>
            <Button
              variant={employee.status === 'ACTIVE' ? 'destructive' : 'default'}
              onClick={handleToggleActive}
            >
              {employee.status === 'ACTIVE' ? 'Offboard' : 'Reactivate'}
            </Button>
          </SCard>

          {/* Permanent delete — SUPER_ADMIN only. The backend refuses if the
          employee still owns reports or business records. */}
          {isSuperAdmin && (
            <SCard className="flex items-center justify-between gap-4 border-destructive/40 px-5 py-[18px]">
              <div className="text-[13px]">
                <div className="font-semibold">Delete permanently</div>
                <div className={cn('mt-0.5', SIGNAL_MUTED)}>
                  Removes the account entirely. Refused if they still own
                  reports or business records — deactivate instead in that case.
                </div>
              </div>
              <Button variant="destructive" onClick={handleDelete}>
                Delete
              </Button>
            </SCard>
          )}
          <ProvisioningChecklist employeeId={employee.id} />
        </div>
      </div>
    </SignalPage>
  );
}
