'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  CheckCircle2,
  Clock,
  FileText,
  Printer,
  Send,
  ThumbsDown,
  ThumbsUp,
  UserPlus,
  XCircle,
} from 'lucide-react';
import { ApiError, apiFetch } from '../../../lib/api';
import { useAuth } from '../../../lib/auth-context';
import {
  EmployeeRoster,
  EmploymentType,
  PaginatedResult,
} from '../../../lib/types';
import { formatINR } from '../../../lib/sales';
import { useNumberFormat } from '../../../lib/number-format-context';
import {
  SCard,
  SCardTitle,
  SignalHeader,
  SignalPage,
} from '../../../components/ui/signal';
import { Field } from '../../../components/ui/field';
import { Input } from '../../../components/ui/input';
import { Select } from '../../../components/ui/select';
import { Textarea } from '../../../components/ui/textarea';
import { Button } from '../../../components/ui/button';
import { StatusBadge } from '../../../components/ui/status-badge';
import { useToast } from '../../../components/ui/toaster';
import { useConfirm } from '../../../components/ui/confirm';
import { RegisterToolbar } from '../../../components/ui/register-toolbar';
import { RegisterPagination } from '../../../components/ui/register-pagination';
import { EmptyState } from '../../../components/ui/empty-state';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../components/ui/table';
import { useRegisterList } from '../../../lib/use-register-list';
import {
  OfferLetterDocument,
  OfferLetterPrintDocument,
  OfferLetterStatus,
} from './_components/offer-letter-print-document';

const ownerName = (o: { firstName: string; lastName: string } | null) =>
  o ? `${o.firstName} ${o.lastName}` : null;

const EMPLOYMENT_TYPES: { value: EmploymentType; label: string }[] = [
  { value: 'FULL_TIME_PERMANENT', label: 'Full-time (Permanent)' },
  { value: 'CONTRACT', label: 'Contract' },
  { value: 'INTERN', label: 'Intern' },
  { value: 'PART_TIME', label: 'Part-time' },
];

/** The same constrained list the onboarding wizard uses, so the place of posting
 *  on the letter is one the employee record can actually take. */
const WORK_LOCATIONS = ['Unit 1 - Peenya', 'Unit 2 - Dabaspet', 'Hybrid'];

/**
 * An applicant marked SELECTED at interview whose position has no live offer
 * yet — the starting point of the whole flow. The offer is drafted for them
 * months before any Employee row exists.
 */
type AwaitingCandidate = {
  id: string;
  name: string;
  contact: string;
  expectedCtc: string | null;
  requisition: {
    id: string;
    requisitionNumber: string;
    positionTitle: string;
    employmentType: EmploymentType;
    keyResponsibilities: string | null;
    keyPerformanceIndicators: string | null;
    budgetAnnualCtc: string | null;
    targetJoiningDate: string | null;
    vertical: { id: string; name: string } | null;
  };
};

/** One row of the offer register. */
type OfferRegisterRow = {
  id: string;
  referenceNumber: string;
  status: OfferLetterStatus;
  sentAt: string | null;
  acceptedAt: string | null;
  declinedAt: string | null;
  declineReason: string | null;
  submittedAt: string | null;
  updatedAt: string;
  candidateName: string | null;
  positionTitle: string | null;
  candidateApplicationId: string | null;
  candidateRequisition: {
    id: string;
    requisitionNumber: string;
    positionTitle: string;
    vertical: { ownerId: string | null };
  } | null;
};

/** The candidate's answer, as one short label — deliberately separate from the
 *  internal approval `status`, because they are two independent axes. */
function answerLabel(offer: {
  sentAt: string | null;
  acceptedAt: string | null;
  declinedAt: string | null;
}) {
  if (offer.acceptedAt) return 'ACCEPTED';
  if (offer.declinedAt) return 'DECLINED';
  if (offer.sentAt) return 'AWAITING_REPLY';
  return 'NOT_SENT';
}

const dateInput = (iso: string | null) => (iso ? iso.slice(0, 10) : '');

