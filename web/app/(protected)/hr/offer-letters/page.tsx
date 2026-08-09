'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, Clock, FileText, Printer, Send, XCircle } from 'lucide-react';
import { ApiError, apiFetch } from '../../../lib/api';
import { Employee, EmployeeRoster, PaginatedResult } from '../../../lib/types';
import { PageContainer } from '../../../components/ui/page-container';
import { PageHeader } from '../../../components/ui/page-header';
import { Card, CardContent } from '../../../components/ui/card';
import { Field } from '../../../components/ui/field';
import { Select } from '../../../components/ui/select';
import { Textarea } from '../../../components/ui/textarea';
import { Button } from '../../../components/ui/button';
import { StatusBadge } from '../../../components/ui/status-badge';
import { useToast } from '../../../components/ui/toaster';
import { RegisterToolbar } from '../../../components/ui/register-toolbar';
import { RegisterPagination } from '../../../components/ui/register-pagination';
import { EmptyState } from '../../../components/ui/empty-state';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../../components/ui/table';
import { useRegisterList } from '../../../lib/use-register-list';
import {
  OfferLetterDocument,
  OfferLetterPrintDocument,
  OfferLetterStatus,
} from './_components/offer-letter-print-document';

const ownerName = (o: { firstName: string; lastName: string } | null) =>
  o ? `${o.firstName} ${o.lastName}` : null;

type AvailableRequisition = {
  id: string;
  requisitionNumber: string;
  positionTitle: string;
  employmentType: string;
  superAdminApprovedAt: string | null;
};

