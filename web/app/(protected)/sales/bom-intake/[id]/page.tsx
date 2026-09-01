'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { PencilRuler, Plus, Search, Trash2 } from 'lucide-react';
import { ApiError } from '../../../../lib/api';
import {
  DESIGN_REQUEST_STATUS_LABEL,
  findCustomerBomMatches,
  getBomIntake,
  intakeStatusLabel,
  intakeStatusTone,
  reviseBomIntake,
  sendBomIntakeToDesign,
  setBomIntakeExpectedBy,
  submitBomIntakeForApproval,
  type BomIntakeDetail,
  type CustomerBomCandidate,
} from '../../../../lib/customer-bom-intake';
import { dateOnlyStr } from '../../../../lib/date';
import {
  ApprovedQuoteIndicator,
  IntakeProgressBar,
} from '../../_components/intake-progress';
import { formatINR } from '../../../../lib/sales';
import { useNumberFormat } from '../../../../lib/number-format-context';
import {
  Callout,
  SCard,
  SCardTitle,
  SIGNAL_BTN_PRIMARY,
  SIGNAL_LINK,
  SIGNAL_ROW_DIVIDER,
  SIGNAL_TABLE_HEAD,
  SignalChip,
  SignalHeader,
  SignalPage,
  ToneChip,
} from '../../../../components/ui/signal';
import { Button } from '../../../../components/ui/button';
import { Input } from '../../../../components/ui/input';
import { Field } from '../../../../components/ui/field';
import { Textarea } from '../../../../components/ui/textarea';
import { Select } from '../../../../components/ui/select';
import { Skeleton } from '../../../../components/ui/skeleton';
import { useToast } from '../../../../components/ui/toaster';
import { cn } from '../../../../lib/utils';

interface DraftLine {
  key: number;
  description: string;
  customerPartReference: string;
  quantity: string;
  unitOfMeasure: string;
  searchedDescription: string | null;
  candidates: CustomerBomCandidate[];
  existingItemId: string;
  /** Label shown for a pre-resolved line seeded from the current revision. */
  existingItemLabel: string | null;
  confirmCreateNew: boolean;
  searching: boolean;
}

let lineKey = 1;
const emptyLine = (): DraftLine => ({
  key: lineKey++,
  description: '',
  customerPartReference: '',
  quantity: '1',
  unitOfMeasure: 'each',
  searchedDescription: null,
  candidates: [],
  existingItemId: '',
  existingItemLabel: null,
  confirmCreateNew: false,
  searching: false,
});

const LINE_GRID =
  'grid grid-cols-[26px_1fr_120px_90px_110px_32px] items-center gap-2.5 px-5';

