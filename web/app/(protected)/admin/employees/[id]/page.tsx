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
  // The generated temporary password from a force-reset — held in state ONLY to
  // show once in the dialog below; never persisted or logged.
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);

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
      toast.success(
        next ? 'QC Inspector designated' : 'QC Inspector revoked',
      );
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
      title: next ? 'Designate Finance/Accounts Head' : 'Revoke Finance/Accounts Head',
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
      toast.success(next ? 'Finance/Accounts Head designated' : 'Finance/Accounts Head revoked');
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to update Finance/Accounts Head');
    } finally {
      setDesignating(false);
    }
  }

  async function setQmsHead(next: boolean) {
    if (!employee) return;
    const ok = await confirm({ title: next ? 'Designate QMS Head' : 'Revoke QMS Head', description: next ? `Designate ${employee.firstName} ${employee.lastName} as the sole QMS approver? Any existing holder will be replaced.` : 'QMS approvals will stop until a new head is assigned.', confirmLabel: next ? 'Designate' : 'Revoke', destructive: !next });
    if (!ok) return;
    setDesignating(true);
    try { await apiFetch(`/employees/${employee.id}/${next ? 'designate' : 'revoke'}-qms-head`, { method: 'PATCH' }); toast.success(next ? 'QMS Head designated' : 'QMS Head revoked'); await load(); }
    catch (err) { toast.error(err instanceof ApiError ? err.message : 'Failed to update QMS Head'); }
    finally { setDesignating(false); }
  }

  async function setDesignHead(next: boolean) {
    if (!employee) return;
    const ok = await confirm({ title: next ? 'Designate Design Head' : 'Revoke Design Head', description: next ? `Designate ${employee.firstName} ${employee.lastName} as the sole design release authority? Any existing holder will be replaced.` : 'Design releases will stop until a new Design Head is assigned.', confirmLabel: next ? 'Designate' : 'Revoke', destructive: !next });
    if (!ok) return;
    setDesignating(true);
    try { await apiFetch(`/employees/${employee.id}/${next ? 'designate' : 'revoke'}-design-head`, { method: 'PATCH' }); toast.success(next ? 'Design Head designated' : 'Design Head revoked'); await load(); }
    catch (err) { toast.error(err instanceof ApiError ? err.message : 'Failed to update Design Head'); }
    finally { setDesignating(false); }
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

  if (loading) return <p>Loading…</p>;
  if (!employee) return <p>Employee not found.</p>;

  const salesVerticalId = verticals.find((v) => v.code === 'SALES')?.id;
  const isSalesVertical =
    !!salesVerticalId && employee.verticalId === salesVerticalId;
  const rndVerticalId = verticals.find((v) => v.code === 'RND')?.id;
  const isRndVertical =
    !!rndVerticalId && employee.verticalId === rndVerticalId;
  // R&D Head eligibility mirrors the backend: R&D-vertical employees, or a
  // SUPER_ADMIN (exempt from the vertical requirement — company-wide holder).
  const rdHeadEligible = isRndVertical || employee.role === 'SUPER_ADMIN';
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
        {employee.isQcInspector && (
          <Badge variant="info">QC Inspector</Badge>
        )}
        {employee.isRdHead && <Badge variant="info">R&D Head</Badge>}
        {employee.isAccountsHead && <Badge variant="info">Finance/Accounts Head</Badge>}
        {employee.isQmsHead && <Badge variant="info">QMS Head</Badge>}
        {employee.isDesignHead && <Badge variant="info">Design Head</Badge>}
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

      {/* QC Inspector designation — role MANAGER or above, any vertical.
          Multi-holder flag flip; inspects incoming goods at the GRN QC gate.
          Distinct from Internal Auditor (supplier auditing vs. incoming-goods
          inspection). */}
      {managerOrAbove && (
        <Card className="my-4 max-w-xl">
          <CardContent className="flex items-center justify-between gap-4 p-4">
            <div className="text-sm">
              <div className="font-medium">QC Inspector designation</div>
              <div className="text-muted-foreground">
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
          </CardContent>
        </Card>
      )}

      {/* R&D Head designation — grants technical BOM approval + Item Master
          authority (multi-holder). The R&D Head is the BOM approver. Shown to
          any admin so the control is discoverable; the button is enabled only
          for R&D-vertical employees (the backend enforces the same rule), with
          the requirement spelled out when it isn't met. Also shown for an
          existing holder so it can always be revoked. */}
      {(canDesignate || employee.isRdHead) && (
        <Card className="my-4 max-w-xl">
          <CardContent className="flex items-center justify-between gap-4 p-4">
            <div className="text-sm">
              <div className="font-medium">R&D Head designation</div>
              <div className="text-muted-foreground">
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
                disabled={designating || (!employee.isRdHead && !rdHeadEligible)}
                onClick={() => setRdHead(!employee.isRdHead)}
              >
                {employee.isRdHead ? 'Revoke R&D Head' : 'Designate as R&D Head'}
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {(isSuperAdmin || employee.isAccountsHead) && (
        <Card className="my-4 max-w-xl">
          <CardContent className="flex items-center justify-between gap-4 p-4">
            <div className="text-sm">
              <div className="font-medium">Finance/Accounts Head designation</div>
              <div className="text-muted-foreground">
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
                {employee.isAccountsHead ? 'Revoke Accounts Head' : 'Designate as Accounts Head'}
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {(isSuperAdmin || employee.isQmsHead) && (
        <Card className="my-4 max-w-xl"><CardContent className="flex items-center justify-between gap-4 p-4"><div className="text-sm"><div className="font-medium">QMS Head designation</div><div className="text-muted-foreground">{employee.isQmsHead ? 'This employee is the sole approver for QMS templates, plans and inspection reviews.' : 'Designate as the sole QMS approval authority.'}</div></div>{isSuperAdmin && <Button variant={employee.isQmsHead ? 'destructive' : 'outline'} disabled={designating} onClick={()=>setQmsHead(!employee.isQmsHead)}>{employee.isQmsHead ? 'Revoke QMS Head' : 'Designate as QMS Head'}</Button>}</CardContent></Card>
      )}

      {(isSuperAdmin || employee.isDesignHead) && (
        <Card className="my-4 max-w-xl"><CardContent className="flex items-center justify-between gap-4 p-4"><div className="text-sm"><div className="font-medium">Design Head designation</div><div className="text-muted-foreground">{employee.isDesignHead ? 'This employee is the sole approver and production-release authority for design documents.' : 'Designate as the sole Design Engineering release authority.'}</div></div>{isSuperAdmin && <Button variant={employee.isDesignHead ? 'destructive' : 'outline'} disabled={designating} onClick={()=>setDesignHead(!employee.isDesignHead)}>{employee.isDesignHead ? 'Revoke Design Head' : 'Designate as Design Head'}</Button>}</CardContent></Card>
      )}

      {/* Force password reset — Admin/SuperAdmin, for another employee who has
          login access. Generates a one-time password + forces change + kills
          their sessions. */}
      {canDesignate && employee.id !== user?.sub && (
        <Card className="my-4 max-w-xl">
          <CardContent className="flex items-center justify-between gap-4 p-4">
            <div className="text-sm">
              <div className="font-medium">Reset password</div>
              <div className="text-muted-foreground">
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
          </CardContent>
        </Card>
      )}

      {/* One-time reveal of the generated temporary password. Not stored or
          logged anywhere — closing the dialog discards it. */}
      <Dialog
        open={tempPassword !== null}
        onOpenChange={(o) => !o && setTempPassword(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Temporary password</DialogTitle>
            <DialogDescription>
              Share this with {employee.firstName} securely. It is shown once —
              it can’t be retrieved again. They must set their own password on
              next login.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-md border bg-muted p-3 font-mono text-lg tracking-wide">
            {tempPassword}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                if (tempPassword) {
                  void navigator.clipboard?.writeText(tempPassword);
                  toast.success('Copied to clipboard.');
                }
              }}
            >
              Copy
            </Button>
            <Button onClick={() => setTempPassword(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