export default function OfferLettersPage() {
  const toast = useToast();
  const [employees, setEmployees] = useState<EmployeeRoster[]>([]);
  const [employeeId, setEmployeeId] = useState('');
  const [reportsToId, setReportsToId] = useState('');
  // The manager id as loaded from the employee record — used to PATCH only on
  // an actual change (so unrelated saves don't re-trigger manager validation).
  const [loadedReportsToId, setLoadedReportsToId] = useState('');
  const [responsibilities, setResponsibilities] = useState('');
  const [kpis, setKpis] = useState('');
  const [reference, setReference] = useState('');
  const [requisitions, setRequisitions] = useState<AvailableRequisition[]>([]);
  const [candidateRequisitionId, setCandidateRequisitionId] = useState('');
  // The full server view of the saved offer (status + approval metadata). null
  // until an employee with an existing letter is selected.
  const [offer, setOffer] = useState<OfferLetterDocument | null>(null);
  // The offer rendered for print/download — set only from an APPROVED letter.
  const [document, setDocument] = useState<OfferLetterDocument | null>(null);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const register = useRegisterList(employees, (employee) => `${employee.employeeId} ${employee.firstName} ${employee.lastName} ${employee.designation ?? ''} ${employee.accessStatus}`);

  const status: OfferLetterStatus | null = offer?.status ?? null;

  useEffect(() => {
    apiFetch<PaginatedResult<EmployeeRoster>>(
      '/employees/roster?page=1&limit=100',
    )
      .then((result) => setEmployees(result.items))
      .catch(() => setError('Failed to load employees'));
  }, []);

  async function loadOffer(id: string) {
    try {
      const loaded = await apiFetch<OfferLetterDocument>(
        `/offer-letters/employee/${id}`,
      );
      setOffer(loaded);
      setResponsibilities(loaded.keyResponsibilities);
      setKpis(loaded.kpis);
      setReference(loaded.referenceNumber);
    } catch (err) {
      if (err instanceof ApiError && err.statusCode === 404) {
        setOffer(null); // No letter authored yet — a fresh draft.
      } else {
        setError(
          err instanceof Error ? err.message : 'Failed to load offer letter',
        );
      }
    }
  }

  async function selectEmployee(id: string) {
    setEmployeeId(id);
    setError(null);
    setDocument(null);
    setOffer(null);
    setResponsibilities('');
    setKpis('');
    setReference('');
    setReportsToId('');
    setLoadedReportsToId('');
    setRequisitions([]);
    setCandidateRequisitionId('');
    if (!id) return;
    // Pre-select the employee's current reporting manager (the "Reports To"
    // dropdown edits this real field, so it should reflect what's on file).
    try {
      const employee = await apiFetch<Employee>(`/employees/${id}`);
      setReportsToId(employee.reportingManagerId ?? '');
      setLoadedReportsToId(employee.reportingManagerId ?? '');
    } catch {
      // Non-fatal — the dropdown just starts empty if the read fails.
    }
    await loadOffer(id);
    try {
      const available = await apiFetch<AvailableRequisition[]>(
        `/candidate-requisitions/available?employeeId=${encodeURIComponent(id)}`,
      );
      setRequisitions(available);
      if (available.length === 1) setCandidateRequisitionId(available[0].id);
    } catch {
      setRequisitions([]);
    }
  }

  /** Persist authored content (+ reporting manager). Returns the saved offer. */
  async function persist(): Promise<OfferLetterDocument | null> {
    if (!employeeId) {
      setError('Select an employee');
      return null;
    }
    if (!responsibilities.trim() || !kpis.trim()) {
      setError('Key Responsibilities and KPIs are required');
      return null;
    }
    // Persist the reporting manager on the employee record first, but only when
    // it actually changed — this writes the single source of truth that the
    // letter's "Reports To" row (and the org/approval chain) reads from.
    if (reportsToId !== loadedReportsToId) {
      await apiFetch(`/employees/${employeeId}`, {
        method: 'PATCH',
        body: JSON.stringify({ reportingManagerId: reportsToId || null }),
      });
      setLoadedReportsToId(reportsToId);
    }
    await apiFetch('/offer-letters', {
      method: 'POST',
      body: JSON.stringify({
        employeeId,
        ...(!offer ? { candidateRequisitionId } : {}),
        keyResponsibilities: responsibilities,
        kpis,
      }),
    });
    // Re-read so status/approval metadata reflect any invalidation (an edit to
    // a submitted/approved letter drops it back to DRAFT server-side).
    const fresh = await apiFetch<OfferLetterDocument>(
      `/offer-letters/employee/${employeeId}`,
    );
    setOffer(fresh);
    setReference(fresh.referenceNumber);
    return fresh;
  }

  async function save() {
    setSaving(true);
    setError(null);
    const wasGated =
      status === 'PENDING_APPROVAL' || status === 'APPROVED';
    try {
      const fresh = await persist();
      if (fresh) {
        toast.success(
          wasGated
            ? 'Content saved. This edit reset the letter to draft — resubmit for approval.'
            : 'Offer letter content saved.',
        );
      }
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Failed to save offer letter',
      );
    } finally {
      setSaving(false);
    }
  }

  async function submitForApproval() {
    setSubmitting(true);
    setError(null);
    try {
      // Save first so the snapshot freezes exactly what's on screen.
      const saved = await persist();
      if (!saved) return;
      const submitted = await apiFetch<OfferLetterDocument>(
        `/offer-letters/employee/${employeeId}/submit`,
        { method: 'POST' },
      );
      setOffer(submitted);
      const approver = ownerName(submitted.verticalOwner);
      toast.success(
        approver
          ? `Submitted for approval to ${approver}.`
          : 'Submitted for approval to the CEO (no vertical owner is assigned).',
      );
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Failed to submit for approval',
      );
    } finally {
      setSubmitting(false);
    }
  }

  function downloadApproved() {
    if (!offer || offer.status !== 'APPROVED') return;
    setDocument(offer);
    setTimeout(() => window.print(), 50);
  }

  return (
    <>
      {document && <OfferLetterPrintDocument offer={document} />}
      <PageContainer>
        <PageHeader
          title="Offer Letters"
          description="Author the letter, submit it to the vertical owner for approval, and download it once approved."
        />
        <RegisterToolbar title="Employee Offer Register" search={register.search} onSearchChange={register.setSearch} searchPlaceholder="Search employee, designation or status" />
        <Card className="mb-6"><CardContent className="p-0"><Table><TableHeader><TableRow><TableHead>Employee</TableHead><TableHead>Designation</TableHead><TableHead>Access status</TableHead><TableHead className="text-right">Action</TableHead></TableRow></TableHeader><TableBody>
          {register.visibleItems.map((employee) => <TableRow key={employee.id}><TableCell className="font-medium">{employee.firstName} {employee.lastName}<span className="block text-xs text-muted-foreground">{employee.employeeId}</span></TableCell><TableCell>{employee.designation ?? '—'}</TableCell><TableCell><StatusBadge value={employee.accessStatus} /></TableCell><TableCell className="text-right"><Button size="sm" variant={employee.id === employeeId ? 'secondary' : 'outline'} onClick={() => void selectEmployee(employee.id)}>{employee.id === employeeId ? 'Selected' : 'Open offer'}</Button></TableCell></TableRow>)}
          {!register.visibleItems.length && <TableRow><TableCell colSpan={4} className="p-0"><EmptyState icon={FileText} title="No employees match your search" /></TableCell></TableRow>}
        </TableBody></Table></CardContent></Card>
        <RegisterPagination page={register.page} pageCount={register.pageCount} onPageChange={register.setPage} />
        <Card>
          <CardContent className="space-y-5 p-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Employee" required>
                <Select
                  value={employeeId}
                  onChange={(e) => void selectEmployee(e.target.value)}
                >
                  <option value="">Select an employee…</option>
                  {employees.map((employee) => (
                    <option key={employee.id} value={employee.id}>
                      {employee.employeeId} · {employee.firstName}{' '}
                      {employee.lastName}
                    </option>
                  ))}
                </Select>
              </Field>
              {!offer && (
                <Field
                  label="Approved candidate requisition"
                  required
                  hint="One approved requisition authorizes one offer letter"
                >
                  <Select
                    value={candidateRequisitionId}
                    onChange={(e) => setCandidateRequisitionId(e.target.value)}
                    disabled={!employeeId}
                  >
                    <option value="">Select an approved requisition…</option>
                    {requisitions.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.requisitionNumber} · {r.positionTitle}
                      </option>
                    ))}
                  </Select>
                  {employeeId && requisitions.length === 0 && (
                    <p className="mt-1 text-xs text-destructive">
                      No approved, unconsumed requisition matches this employee’s vertical and designation.
                    </p>
                  )}
                </Field>
              )}
              <Field
                label="Reference number"
                hint="Generated once and retained across regenerations"
              >
                <div className="flex h-11 items-center rounded-md border bg-muted px-3 text-sm md:h-9">
                  {reference || 'Generated when first saved'}
                </div>
              </Field>
              <Field
                label="Reports to"
                hint="Sets the employee's reporting manager (shown as “Reports To” on the letter)"
              >
                <Select
                  value={reportsToId}
                  onChange={(e) => setReportsToId(e.target.value)}
                  disabled={!employeeId}
                >
                  <option value="">No reporting manager</option>
                  {employees
                    .filter((manager) => manager.id !== employeeId)
                    .map((manager) => (
                      <option key={manager.id} value={manager.id}>
                        {manager.employeeId} · {manager.firstName}{' '}
                        {manager.lastName}
                      </option>
                    ))}
                </Select>
              </Field>
            </div>

            {status && <StatusPanel offer={offer!} />}

            <Field
              label="Key Responsibilities"
              required
              hint="Enter one responsibility per line"
            >
              <Textarea
                rows={10}
                value={responsibilities}
                onChange={(e) => setResponsibilities(e.target.value)}
                placeholder="Develop and execute…"
              />
            </Field>
            <Field
              label="Key Performance Indicators (KPIs)"
              required
              hint="Enter one KPI per line"
            >
              <Textarea
                rows={8}
                value={kpis}
                onChange={(e) => setKpis(e.target.value)}
                placeholder="Revenue achievement…"
              />
            </Field>

            {(status === 'PENDING_APPROVAL' || status === 'APPROVED') && (
              <p className="text-sm text-muted-foreground">
                Editing the content and saving will reset this letter to draft
                and require a fresh approval.
              </p>
            )}

            {error && <p className="text-sm text-destructive">{error}</p>}

            <div className="flex flex-wrap items-center justify-end gap-3 border-t pt-4">
              <Button
                variant="outline"
                disabled={saving || submitting}
                onClick={() => void save()}
              >
                <FileText /> {saving ? 'Saving…' : 'Save content'}
              </Button>
              {status !== 'APPROVED' && (
                <Button
                  disabled={saving || submitting || !employeeId}
                  onClick={() => void submitForApproval()}
                >
                  <Send />{' '}
                  {submitting
                    ? 'Submitting…'
                    : status === 'PENDING_APPROVAL'
                      ? 'Resubmit for Approval'
                      : 'Submit for Approval'}
                </Button>
              )}
              <Button
                disabled={status !== 'APPROVED'}
                onClick={downloadApproved}
                title={
                  status === 'APPROVED'
                    ? undefined
                    : 'The offer letter can be downloaded only after it is approved.'
                }
              >
                <Printer /> Download Offer Letter
              </Button>
            </div>
          </CardContent>
        </Card>
      </PageContainer>
    </>
  );
}

