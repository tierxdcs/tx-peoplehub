'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { ApiError } from '../../../../lib/api';
import { useAuth } from '../../../../lib/auth-context';
import {
  clearAuditClassificationOverride,
  createInvite,
  createQuestionnaireRevision,
  FILLED_BY_LABEL,
  getSupplier,
  revokeInvite,
  sendInviteEmail,
  type FilledBy,
  type SupplierAudit,
  type SupplierDetail,
  type SupplierInvite,
} from '../../../../lib/scm-supplier';
import { inviteEmailMessage } from '../../../../lib/invite-email';
import { PageContainer } from '../../../../components/ui/page-container';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '../../../../components/ui/card';
import { Button } from '../../../../components/ui/button';
import { Input } from '../../../../components/ui/input';
import { Skeleton } from '../../../../components/ui/skeleton';
import { StatusBadge } from '../../../../components/ui/status-badge';
import { ProcessFlow } from '../../../../components/ui/process-flow';
import { supplierFlow } from '../../../../lib/record-flows';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../../components/ui/table';
import { useToast } from '../../../../components/ui/toaster';
import { useConfirm } from '../../../../components/ui/confirm';
import { OverrideTag } from '../../../../components/ui/override-tag';
import { QuestionnaireView } from '../_components/questionnaire-view';
import { AuditForm } from '../_components/audit-form';
import { InternalFillDialog } from '../_components/internal-fill-dialog';
import { OverrideDialog } from '../_components/override-dialog';