export default function BomIntakeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const toast = useToast();
  const { style: numberFormatStyle } = useNumberFormat();
  const [detail, setDetail] = useState<BomIntakeDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [revisionNotes, setRevisionNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [expectedBy, setExpectedBy] = useState('');
  const [savingExpectedBy, setSavingExpectedBy] = useState(false);
  // The design brief, for an intake raised without a parts list.
  const [designDescription, setDesignDescription] = useState('');
  const [designPriority, setDesignPriority] = useState('MEDIUM');
  const [designTargetDate, setDesignTargetDate] = useState('');
  const [sendingToDesign, setSendingToDesign] = useState(false);

  const load = useCallback(() => {
    return getBomIntake(id)
      .then(setDetail)
      .catch(() => setError('Failed to load BOM intake request'))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setExpectedBy(detail?.expectedBy ? dateOnlyStr(detail.expectedBy) : '');
  }, [detail?.expectedBy]);

  /**
   * Waiting on design and not yet handed to them: the brief is still owed. Once
   * a request exists the card turns into its status instead.
   */
  const awaitingDesignBrief =
    detail?.status === 'DESIGN_PENDING' && !detail?.designRequest;

  async function sendToDesign() {
    if (!detail) return;
    if (designDescription.trim().length < 20) {
      toast.error(
        'Describe what the customer asked for — the design team works from this brief (at least 20 characters)',
      );
      return;
    }
    if (!designTargetDate && !detail.expectedBy) {
      toast.error(
        'Set a target date for the design work, or a promised date on this intake',
      );
      return;
    }
    setSendingToDesign(true);
    try {
      setDetail(
        await sendBomIntakeToDesign(detail.id, {
          description: designDescription.trim(),
          priority: designPriority,
          ...(designTargetDate
            ? { targetDate: `${designTargetDate}T00:00:00.000Z` }
            : {}),
        }),
      );
      toast.success('Design request raised');
    } catch (err) {
      toast.error(
        err instanceof ApiError
          ? err.message
          : 'Failed to raise the design request',
      );
    } finally {
      setSendingToDesign(false);
    }
  }

  const bomStatus = detail?.bom?.status ?? null;
  const canSelfRevise = bomStatus === 'DRAFT' || bomStatus === 'REJECTED';
  // Same states Sales may revise in are the states Sales may submit from — but
  // an empty BOM is rejected server-side, so don't offer the action for one.
  const canSubmit = canSelfRevise && (detail?.bom?.lines.length ?? 0) > 0;

  async function submitForApproval() {
    if (!detail) return;
    setSubmitting(true);
    try {
      setDetail(await submitBomIntakeForApproval(detail.id));
      toast.success('Sent to R&D for approval');
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : 'Failed to submit for approval',
      );
    } finally {
      setSubmitting(false);
    }
  }

  /**
   * The promised date is usually agreed after the transcription is already in,
   * so it saves on its own the moment it's picked — no form to submit.
   */
  async function saveExpectedBy(value: string) {
    setExpectedBy(value);
    setSavingExpectedBy(true);
    try {
      setDetail(
        // Date-only, stored at UTC midnight so it reads back as the same day.
        await setBomIntakeExpectedBy(
          id,
          value ? `${value}T00:00:00.000Z` : null,
        ),
      );
      toast.success(value ? 'Promised date saved' : 'Promised date cleared');
    } catch (err) {
      setExpectedBy(detail?.expectedBy ? dateOnlyStr(detail.expectedBy) : '');
      toast.error(
        err instanceof ApiError
          ? err.message
          : 'Failed to save the promised date',
      );
    } finally {
      setSavingExpectedBy(false);
    }
  }

  function startEditing() {
    if (!detail?.bom) return;
    // Seed the editor from the CURRENT revision's lines — already resolved to
    // real items, so no re-search is needed unless the line is replaced.
    setLines(
      detail.bom.lines.map((line) => ({
        ...emptyLine(),
        description: line.item.name,
        customerPartReference: line.notes ?? '',
        quantity: line.quantityPerUnit,
        unitOfMeasure: line.unitOfMeasure,
        existingItemId: line.item.id,
        existingItemLabel: `${line.item.itemCode} — ${line.item.name}`,
      })),
    );
    setRevisionNotes('');
    setEditing(true);
  }

  function patchLine(key: number, patch: Partial<DraftLine>) {
    setLines((prev) =>
      prev.map((line) => (line.key === key ? { ...line, ...patch } : line)),
    );
  }

  async function searchLine(line: DraftLine) {
    if (!detail || line.description.trim().length < 2) {
      toast.error('Enter a description (at least 2 characters) to search');
      return;
    }
    patchLine(line.key, { searching: true });
    try {
      const candidates = await findCustomerBomMatches(
        detail.opportunity.id,
        line.description.trim(),
      );
      patchLine(line.key, {
        candidates,
        searchedDescription: line.description.trim(),
        existingItemId: '',
        existingItemLabel: null,
        confirmCreateNew: false,
      });
    } catch {
      toast.error('Item search failed');
    } finally {
      patchLine(line.key, { searching: false });
    }
  }

  async function saveRevision() {
    if (!detail) return;
    if (revisionNotes.trim().length < 3) {
      toast.error(
        'Describe what changed — it becomes the revision history entry',
      );
      return;
    }
    const invalid = lines.some(
      (line) =>
        !line.description.trim() ||
        !(Number(line.quantity) > 0) ||
        !line.unitOfMeasure.trim() ||
        !!line.existingItemId === line.confirmCreateNew,
    );
    if (lines.length === 0 || invalid) {
      toast.error(
        'Every line needs a description, quantity, unit, and either a selected Item Master match or explicit confirmation of a new item',
      );
      return;
    }
    setSaving(true);
    try {
      await reviseBomIntake(detail.id, {
        revisionNotes: revisionNotes.trim(),
        lines: lines.map((line) => ({
          description: line.description.trim(),
          customerPartReference: line.customerPartReference.trim() || undefined,
          quantity: Number(line.quantity),
          unitOfMeasure: line.unitOfMeasure.trim(),
          ...(line.existingItemId
            ? { existingItemId: line.existingItemId }
            : {}),
          confirmCreateNew: line.confirmCreateNew,
        })),
      });
      toast.success('New revision created');
      setEditing(false);
      await load();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : 'Failed to create revision',
      );
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <SignalPage>
        <div className="px-5 py-[18px] lg:px-7">
          <Skeleton className="h-96 w-full" />
        </div>
      </SignalPage>
    );
  }
  if (error || !detail) {
    return (
      <SignalPage>
        <SignalHeader
          backHref="/sales/bom-intake"
          backLabel="BOM Intake"
          title="BOM intake request"
        />
        <div className="px-5 py-[18px] lg:px-7">
          <p className="text-sm text-destructive">
            {error ?? 'BOM intake request not found'}
          </p>
        </div>
      </SignalPage>
    );
  }

  return (
    <SignalPage>
      <SignalHeader
        backHref="/sales/bom-intake"
        backLabel="BOM Intake"
        title={detail.productName}
        chip={
          <>
            <ToneChip tone={intakeStatusTone(detail)}>
              {intakeStatusLabel(detail)}
            </ToneChip>
            {detail.bom && (
              <SignalChip>Rev {detail.bom.revisionNumber}</SignalChip>
            )}
          </>
        }
        description={`${detail.opportunity.name}${detail.opportunity.customer ? ` · ${detail.opportunity.customer.name}` : ''} · ${detail.businessUnit.name}${detail.rawFileName ? ` · from ${detail.rawFileName}` : ' · manually entered'}`}
        actions={
          canSelfRevise && !editing ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" onClick={startEditing}>
                New revision
              </Button>
              {/* Sales owns "the transcription is finished", so Sales hands it
                  over — this is the forward motion, hence the primary slot. */}
              {canSubmit && (
                <button
                  type="button"
                  onClick={() => void submitForApproval()}
                  disabled={submitting}
                  className={SIGNAL_BTN_PRIMARY}
                >
                  {submitting
                    ? 'Sending…'
                    : bomStatus === 'REJECTED'
                      ? 'Resubmit for approval'
                      : 'Submit for approval'}
                </button>
              )}
            </div>
          ) : undefined
        }
      />

      <div className="grid items-start gap-4 px-5 pb-7 pt-[18px] lg:px-7 xl:grid-cols-[1fr_316px]">
        <div className="flex min-w-0 flex-col gap-3.5">
          {/* The design route: no parts list arrived, so no BOM exists yet and
              SCM cannot see this intake until the design team hands one over. */}
          {awaitingDesignBrief && (
            <SCard className="px-5 py-[18px]">
              <SCardTitle
                title="Send to the design team"
                subtitle="The customer stated a requirement, not a parts list — the design team designs the product and authors the BOM."
              />
              <div className="mt-3.5 space-y-3.5">
                <Field
                  label="What the customer asked for"
                  required
                  hint="The only thing the design team cannot work out for itself. Application, environment, ratings, quantities, constraints, anything the customer specified."
                >
                  <Textarea
                    rows={5}
                    value={designDescription}
                    onChange={(event) =>
                      setDesignDescription(event.target.value)
                    }
                    placeholder="Customer needs a platform-mounted emergency kiosk for outdoor use, IP65, 24 V supply, with…"
                  />
                </Field>
                <div className="grid gap-3.5 md:grid-cols-2">
                  <Field label="Priority">
                    <Select
                      value={designPriority}
                      onChange={(event) =>
                        setDesignPriority(event.target.value)
                      }
                    >
                      {['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map((priority) => (
                        <option key={priority} value={priority}>
                          {priority.charAt(0) + priority.slice(1).toLowerCase()}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field
                    label="Design needed by"
                    hint={
                      detail.expectedBy
                        ? `Defaults to the promised date, ${dateOnlyStr(detail.expectedBy)}`
                        : 'No promised date is set on this intake, so a date is required here'
                    }
                  >
                    <Input
                      type="date"
                      value={designTargetDate}
                      onChange={(event) =>
                        setDesignTargetDate(event.target.value)
                      }
                    />
                  </Field>
                </div>
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => void sendToDesign()}
                    disabled={sendingToDesign}
                    className={SIGNAL_BTN_PRIMARY}
                  >
                    {sendingToDesign ? 'Raising\u2026' : 'Send to design team'}
                  </button>
                </div>
              </div>
            </SCard>
          )}

          {detail.status === 'DESIGN_PENDING' && detail.designRequest && (
            <SCard className="px-5 py-[18px]">
              <SCardTitle
                title="With the design team"
                subtitle="This intake becomes available to SCM for RFQ the moment the designed BOM is handed over."
                right={
                  <ToneChip
                    tone={
                      detail.designRequest.status === 'REJECTED'
                        ? 'danger'
                        : detail.designRequest.status === 'OPEN'
                          ? 'warning'
                          : 'info'
                    }
                  >
                    {DESIGN_REQUEST_STATUS_LABEL[detail.designRequest.status]}
                  </ToneChip>
                }
              />
              <div className="mt-3.5 flex gap-2.5 rounded-lg border border-primary/40 bg-primary/[.06] p-3.5 text-[12.5px]">
                <PencilRuler className="mt-0.5 size-4 shrink-0 text-primary" />
                <div className="space-y-1">
                  <p>
                    <strong>{detail.designRequest.requestNumber}</strong> \u00b7{' '}
                    {detail.designRequest.title}
                  </p>
                  <p className="text-black/55 dark:text-white/50">
                    Needed by{' '}
                    {new Date(
                      detail.designRequest.targetDate,
                    ).toLocaleDateString('en-IN')}
                    {detail.designRequest.project
                      ? ` \u00b7 project ${detail.designRequest.project.projectNumber} (${detail.designRequest.project.status.replaceAll('_', ' ').toLowerCase()})`
                      : ''}
                  </p>
                </div>
              </div>
            </SCard>
          )}

          {bomStatus === 'RELEASED' && (
            <Callout className="mt-0">
              This BOM has been released by R&D — it is now a formal engineering
              document and Sales can no longer self-revise it. Request changes
              through the{' '}
              {detail.bom ? (
                <Link
                  href={`/scm/bom/${detail.bom.id}`}
                  className={SIGNAL_LINK}
                >
                  engineering BOM revision &amp; approval flow
                </Link>
              ) : (
                'engineering BOM revision & approval flow'
              )}
              .
            </Callout>
          )}
          {bomStatus === 'PENDING_APPROVAL' && (
            <Callout className="mt-0">
              This BOM is awaiting R&D approval — revisions are paused until R&D
              approves or rejects it.
            </Callout>
          )}
          {bomStatus === 'REJECTED' && (
            <Callout className="mt-0">
              R&D rejected this revision
              {detail.bom?.rejectionComment
                ? `: ${detail.bom.rejectionComment}`
                : '.'}{' '}
              Revise the lines and resubmit, or resubmit as-is if nothing needs
              to change.
            </Callout>
          )}

          {/* Current revision lines. */}
          {detail.bom && !editing && (
            <SCard className="overflow-hidden">
              <div className="flex flex-wrap items-center gap-2.5 px-5 pb-3.5 pt-[18px]">
                <span className="text-[14px] font-bold">
                  Current revision — Rev {detail.bom.revisionNumber}
                </span>
                <span className="ml-auto text-[11.5px] text-black/40 dark:text-white/35">
                  {detail.bom.lines.length}{' '}
                  {detail.bom.lines.length === 1 ? 'component' : 'components'}
                </span>
              </div>
              <div
                className={cn(
                  'grid grid-cols-[26px_1fr_110px_90px] items-center gap-2.5 px-5 py-[9px]',
                  SIGNAL_TABLE_HEAD,
                )}
              >
                <span>#</span>
                <span>Component</span>
                <span className="text-right">Qty / unit</span>
                <span>Ref</span>
              </div>
              {detail.bom.lines.map((line, index) => (
                <div
                  key={line.id}
                  className={cn(
                    'grid grid-cols-[26px_1fr_110px_90px] items-center gap-2.5 px-5 py-2.5',
                    index > 0 && `border-t ${SIGNAL_ROW_DIVIDER}`,
                  )}
                >
                  <span className="text-[11.5px] font-semibold tabular-nums text-black/40 dark:text-white/35">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <span className="truncate text-[13px]">
                    <strong>{line.item.itemCode}</strong> — {line.item.name}
                  </span>
                  <span className="text-right text-[13px] tabular-nums">
                    {Number(line.quantityPerUnit)} {line.unitOfMeasure}
                  </span>
                  <span className="truncate text-[12px] text-black/45 dark:text-white/40">
                    {line.notes ?? '—'}
                  </span>
                </div>
              ))}
            </SCard>
          )}

          {/* Revision editor. */}
          {editing && (
            <SCard className="overflow-hidden">
              <div className="flex flex-wrap items-center gap-2.5 px-5 pb-3.5 pt-[18px]">
                <span className="text-[14px] font-bold">
                  New revision (from Rev {detail.bom?.revisionNumber})
                </span>
                <span className="ml-auto text-[11.5px] text-black/40 dark:text-white/35">
                  Prior revisions are preserved unchanged in history
                </span>
              </div>
              <div className={cn(LINE_GRID, SIGNAL_TABLE_HEAD, 'py-[9px]')}>
                <span>#</span>
                <span>Component description</span>
                <span>Customer ref</span>
                <span className="text-right">Qty</span>
                <span>Unit</span>
                <span />
              </div>
              {lines.map((line, index) => (
                <div
                  key={line.key}
                  className={cn(index > 0 && `border-t ${SIGNAL_ROW_DIVIDER}`)}
                >
                  <div className={cn(LINE_GRID, 'pb-1 pt-[11px]')}>
                    <span className="text-[11.5px] font-semibold tabular-nums text-black/40 dark:text-white/35">
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    <Input
                      value={line.description}
                      onChange={(event) =>
                        patchLine(line.key, { description: event.target.value })
                      }
                      placeholder="Component description"
                    />
                    <Input
                      value={line.customerPartReference}
                      onChange={(event) =>
                        patchLine(line.key, {
                          customerPartReference: event.target.value,
                        })
                      }
                      placeholder="Part ref"
                    />
                    <Input
                      type="number"
                      min="0.0001"
                      step="any"
                      className="text-right tabular-nums"
                      value={line.quantity}
                      onChange={(event) =>
                        patchLine(line.key, { quantity: event.target.value })
                      }
                    />
                    <Input
                      value={line.unitOfMeasure}
                      onChange={(event) =>
                        patchLine(line.key, {
                          unitOfMeasure: event.target.value,
                        })
                      }
                      placeholder="each"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setLines((prev) =>
                          prev.filter((l) => l.key !== line.key),
                        )
                      }
                      aria-label="Remove line"
                      className="grid size-8 place-items-center justify-self-center rounded-md text-black/35 hover:bg-black/5 hover:text-black/70 dark:text-white/35 dark:hover:bg-white/5 dark:hover:text-white/70"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                  <div className="px-5 pb-3 pl-[56px]">
                    {line.existingItemId && line.existingItemLabel ? (
                      <p className="text-[11px] text-black/45 dark:text-white/40">
                        Resolved to <strong>{line.existingItemLabel}</strong> —
                        edit the description and search again to change it.
                      </p>
                    ) : (
                      <>
                        <div className="flex flex-wrap items-center gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={line.searching}
                            onClick={() => void searchLine(line)}
                          >
                            <Search className="size-4" />{' '}
                            {line.searching
                              ? 'Searching…'
                              : 'Search Item Master'}
                          </Button>
                          {line.searchedDescription && (
                            <label className="flex cursor-pointer items-center gap-2 text-[12px]">
                              <input
                                type="checkbox"
                                checked={line.confirmCreateNew}
                                onChange={(event) =>
                                  patchLine(line.key, {
                                    confirmCreateNew: event.target.checked,
                                    existingItemId: '',
                                    existingItemLabel: null,
                                  })
                                }
                              />
                              No match — create a new item
                            </label>
                          )}
                        </div>
                        {line.searchedDescription && (
                          <div className="mt-2 space-y-1.5">
                            {line.candidates.length === 0 && (
                              <p className="text-[12px] text-black/40 dark:text-white/[.32]">
                                No likely Item Master matches found.
                              </p>
                            )}
                            {line.candidates.map((candidate) => (
                              <label
                                key={candidate.id}
                                className={cn(
                                  'flex cursor-pointer items-center gap-2 rounded-md border p-2 text-[12.5px]',
                                  'border-black/10 dark:border-white/[.08]',
                                )}
                              >
                                <input
                                  type="radio"
                                  name={`resolution-${line.key}`}
                                  checked={line.existingItemId === candidate.id}
                                  onChange={() =>
                                    patchLine(line.key, {
                                      existingItemId: candidate.id,
                                      existingItemLabel: `${candidate.itemCode} — ${candidate.name}`,
                                      confirmCreateNew: false,
                                    })
                                  }
                                />
                                <span>
                                  <strong>{candidate.itemCode}</strong> —{' '}
                                  {candidate.name}{' '}
                                  <span className="text-black/40 dark:text-white/35">
                                    ({Math.round(candidate.score * 100)}%)
                                  </span>
                                </span>
                              </label>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              ))}
              <div className="flex flex-wrap items-center gap-2.5 border-t border-black/10 bg-black/[.02] px-5 py-3 dark:border-white/[.08] dark:bg-white/[.02]">
                <button
                  type="button"
                  onClick={() => setLines((prev) => [...prev, emptyLine()])}
                  className="inline-flex items-center gap-1 rounded-lg border border-dashed border-black/25 px-3 py-[7px] text-[12px] font-semibold text-black/70 hover:bg-black/[.03] dark:border-white/[.22] dark:text-white/70 dark:hover:bg-white/[.04]"
                >
                  <Plus className="size-3.5" /> Add component
                </button>
              </div>
              <div className="space-y-3 border-t border-black/10 px-5 py-4 dark:border-white/[.08]">
                <Field
                  label="What changed"
                  required
                  hint="Becomes this revision's history entry (e.g. “Added missed busbar, qty 2”)."
                >
                  <Textarea
                    value={revisionNotes}
                    onChange={(event) => setRevisionNotes(event.target.value)}
                    rows={2}
                  />
                </Field>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void saveRevision()}
                    disabled={saving}
                    className={SIGNAL_BTN_PRIMARY}
                  >
                    {saving
                      ? 'Saving…'
                      : `Create Rev ${(detail.bom?.revisionNumber ?? 0) + 1}`}
                  </button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setEditing(false)}
                    disabled={saving}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            </SCard>
          )}
        </div>

        {/* ── Rail ── */}
        <div className="flex flex-col gap-3.5 xl:sticky xl:top-[4.5rem]">
          <SCard className="px-5 py-[18px]">
            <SCardTitle
              title="Promised turnaround"
              subtitle="Raised → the date the customer expects a price"
            />
            <div className="mt-3 space-y-3.5">
              <IntakeProgressBar
                createdAt={detail.createdAt}
                expectedBy={detail.expectedBy}
              />
              <Field label="Price promised by">
                <Input
                  type="date"
                  value={expectedBy}
                  disabled={savingExpectedBy}
                  onChange={(event) => void saveExpectedBy(event.target.value)}
                />
              </Field>
              <div>
                <p className="mb-1 text-[11px] uppercase tracking-wide text-black/40 dark:text-white/[.32]">
                  Approved quote
                </p>
                <ApprovedQuoteIndicator
                  approvedQuote={detail.approvedQuote}
                  awaiting={detail.derivedStatus === 'RFQ_FLOATED'}
                />
              </div>
            </div>
          </SCard>

          {detail.status !== 'DESIGN_PENDING' && detail.designRequest && (
            <SCard className="px-5 py-[18px]">
              <SCardTitle
                title="Designed in-house"
                subtitle="This BOM was authored by the design team, not transcribed"
              />
              <div className="mt-3 space-y-1 text-[12.5px]">
                <p>
                  <strong>{detail.designRequest.requestNumber}</strong>
                </p>
                <p className="text-black/55 dark:text-white/50">
                  {detail.designRequest.title}
                </p>
                {detail.designRequest.project && (
                  <p className="text-[11px] text-black/45 dark:text-white/40">
                    Design project {detail.designRequest.project.projectNumber}
                  </p>
                )}
              </div>
            </SCard>
          )}

          <SCard className="px-5 py-[18px]">
            <SCardTitle title="Revision history" />
            <div className="mt-3 flex flex-col">
              {detail.revisions.map((revision, index) => (
                <div
                  key={revision.id}
                  className={cn(
                    'py-2.5',
                    index > 0 && `border-t ${SIGNAL_ROW_DIVIDER}`,
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-[12.5px] font-semibold tabular-nums">
                      Rev {revision.revisionNumber}
                    </span>
                    <ToneChip
                      tone={
                        revision.status === 'RELEASED'
                          ? 'success'
                          : revision.status === 'PENDING_APPROVAL'
                            ? 'warning'
                            : revision.status === 'REJECTED'
                              ? 'danger'
                              : 'neutral'
                      }
                    >
                      {revision.status.replaceAll('_', ' ')}
                    </ToneChip>
                  </div>
                  {revision.revisionNotes && (
                    <p className="mt-1 text-[12px] text-black/60 dark:text-white/55">
                      {revision.revisionNotes}
                    </p>
                  )}
                  <p className="mt-1 text-[11px] text-black/45 dark:text-white/40">
                    {revision.createdBy.firstName} {revision.createdBy.lastName}{' '}
                    · {new Date(revision.createdAt).toLocaleString('en-IN')}
                  </p>
                </div>
              ))}
            </div>
          </SCard>

          <SCard className="px-5 py-[18px]">
            <SCardTitle title="RFQs" subtitle="Floated from this intake" />
            {detail.rfqs.length === 0 ? (
              <p className="mt-3 text-[12px] text-black/40 dark:text-white/[.32]">
                No RFQs floated yet.
              </p>
            ) : (
              <div className="mt-3 flex flex-col">
                {detail.rfqs.map((rfq, index) => (
                  <div
                    key={rfq.id}
                    className={cn(
                      'py-2.5',
                      index > 0 && `border-t ${SIGNAL_ROW_DIVIDER}`,
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <Link
                        href={`/scm/rfqs/${rfq.id}`}
                        className={cn('text-[12.5px]', SIGNAL_LINK)}
                      >
                        {rfq.rfqNumber}
                      </Link>
                      <ToneChip
                        tone={
                          rfq.status === 'AWARDED'
                            ? 'success'
                            : rfq.status === 'ISSUED'
                              ? 'info'
                              : rfq.status === 'CANCELLED'
                                ? 'danger'
                                : 'neutral'
                        }
                      >
                        {rfq.status}
                      </ToneChip>
                    </div>
                    <p className="mt-1 text-[11px] text-black/45 dark:text-white/40">
                      {rfq.createdBy.firstName} {rfq.createdBy.lastName} ·{' '}
                      {new Date(rfq.createdAt).toLocaleDateString('en-IN')}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </SCard>

          {(detail.liveBomCostEstimate || detail.suggestedUnitPrice) && (
            <SCard className="px-5 py-[18px]">
              <SCardTitle
                title="Quote-stage pricing"
                subtitle="Live estimate — never persisted"
              />
              <div className="mt-3 space-y-1 text-[12.5px]">
                {detail.liveBomCostEstimate && (
                  <p>
                    BOM cost estimate:{' '}
                    <strong className="tabular-nums">
                      {formatINR(
                        Number(detail.liveBomCostEstimate),
                        numberFormatStyle,
                      )}
                    </strong>
                  </p>
                )}
                {detail.suggestedUnitPrice && (
                  <p>
                    Suggested unit price:{' '}
                    <strong className="tabular-nums">
                      {formatINR(
                        Number(detail.suggestedUnitPrice),
                        numberFormatStyle,
                      )}
                    </strong>
                  </p>
                )}
              </div>
            </SCard>
          )}
        </div>
      </div>
    </SignalPage>
  );
}