/**
 * Every employee who could be named as a reporting manager on a letter.
 *
 * The roster is paginated and the shared pagination DTO caps `limit` at 100, so
 * a single oversized page is rejected outright — walk the pages instead and stop
 * once `total` is covered (ROSTER_PAGE_CAP is a runaway guard, not a policy).
 * "Reports To" is a line on a letter, not an ERP grant, so this is deliberately
 * not filtered by role — any active colleague can be someone's manager.
 */
const ROSTER_PAGE_SIZE = 100;
const ROSTER_PAGE_CAP = 20;

async function loadRoster(): Promise<EmployeeRoster[]> {
  const all: EmployeeRoster[] = [];
  for (let page = 1; page <= ROSTER_PAGE_CAP; page += 1) {
    const res = await apiFetch<PaginatedResult<EmployeeRoster>>(
      `/employees/roster?page=${page}&limit=${ROSTER_PAGE_SIZE}`,
    );
    all.push(...res.items);
    if (all.length >= res.total || res.items.length === 0) break;
  }
  return all
    .filter((e) => e.status === 'ACTIVE')
    .sort((a, b) =>
      `${a.firstName} ${a.lastName}`.localeCompare(
        `${b.firstName} ${b.lastName}`,
      ),
    );
}

export default function OfferLettersPage() {
  const router = useRouter();
  const { user } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const { style: numberFormatStyle } = useNumberFormat();

  const [candidates, setCandidates] = useState<AwaitingCandidate[]>([]);
  const [letters, setLetters] = useState<OfferRegisterRow[]>([]);
  const [employees, setEmployees] = useState<EmployeeRoster[]>([]);

  // Which letter is being authored. `offer` is the server's full view once the
  // letter exists; `candidate` is set only while drafting a brand-new one (there
  // is no letter to read the subject off yet).
  const [offer, setOffer] = useState<OfferLetterDocument | null>(null);
  const [candidate, setCandidate] = useState<AwaitingCandidate | null>(null);

  // Authored content + the offer terms the letter quotes.
  const [designation, setDesignation] = useState('');
  const [employmentType, setEmploymentType] = useState<EmploymentType>(
    'FULL_TIME_PERMANENT',
  );
  const [dateOfJoining, setDateOfJoining] = useState('');
  const [workLocation, setWorkLocation] = useState('');
  const [territory, setTerritory] = useState('');
  const [monthlyCtc, setMonthlyCtc] = useState('');
  const [reportsToId, setReportsToId] = useState('');
  const [responsibilities, setResponsibilities] = useState('');
  const [kpis, setKpis] = useState('');

  const [declineOpen, setDeclineOpen] = useState(false);
  const [declineReason, setDeclineReason] = useState('');

  // The offer rendered for print/download — set only from an APPROVED letter.
  const [document, setDocument] = useState<OfferLetterDocument | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const register = useRegisterList(
    letters,
    (row) =>
      `${row.referenceNumber} ${row.candidateName ?? ''} ${row.positionTitle ?? ''} ${row.candidateRequisition?.requisitionNumber ?? ''} ${row.status} ${answerLabel(row)}`,
  );

  const status: OfferLetterStatus | null = offer?.status ?? null;
  // A legacy letter written against an Employee row reads its terms off that
  // row, so the terms form does not apply to it.
  const legacy = !!offer?.employeeId;
  const accepted = !!offer?.acceptedAt;
  const canSuperAdminReview =
    user?.role === 'SUPER_ADMIN' &&
    !!offer &&
    (offer.status === 'PENDING_CEO_APPROVAL' ||
      (offer.status === 'PENDING_VERTICAL_APPROVAL' && !offer.verticalOwner));

  const loadRegisters = useCallback(async () => {
    const [awaiting, existing] = await Promise.all([
      apiFetch<AwaitingCandidate[]>('/offer-letters/candidates-awaiting-offer'),
      apiFetch<OfferRegisterRow[]>('/offer-letters'),
    ]);
    setCandidates(awaiting);
    setLetters(existing);
  }, []);

  useEffect(() => {
    void loadRegisters().catch(() =>
      setError('Failed to load offer letters and selected candidates'),
    );
    loadRoster()
      .then(setEmployees)
      .catch(() => setError('Failed to load the reporting-manager list'));
  }, [loadRegisters]);

  function resetForm() {
    setOffer(null);
    setCandidate(null);
    setDocument(null);
    setError(null);
    setDeclineOpen(false);
    setDeclineReason('');
    setDesignation('');
    setEmploymentType('FULL_TIME_PERMANENT');
    setDateOfJoining('');
    setWorkLocation('');
    setTerritory('');
    setMonthlyCtc('');
    setReportsToId('');
    setResponsibilities('');
    setKpis('');
  }

  /** Start a new letter for a selected candidate, seeded from their approved
   *  requisition. Every seeded value stays editable — the requisition is the
   *  hiring plan, the letter is the commitment. */
  function draftFor(applicant: AwaitingCandidate) {
    resetForm();
    setCandidate(applicant);
    setDesignation(applicant.requisition.positionTitle);
    setEmploymentType(applicant.requisition.employmentType);
    setDateOfJoining(dateInput(applicant.requisition.targetJoiningDate));
    setResponsibilities(applicant.requisition.keyResponsibilities ?? '');
    setKpis(applicant.requisition.keyPerformanceIndicators ?? '');
    // The requisition's budget is annual; the letter and the salary engine both
    // work off a monthly figure.
    setMonthlyCtc(
      applicant.requisition.budgetAnnualCtc
        ? String(Math.round(Number(applicant.requisition.budgetAnnualCtc) / 12))
        : '',
    );
  }

  /** Load an existing letter into the form. */
  const openLetter = useCallback(async (id: string) => {
    resetForm();
    try {
      const loaded = await apiFetch<OfferLetterDocument>(
        `/offer-letters/${id}`,
      );
      setOffer(loaded);
      setResponsibilities(loaded.keyResponsibilities);
      setKpis(loaded.kpis);
      setDesignation(loaded.offeredDesignation ?? '');
      if (loaded.offeredEmploymentType)
        setEmploymentType(loaded.offeredEmploymentType);
      setDateOfJoining(dateInput(loaded.offeredDateOfJoining));
      setWorkLocation(loaded.offeredWorkLocation ?? '');
      setTerritory(loaded.offeredTerritory ?? '');
      setMonthlyCtc(loaded.offeredMonthlyCtc ?? '');
      setReportsToId(loaded.reportsToId ?? '');
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Failed to load offer letter',
      );
    }
  }, []);

  /** Persist authored content + terms. Returns the refreshed letter. */
  async function persist(): Promise<OfferLetterDocument | null> {
    if (!offer && !candidate) {
      setError('Select a candidate to draft an offer for');
      return null;
    }
    if (!responsibilities.trim() || !kpis.trim()) {
      setError('Key Responsibilities and KPIs are required');
      return null;
    }
    const saved = await apiFetch<{ id: string }>('/offer-letters', {
      method: 'POST',
      body: JSON.stringify({
        ...(offer
          ? { offerLetterId: offer.id }
          : { candidateApplicationId: candidate!.id }),
        keyResponsibilities: responsibilities,
        kpis,
        // A legacy employee-anchored letter takes its terms from the Employee
        // row; sending them would be ignored, so don't.
        ...(legacy
          ? {}
          : {
              offeredDesignation: designation,
              offeredEmploymentType: employmentType,
              offeredDateOfJoining: dateOfJoining || undefined,
              offeredWorkLocation: workLocation,
              offeredTerritory: territory,
              offeredMonthlyCtc: monthlyCtc ? Number(monthlyCtc) : undefined,
              reportsToId: reportsToId || null,
            }),
      }),
    });
    // Re-read so status/approval metadata reflect any invalidation (an edit to a
    // submitted/approved letter drops it back to DRAFT server-side).
    const fresh = await apiFetch<OfferLetterDocument>(
      `/offer-letters/${saved.id}`,
    );
    setOffer(fresh);
    setCandidate(null);
    await loadRegisters();
    return fresh;
  }

  async function save() {
    setBusy('save');
    setError(null);
    const wasGated =
      status === 'PENDING_VERTICAL_APPROVAL' ||
      status === 'PENDING_CEO_APPROVAL' ||
      status === 'APPROVED';
    const wasSent = !!offer?.sentAt;
    try {
      const fresh = await persist();
      if (fresh) {
        toast.success(
          wasSent
            ? 'Saved. This edit withdrew the offer that was already out — re-approve and re-send it.'
            : wasGated
              ? 'Saved. This edit reset the letter to draft — resubmit for approval.'
              : 'Offer letter saved.',
        );
      }
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Failed to save offer letter',
      );
    } finally {
      setBusy(null);
    }
  }

  async function submitForApproval() {
    setBusy('submit');
    setError(null);
    try {
      // Save first so the snapshot freezes exactly what's on screen.
      const saved = await persist();
      if (!saved) return;
      const submitted = await apiFetch<OfferLetterDocument>(
        `/offer-letters/${saved.id}/submit`,
        { method: 'POST' },
      );
      setOffer(submitted);
      await loadRegisters();
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
      setBusy(null);
    }
  }

  /** One of the three candidate-answer transitions: send / accept / decline. */
  async function act(
    action: 'send' | 'accept' | 'decline',
    body?: Record<string, unknown>,
  ) {
    if (!offer) return;
    setBusy(action);
    setError(null);
    try {
      const updated = await apiFetch<OfferLetterDocument>(
        `/offer-letters/${offer.id}/${action}`,
        {
          method: 'POST',
          ...(body ? { body: JSON.stringify(body) } : {}),
        },
      );
      setOffer(updated);
      await loadRegisters();
      toast.success(
        action === 'send'
          ? 'Recorded as sent — the requisition is now at Offer Extended.'
          : action === 'accept'
            ? 'Acceptance recorded. This candidate can now be onboarded.'
            : 'Decline recorded. The position is open for another applicant.',
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : `Failed to ${action}`);
    } finally {
      setBusy(null);
    }
  }

  async function markSent() {
    const ok = await confirm({
      title: 'Record this offer as sent to the candidate?',
      description:
        'The requisition moves to Offer Extended and the letter is locked to what was approved — editing it afterwards withdraws the offer.',
    });
    if (ok) await act('send');
  }

  async function markAccepted() {
    const ok = await confirm({
      title: 'Record the candidate’s acceptance?',
      description:
        'This is what authorizes onboarding. The letter can no longer be edited, and the position’s application links close.',
    });
    if (ok) await act('accept');
  }

  async function markDeclined() {
    if (!declineReason.trim()) {
      setError('A reason is required to record a decline');
      return;
    }
    const ok = await confirm({
      title: 'Record that the candidate declined?',
      description:
        'The requisition returns to Interviewing so another applicant can be selected, without re-raising or re-approving it.',
      destructive: true,
    });
    if (!ok) return;
    await act('decline', { declineReason: declineReason.trim() });
    setDeclineOpen(false);
    setDeclineReason('');
  }

  function downloadApproved() {
    if (!offer || offer.status !== 'APPROVED') return;
    setDocument(offer);
    setTimeout(() => window.print(), 50);
  }

  const subjectName =
    offer?.candidateApplication?.name ??
    (offer
      ? `${offer.employee.firstName} ${offer.employee.lastName}`.trim()
      : null) ??
    candidate?.name ??
    null;
  const requisitionLabel =
    offer?.candidateRequisition ?? candidate?.requisition ?? null;

  return (
    <>
      {document && <OfferLetterPrintDocument offer={document} />}
      <SignalPage>
        <SignalHeader
          title="Offer Letters"
          description="Draft the offer for a candidate selected at interview, get it approved, send it out, then record their answer. Onboarding unlocks only once a candidate accepts."
        />
        <div className="space-y-4 px-5 pb-7 pt-[18px] lg:px-7">
          <SCard className="overflow-hidden">
            <div className="px-5 py-[18px]">
              <SCardTitle
                title="Candidates awaiting an offer"
                subtitle="Selected at interview, on an approved requisition with no live offer out"
              />
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Candidate</TableHead>
                  <TableHead>Position</TableHead>
                  <TableHead>Requisition</TableHead>
                  <TableHead>Expected CTC</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {candidates.map((applicant) => (
                  <TableRow key={applicant.id}>
                    <TableCell className="font-medium">
                      {applicant.name}
                      <span className="block text-xs text-muted-foreground">
                        {applicant.contact}
                      </span>
                    </TableCell>
                    <TableCell>{applicant.requisition.positionTitle}</TableCell>
                    <TableCell>
                      {applicant.requisition.requisitionNumber}
                      <span className="block text-xs text-muted-foreground">
                        {applicant.requisition.vertical?.name ?? '—'}
                      </span>
                    </TableCell>
                    <TableCell>
                      {formatINR(applicant.expectedCtc, numberFormatStyle)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant={
                          candidate?.id === applicant.id
                            ? 'secondary'
                            : 'outline'
                        }
                        onClick={() => draftFor(applicant)}
                      >
                        <UserPlus />
                        {candidate?.id === applicant.id
                          ? 'Drafting'
                          : 'Draft offer'}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {!candidates.length && (
                  <TableRow>
                    <TableCell colSpan={5} className="p-0">
                      <EmptyState
                        icon={UserPlus}
                        title="No candidate is waiting for an offer"
                        description="Select an applicant on an approved candidate requisition to start one."
                      />
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </SCard>

          <RegisterToolbar
            title="Offer Register"
            search={register.search}
            onSearchChange={register.setSearch}
            searchPlaceholder="Search candidate, reference, position or status"
          />
          <SCard className="overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Reference #</TableHead>
                  <TableHead>Candidate</TableHead>
                  <TableHead>Position</TableHead>
                  <TableHead>Approval</TableHead>
                  <TableHead>Candidate</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {register.visibleItems.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">
                      {row.referenceNumber}
                    </TableCell>
                    <TableCell>{row.candidateName ?? '—'}</TableCell>
                    <TableCell>
                      {row.positionTitle ?? '—'}
                      <span className="block text-xs text-muted-foreground">
                        {row.candidateRequisition?.requisitionNumber ?? '—'}
                      </span>
                    </TableCell>
                    <TableCell>
                      <StatusBadge value={row.status} />
                    </TableCell>
                    <TableCell>
                      <StatusBadge value={answerLabel(row)} />
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        {user?.role === 'SUPER_ADMIN' &&
                          (row.status === 'PENDING_CEO_APPROVAL' ||
                            (row.status === 'PENDING_VERTICAL_APPROVAL' &&
                              row.candidateRequisition?.vertical.ownerId ==
                                null)) && (
                            <Button
                              size="sm"
                              onClick={() =>
                                router.push(
                                  `/hr/offer-letters/pending-approval/${row.id}`,
                                )
                              }
                            >
                              <CheckCircle2 /> Review &amp; approve
                            </Button>
                          )}
                        <Button
                          size="sm"
                          variant={offer?.id === row.id ? 'secondary' : 'outline'}
                          onClick={() => void openLetter(row.id)}
                        >
                          {offer?.id === row.id ? 'Open' : 'Open letter'}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {!register.visibleItems.length && (
                  <TableRow>
                    <TableCell colSpan={6} className="p-0">
                      <EmptyState
                        icon={FileText}
                        title="No offer letter matches your search"
                      />
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </SCard>
          <RegisterPagination
            page={register.page}
            pageCount={register.pageCount}
            onPageChange={register.setPage}
          />

          {(offer || candidate) && (
            <SCard className="space-y-5 px-5 py-[18px]">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <SCardTitle
                    title={`${offer ? 'Offer letter' : 'New offer letter'}${
                      subjectName ? ` — ${subjectName}` : ''
                    }`}
                  />
                  <p className="mt-1 text-sm text-muted-foreground">
                    {requisitionLabel
                      ? `${requisitionLabel.requisitionNumber} · ${requisitionLabel.positionTitle}`
                      : 'No requisition linked'}
                    {offer
                      ? ` · Reference ${offer.referenceNumber}`
                      : ' · Reference generated when first saved'}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {canSuperAdminReview && (
                    <Button
                      size="sm"
                      onClick={() =>
                        router.push(
                          `/hr/offer-letters/pending-approval/${offer.id}`,
                        )
                      }
                    >
                      <CheckCircle2 /> Review &amp; approve
                    </Button>
                  )}
                  <Button variant="outline" size="sm" onClick={resetForm}>
                    Close
                  </Button>
                </div>
              </div>

              {status && <StatusPanel offer={offer!} />}
              {offer && <AnswerPanel offer={offer} />}

              {legacy ? (
                <p className="text-sm text-muted-foreground">
                  This letter is anchored to an employee record (written before
                  offers were addressed to candidates). Its designation, joining
                  date, place of posting and CTC are read from that employee
                  record, so they are edited there rather than here.
                </p>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Position offered" required>
                    <Input
                      value={designation}
                      onChange={(e) => setDesignation(e.target.value)}
                      disabled={accepted}
                      placeholder="Design Engineer"
                    />
                  </Field>
                  <Field label="Employment type" required>
                    <Select
                      value={employmentType}
                      onChange={(e) =>
                        setEmploymentType(e.target.value as EmploymentType)
                      }
                      disabled={accepted}
                    >
                      {EMPLOYMENT_TYPES.map((type) => (
                        <option key={type.value} value={type.value}>
                          {type.label}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Date of joining" required>
                    <Input
                      type="date"
                      value={dateOfJoining}
                      onChange={(e) => setDateOfJoining(e.target.value)}
                      disabled={accepted}
                    />
                  </Field>
                  <Field label="Place of posting" required>
                    <Select
                      value={workLocation}
                      onChange={(e) => setWorkLocation(e.target.value)}
                      disabled={accepted}
                    >
                      <option value="">Select a location…</option>
                      {WORK_LOCATIONS.map((location) => (
                        <option key={location} value={location}>
                          {location}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Territory" hint="Optional">
                    <Input
                      value={territory}
                      onChange={(e) => setTerritory(e.target.value)}
                      disabled={accepted}
                      placeholder="South India"
                    />
                  </Field>
                  <Field
                    label="Monthly CTC (INR)"
                    required
                    hint="Annexure A is derived from this through the same calculator onboarding uses"
                  >
                    <Input
                      type="number"
                      min={1}
                      value={monthlyCtc}
                      onChange={(e) => setMonthlyCtc(e.target.value)}
                      disabled={accepted}
                      placeholder="35195"
                    />
                    {monthlyCtc && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {formatINR(Number(monthlyCtc) * 12, numberFormatStyle)}{' '}
                        per annum
                      </p>
                    )}
                  </Field>
                  <Field
                    label="Reports to"
                    hint="Shown as “Reports To” on the letter"
                  >
                    <Select
                      value={reportsToId}
                      onChange={(e) => setReportsToId(e.target.value)}
                      disabled={accepted}
                    >
                      <option value="">No reporting manager</option>
                      {/* A letter can name someone who has since left, and the
                          roster above lists only ACTIVE staff. Keep the stored
                          manager selectable so re-saving does not quietly drop
                          the line the candidate was shown. */}
                      {reportsToId &&
                        !employees.some((m) => m.id === reportsToId) && (
                          <option value={reportsToId}>
                            {offer?.employee.reportingManager
                              ? `${offer.employee.reportingManager.firstName} ${offer.employee.reportingManager.lastName} (no longer active)`
                              : 'Current manager (no longer active)'}
                          </option>
                        )}
                      {employees.map((manager) => (
                        <option key={manager.id} value={manager.id}>
                          {manager.firstName} {manager.lastName}
                          {manager.designation
                            ? ` · ${manager.designation}`
                            : ''}{' '}
                          · {manager.employeeId}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </div>
              )}

              <Field
                label="Key Responsibilities"
                required
                hint="Enter one responsibility per line"
              >
                <Textarea
                  rows={10}
                  value={responsibilities}
                  onChange={(e) => setResponsibilities(e.target.value)}
                  disabled={accepted}
                  placeholder="Develop and execute…"
                />
                {!offer && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Pre-filled from the approved requisition. HR can edit it
                    before saving or submitting the Offer Letter.
                  </p>
                )}
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
                  disabled={accepted}
                  placeholder="Revenue achievement…"
                />
                {!offer && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Pre-filled from the approved requisition. HR can edit it
                    before saving or submitting the Offer Letter.
                  </p>
                )}
              </Field>

              {!accepted &&
                (status === 'PENDING_VERTICAL_APPROVAL' ||
                  status === 'PENDING_CEO_APPROVAL' ||
                  status === 'APPROVED') && (
                  <p className="text-sm text-muted-foreground">
                    Editing the content and saving will reset this letter to
                    draft and require a fresh approval
                    {offer?.sentAt
                      ? ' — and, because it is already out with the candidate, withdraw the offer they hold'
                      : ''}
                    .
                  </p>
                )}

              {declineOpen && (
                <Field
                  label="Reason the candidate declined"
                  required
                  hint="Recorded on the letter — it is why the position reopened"
                >
                  <Textarea
                    rows={3}
                    value={declineReason}
                    onChange={(e) => setDeclineReason(e.target.value)}
                    placeholder="Accepted a competing offer…"
                  />
                </Field>
              )}

              {error && <p className="text-sm text-destructive">{error}</p>}

              <div className="flex flex-wrap items-center justify-end gap-3 border-t pt-4">
                {!accepted && (
                  <Button
                    variant="outline"
                    disabled={!!busy}
                    onClick={() => void save()}
                  >
                    <FileText /> {busy === 'save' ? 'Saving…' : 'Save content'}
                  </Button>
                )}
                {!accepted && status !== 'APPROVED' && (
                  <Button
                    disabled={!!busy}
                    onClick={() => void submitForApproval()}
                  >
                    <Send />{' '}
                    {busy === 'submit'
                      ? 'Submitting…'
                      : status === 'PENDING_VERTICAL_APPROVAL' ||
                          status === 'PENDING_CEO_APPROVAL'
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
                {status === 'APPROVED' && !offer?.sentAt && !accepted && (
                  <Button disabled={!!busy} onClick={() => void markSent()}>
                    <Send /> {busy === 'send' ? 'Recording…' : 'Mark as sent'}
                  </Button>
                )}
                {offer?.sentAt && !accepted && !offer.declinedAt && (
                  <>
                    <Button
                      disabled={!!busy}
                      onClick={() => void markAccepted()}
                    >
                      <ThumbsUp />{' '}
                      {busy === 'accept' ? 'Recording…' : 'Candidate accepted'}
                    </Button>
                    {declineOpen ? (
                      <Button
                        variant="destructive"
                        disabled={!!busy || !declineReason.trim()}
                        onClick={() => void markDeclined()}
                      >
                        <ThumbsDown />{' '}
                        {busy === 'decline' ? 'Recording…' : 'Confirm decline'}
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        disabled={!!busy}
                        onClick={() => setDeclineOpen(true)}
                      >
                        <ThumbsDown /> Candidate declined
                      </Button>
                    )}
                  </>
                )}
              </div>
            </SCard>
          )}
        </div>
      </SignalPage>
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
  const verticalApprover = ownerName(offer.verticalApprovedBy);
  const ceoApprover = ownerName(offer.ceoApprovedBy);
  const rejecter = ownerName(offer.rejectedBy);
  const pending =
    offer.status === 'PENDING_VERTICAL_APPROVAL' ||
    offer.status === 'PENDING_CEO_APPROVAL';

  const tone =
    offer.status === 'APPROVED'
      ? 'border-[#1E9E63]/40 bg-[#3DD68C]/[.10] dark:border-[#3DD68C]/40'
      : offer.status === 'REJECTED'
        ? 'border-[#E5484D]/40 bg-[#E5484D]/[.07]'
        : pending
          ? 'border-[#C9761B] bg-[#E08A2C]/[.09] dark:border-[#E08A2C]'
          : 'border-black/10 bg-black/[.03] dark:border-white/[.08] dark:bg-white/[.03]';

  const iconTone =
    offer.status === 'APPROVED'
      ? 'text-[#1E9E63] dark:text-[#3DD68C]'
      : offer.status === 'REJECTED'
        ? 'text-[#C13438] dark:text-[#FF8A8D]'
        : pending
          ? 'text-[#C9761B] dark:text-[#E08A2C]'
          : 'text-black/45 dark:text-white/40';

  const Icon =
    offer.status === 'APPROVED'
      ? CheckCircle2
      : offer.status === 'REJECTED'
        ? XCircle
        : pending
          ? Clock
          : FileText;

  return (
    <div className={`flex gap-3 rounded-[9px] border p-4 ${tone}`}>
      <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${iconTone}`} />
      <div className="space-y-1 text-sm">
        <div className="flex items-center gap-2">
          <StatusBadge value={offer.status} />
        </div>
        {offer.status === 'DRAFT' && (
          <p className="text-muted-foreground">
            This letter is a draft. Submitting sends it
            {owner
              ? ` to ${owner} (vertical owner) for the first approval, then to the CEO`
              : ' to the CEO for approval'}{' '}
            — it can be downloaded only once fully approved.
          </p>
        )}
        {offer.status === 'PENDING_VERTICAL_APPROVAL' && (
          <p className="text-muted-foreground">
            Awaiting first approval
            {owner ? ` from ${owner} (vertical owner)` : ' from the CEO'}, then
            final approval from the CEO. The document is locked to what was
            submitted and can’t be downloaded until fully approved.
          </p>
        )}
        {offer.status === 'PENDING_CEO_APPROVAL' && (
          <p className="text-muted-foreground">
            {verticalApprover
              ? `Approved by ${verticalApprover} (vertical owner). `
              : 'Vertical approval complete. '}
            Awaiting final approval from the CEO — not downloadable until then.
          </p>
        )}
        {offer.status === 'APPROVED' && (
          <p className="text-muted-foreground">
            Approved{ceoApprover ? ` by ${ceoApprover} (CEO)` : ''}
            {verticalApprover && verticalApprover !== ceoApprover
              ? `, after ${verticalApprover} (vertical owner)`
              : ''}
            . You can now download the offer letter and send it to the
            candidate.
          </p>
        )}
        {offer.status === 'REJECTED' && (
          <div className="space-y-1">
            <p className="text-muted-foreground">
              Rejected{rejecter ? ` by ${rejecter}` : ''}. Address the feedback,
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

/**
 * The candidate's side of the letter, which our approval status says nothing
 * about: whether it has gone out, and whether they said yes. Onboarding needs an
 * approved AND accepted letter, so this panel is what tells HR why onboarding is
 * still locked.
 */
function AnswerPanel({ offer }: { offer: OfferLetterDocument }) {
  const answer = answerLabel(offer);
  const tone =
    answer === 'ACCEPTED'
      ? 'border-[#1E9E63]/40 bg-[#3DD68C]/[.10] dark:border-[#3DD68C]/40'
      : answer === 'DECLINED'
        ? 'border-[#E5484D]/40 bg-[#E5484D]/[.07]'
        : 'border-black/10 bg-black/[.03] dark:border-white/[.08] dark:bg-white/[.03]';

  return (
    <div className={`flex gap-3 rounded-[9px] border p-4 text-sm ${tone}`}>
      <div className="space-y-1">
        <StatusBadge value={answer} />
        {answer === 'NOT_SENT' && (
          <p className="text-muted-foreground">
            {offer.status === 'APPROVED'
              ? 'Approved but not yet out. Download it, send it to the candidate, then record it as sent.'
              : 'Nothing has gone to the candidate yet — an offer can only be sent once it is fully approved.'}
          </p>
        )}
        {answer === 'AWAITING_REPLY' && (
          <p className="text-muted-foreground">
            Sent to the candidate on {offer.sentAt!.slice(0, 10)}. Record their
            answer here — an acceptance is what unlocks onboarding.
          </p>
        )}
        {answer === 'ACCEPTED' && (
          <p className="text-muted-foreground">
            Accepted on {offer.acceptedAt!.slice(0, 10)}. Onboard them from the
            Onboard Employee wizard; the terms above prefill it. The letter is
            now locked — changing the terms would change what they agreed to.
          </p>
        )}
        {answer === 'DECLINED' && (
          <div className="space-y-1">
            <p className="text-muted-foreground">
              Declined on {offer.declinedAt!.slice(0, 10)}. The requisition is
              back at Interviewing, so another applicant can be selected.
            </p>
            {offer.declineReason && (
              <p className="rounded bg-background/60 px-3 py-2">
                <span className="font-medium">Reason:</span>{' '}
                {offer.declineReason}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