export default function SupplierDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();

  const [supplier, setSupplier] = useState<SupplierDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [invite, setInvite] = useState<SupplierInvite | null>(null);
  const [invitePassword, setInvitePassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [emailing, setEmailing] = useState(false);
  const [auditing, setAuditing] = useState(false);
  const [fillingInternally, setFillingInternally] = useState(false);
  const [overriding, setOverriding] = useState<SupplierAudit | null>(null);

  // UI hints — backend is the real gate (SCM-vertical Manager+ / auditor).
  const canManage = user?.role === 'SUPER_ADMIN' || user?.role === 'MANAGER';
  // Classification override is SuperAdmin-only (bypasses a real risk control).
  const canOverride = user?.role === 'SUPER_ADMIN';

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setSupplier(await getSupplier(id));
    } catch (err) {
      setError(
        err instanceof ApiError && err.statusCode === 404
          ? 'Supplier not found.'
          : 'Failed to load supplier.',
      );
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const latestQuestionnaire = supplier?.questionnaires[0] ?? null;

  async function generateInvite() {
    if (!latestQuestionnaire) return;
    setBusy(true);
    try {
      const created = await createInvite(latestQuestionnaire.id, {
        password: invitePassword.trim() || undefined,
      });
      setInvite(created);
      setInvitePassword('');
      toast.success('Invite link generated.');
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : 'Failed to generate invite.',
      );
    } finally {
      setBusy(false);
    }
  }

  /** Email the existing link (see the vendor page — same shared action). */
  async function emailInvite(inviteId: string) {
    if (!supplier) return;
    if (
      !(await confirm({
        title: `Email this link to ${supplier.contactEmail}?`,
        description: supplier.contactEmail
          ? 'Sends the questionnaire invite to the supplier’s contact email. Any password is shared separately, never in the email.'
          : 'This supplier has no contact email on file — add one first.',
        confirmLabel: 'Send email',
      }))
    )
      return;
    setEmailing(true);
    try {
      const result = await sendInviteEmail(inviteId);
      const message = inviteEmailMessage(result, supplier.contactEmail);
      if (message.tone === 'success') toast.success(message.text);
      else toast.toast({ title: 'Email not sent', description: message.text });
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : 'Failed to send the email.',
      );
    } finally {
      setEmailing(false);
    }
  }

  async function revoke(inviteId: string) {
    if (
      !(await confirm({
        title: 'Revoke this link?',
        description: 'The supplier will no longer be able to use it.',
        confirmLabel: 'Revoke',
        destructive: true,
      }))
    )
      return;
    try {
      await revokeInvite(inviteId);
      setInvite((cur) =>
        cur && cur.id === inviteId
          ? { ...cur, revokedAt: new Date().toISOString() }
          : cur,
      );
      toast.success('Link revoked.');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to revoke.');
    }
  }

  async function newRevision() {
    if (
      !(await confirm({
        title: 'Create a new questionnaire revision?',
        description:
          'Starts a fresh questionnaire for resubmission. Prior revisions are preserved.',
        confirmLabel: 'Create revision',
      }))
    )
      return;
    try {
      await createQuestionnaireRevision(id);
      await load();
      setInvite(null);
      toast.success('New revision created.');
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : 'Failed to create revision.',
      );
    }
  }

  async function clearOverride(audit: SupplierAudit) {
    if (
      !(await confirm({
        title: 'Clear this override?',
        description:
          'Reverts the classification (and supplier status) to the value computed from the audit score.',
        confirmLabel: 'Clear override',
        destructive: true,
      }))
    )
      return;
    try {
      await clearAuditClassificationOverride(id, audit.id);
      await load();
      toast.success(
        'Override cleared — reverted to the computed classification.',
      );
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : 'Failed to clear override.',
      );
    }
  }

  function publicUrl(token: string): string {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    return `${origin}/public/supplier-questionnaire/${token}`;
  }

  if (loading) {
    return (
      <PageContainer>
        <Skeleton className="mb-4 h-6 w-24" />
        <Skeleton className="mb-6 h-9 w-64" />
        <Skeleton className="h-48 w-full" />
      </PageContainer>
    );
  }
  if (error || !supplier) {
    return (
      <PageContainer>
        <p className="text-destructive">{error ?? 'Supplier not found'}</p>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <Link
        href="/scm/suppliers"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Suppliers
      </Link>

      {/* Header */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">
          {supplier.companyName}
        </h1>
        <StatusBadge value={supplier.status} />
        {supplier.statusOverridden && (
          <OverrideTag by={supplier.audits[0]?.overriddenByName ?? undefined} />
        )}
      </div>

      {/* Live flow indicator — qualification stage derived from status. */}
      <ProcessFlow
        title="Qualification progress"
        className="mb-4"
        {...supplierFlow(supplier.status)}
      />

      {/* Basic info */}
      <Card className="mb-4">
        <CardHeader>
          <CardTitle>Company Information</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-x-8 gap-y-2 pt-0 text-sm sm:grid-cols-2">
          <Info
            label="Registered address / origin"
            value={supplier.registeredAddress ?? '—'}
          />
          <Info
            label="Factory address"
            value={supplier.factoryAddress ?? '—'}
          />
          <Info
            label="Year established"
            value={supplier.yearEstablished ?? '—'}
          />
          <Info label="Employees" value={supplier.numberOfEmployees ?? '—'} />
          <Info
            label="Annual turnover"
            value={supplier.annualTurnover ?? '—'}
          />
          <Info
            label="MSME / UDYAM"
            value={supplier.msmeUdyamCertificate ?? '—'}
          />
          <Info label="GSTIN" value={supplier.gstin ?? '—'} />
          <Info
            label="Contact"
            value={joinParts([
              supplier.contactPersonName,
              supplier.contactPersonDesignation,
            ])}
          />
          <Info
            label="Email / phone"
            value={joinParts([supplier.contactEmail, supplier.contactPhone])}
          />
          <Info label="Website" value={supplier.website ?? '—'} />
        </CardContent>
      </Card>

      {/* Questionnaire */}
      <Card className="mb-4">
        <CardHeader>
          <CardTitle>Questionnaire</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Revision</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Submitted</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {supplier.questionnaires.map((q) => (
                <TableRow key={q.id}>
                  <TableCell className="font-medium">
                    Rev {q.revisionNumber}
                  </TableCell>
                  <TableCell>
                    <StatusBadge value={q.status} />
                  </TableCell>
                  <TableCell>
                    <FilledByTag filledBy={q.filledBy} />
                  </TableCell>
                  <TableCell>
                    {q.submittedAt
                      ? new Date(q.submittedAt).toLocaleDateString()
                      : '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {/* Invite management — only meaningful while the latest is unsubmitted */}
          {canManage && latestQuestionnaire?.status === 'SENT' && (
            <div className="mt-4 space-y-2 rounded-md border p-3">
              <div className="text-sm font-medium">Supplier invite link</div>
              {invite && !invite.revokedAt ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Input
                      readOnly
                      value={publicUrl(invite.token)}
                      className="h-8"
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        void navigator.clipboard?.writeText(
                          publicUrl(invite.token),
                        );
                        toast.success('Link copied.');
                      }}
                    >
                      Copy
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => emailInvite(invite.id)}
                      disabled={emailing || !supplier.contactEmail}
                    >
                      {emailing ? 'Sending…' : 'Email to supplier'}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => revoke(invite.id)}
                    >
                      Revoke
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Expires {new Date(invite.expiresAt).toLocaleDateString()}{' '}
                    (14-day default)
                    {invite.hasPassword ? ' · password-protected' : ''}.{' '}
                    {supplier.contactEmail
                      ? `Emails go to ${supplier.contactEmail}.`
                      : 'Add a contact email to send it from here, or copy the link.'}
                    {invite.hasPassword
                      ? ' The password is never included — share it separately.'
                      : ''}
                  </p>
                </div>
              ) : (
                <div className="flex flex-wrap items-end gap-2">
                  <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                    Optional password
                    <Input
                      value={invitePassword}
                      onChange={(e) => setInvitePassword(e.target.value)}
                      className="h-8 w-52"
                      placeholder="Leave blank for none"
                    />
                  </label>
                  <Button size="sm" onClick={generateInvite} disabled={busy}>
                    Generate Invite Link
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* Fill Internally — available on any SENT questionnaire, whether or
              not an invite link was already generated (staff may switch
              strategy if the supplier is slow to respond). */}
          {canManage && latestQuestionnaire?.status === 'SENT' && (
            <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md border p-3">
              <div className="flex-1 text-sm">
                <span className="font-medium">Fill internally</span>
                <span className="ml-2 text-xs text-muted-foreground">
                  Enter the supplier’s answers yourself (e.g. from a call or
                  email).
                </span>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setFillingInternally(true)}
              >
                Fill Internally
              </Button>
            </div>
          )}

          {/* Submitted → read-only rendering of the latest submitted revision */}
          {latestQuestionnaire?.status === 'SUBMITTED' && (
            <div className="mt-4">
              <QuestionnaireView
                questionnaire={latestQuestionnaire}
                supplier={supplier}
              />
            </div>
          )}

          {/* New revision — once a prior revision exists (e.g. Conditionally Approved) */}
          {canManage && (
            <div className="mt-4">
              <Button variant="outline" size="sm" onClick={newRevision}>
                Create New Revision
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Audits */}
      <Card className="mb-4">
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle>Audits</CardTitle>
          {canManage && latestQuestionnaire?.status === 'SUBMITTED' && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setAuditing(true)}
            >
              Create Audit
            </Button>
          )}
        </CardHeader>
        <CardContent className="pt-0">
          {supplier.audits.length === 0 ? (
            <p className="text-sm text-muted-foreground">No audits yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Auditor</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Classification</TableHead>
                  {canOverride && (
                    <TableHead className="text-right">Override</TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {supplier.audits.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell>
                      {new Date(a.auditDate).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      {a.auditType === 'PHYSICAL' ? 'Physical' : 'Virtual'}
                    </TableCell>
                    <TableCell>{a.auditorName ?? '—'}</TableCell>
                    <TableCell className="text-right font-medium">
                      {a.totalScore} / 100
                    </TableCell>
                    <TableCell>
                      {a.isOverridden ? (
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <StatusBadge value={a.effectiveClassification} />
                            <OverrideTag by={a.overriddenByName} />
                          </div>
                          <div className="text-xs text-muted-foreground">
                            Computed:{' '}
                            <span className="line-through">
                              {a.classificationLabel}
                            </span>
                          </div>
                          {a.overrideReason && (
                            <div className="text-xs text-muted-foreground">
                              Reason: {a.overrideReason}
                            </div>
                          )}
                        </div>
                      ) : (
                        <StatusBadge value={a.classification} />
                      )}
                    </TableCell>
                    {canOverride && (
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setOverriding(a)}
                          >
                            {a.isOverridden ? 'Edit' : 'Override'}
                          </Button>
                          {a.isOverridden && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => clearOverride(a)}
                            >
                              Clear
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {auditing && latestQuestionnaire && (
        <AuditForm
          supplierId={supplier.id}
          questionnaireId={latestQuestionnaire.id}
          onClose={() => setAuditing(false)}
          onCreated={() => {
            setAuditing(false);
            void load();
          }}
        />
      )}

      {fillingInternally && latestQuestionnaire && (
        <InternalFillDialog
          questionnaire={latestQuestionnaire}
          onClose={() => setFillingInternally(false)}
          onSubmitted={() => {
            setFillingInternally(false);
            void load();
          }}
        />
      )}

      {overriding && (
        <OverrideDialog
          supplierId={supplier.id}
          audit={overriding}
          onClose={() => setOverriding(null)}
          onSaved={() => {
            setOverriding(null);
            void load();
          }}
        />
      )}
    </PageContainer>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <div>{value}</div>
    </div>
  );
}

/** Join non-empty parts with " · ", falling back to "—" when nothing is set. */
function joinParts(parts: (string | null | undefined)[]): string {
  const present = parts.filter((p): p is string => !!p?.trim());
  return present.length > 0 ? present.join(' · ') : '—';
}

/** Small tag showing how a questionnaire was filled; dash when not yet submitted. */
function FilledByTag({ filledBy }: { filledBy: FilledBy | null }) {
  if (!filledBy) return <span className="text-muted-foreground">—</span>;
  const internal = filledBy === 'INTERNAL_STAFF';
  return (
    <span
      className={
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ' +
        (internal ? 'bg-warning/15 text-warning' : 'bg-success/15 text-success')
      }
    >
      {FILLED_BY_LABEL[filledBy]}
    </span>
  );
}