/**
 * Explains the current gate state and — crucially — WHY the download is or
 * isn't available: pending on whom, approved by whom, or rejected with the
 * approver's required comment.
 */
function StatusPanel({ offer }: { offer: OfferLetterDocument }) {
  const owner = ownerName(offer.verticalOwner);
  const approver = ownerName(offer.approver);

  const tone =
    offer.status === 'APPROVED'
      ? 'border-success/40 bg-success/10'
      : offer.status === 'REJECTED'
        ? 'border-destructive/40 bg-destructive/10'
        : offer.status === 'PENDING_APPROVAL'
          ? 'border-warning/40 bg-warning/10'
          : 'border-border bg-muted/40';

  const Icon =
    offer.status === 'APPROVED'
      ? CheckCircle2
      : offer.status === 'REJECTED'
        ? XCircle
        : offer.status === 'PENDING_APPROVAL'
          ? Clock
          : FileText;

  return (
    <div className={`flex gap-3 rounded-md border p-4 ${tone}`}>
      <Icon className="mt-0.5 h-5 w-5 shrink-0" />
      <div className="space-y-1 text-sm">
        <div className="flex items-center gap-2">
          <StatusBadge value={offer.status} />
        </div>
        {offer.status === 'DRAFT' && (
          <p className="text-muted-foreground">
            This letter is a draft. Submit it for approval
            {owner ? ` to ${owner} (vertical owner)` : ' to the CEO'} —
            it can be downloaded only once approved.
          </p>
        )}
        {offer.status === 'PENDING_APPROVAL' && (
          <p className="text-muted-foreground">
            Awaiting approval
            {approver ? ` from ${approver}` : ' from the CEO'}. The
            document is locked to what was submitted and can’t be downloaded
            until approved.
          </p>
        )}
        {offer.status === 'APPROVED' && (
          <p className="text-muted-foreground">
            Approved{approver ? ` by ${approver}` : ''}. You can now download the
            offer letter.
          </p>
        )}
        {offer.status === 'REJECTED' && (
          <div className="space-y-1">
            <p className="text-muted-foreground">
              Rejected{approver ? ` by ${approver}` : ''}. Address the feedback,
              save, and resubmit.
            </p>
            {offer.approverComments && (
              <p className="rounded bg-background/60 px-3 py-2">
                <span className="font-medium">Reviewer comment:</span>{' '}
                {offer.approverComments}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
