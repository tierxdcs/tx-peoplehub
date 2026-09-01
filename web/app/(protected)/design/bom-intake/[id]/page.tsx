'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Check, Plus, Search, Trash2 } from 'lucide-react';
import { ApiError } from '../../../../lib/api';
import {
  DESIGN_REQUEST_STATUS_LABEL,
  findDesignBomMatches,
  getDesignBomIntake,
  handoverDesignBom,
  intakeProgress,
  type CustomerBomCandidate,
  type DesignBomIntakeDetail,
} from '../../../../lib/customer-bom-intake';
import { dateOnlyStr } from '../../../../lib/date';
import {
  Callout,
  SCard,
  SCardTitle,
  SignalHeader,
  SignalPage,
  SIGNAL_LINK,
  ToneChip,
} from '../../../../components/ui/signal';
import { Button } from '../../../../components/ui/button';
import { Input } from '../../../../components/ui/input';
import { Field } from '../../../../components/ui/field';
import { Textarea } from '../../../../components/ui/textarea';
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
  confirmCreateNew: boolean;
  searching: boolean;
  /** Keeps a resolved line's candidate list reopenable via "Change". */
  changing: boolean;
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
  confirmCreateNew: false,
  searching: false,
  changing: false,
});

const PRIORITY_TONE: Record<string, 'neutral' | 'info' | 'warning' | 'danger'> =
  {
    LOW: 'neutral',
    MEDIUM: 'info',
    HIGH: 'warning',
    CRITICAL: 'danger',
  };

export default function DesignBomIntakePage() {
  const { id } = useParams<{ id: string }>();
  const toast = useToast();
  const [detail, setDetail] = useState<DesignBomIntakeDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  // Lazy: the initialiser runs on every render otherwise, burning line keys.
  const [lines, setLines] = useState<DraftLine[]>(() => [emptyLine()]);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(
    () =>
      getDesignBomIntake(id)
        .then(setDetail)
        .catch((caught) =>
          setError(
            caught instanceof ApiError
              ? caught.message
              : 'Failed to load the request',
          ),
        )
        .finally(() => setLoading(false)),
    [id],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const patchLine = (key: number, patch: Partial<DraftLine>) =>
    setLines((current) =>
      current.map((line) => (line.key === key ? { ...line, ...patch } : line)),
    );

  async function searchLine(line: DraftLine) {
    if (line.description.trim().length < 2) {
      toast.error('Enter at least two characters before searching');
      return;
    }
    patchLine(line.key, {
      searching: true,
      existingItemId: '',
      confirmCreateNew: false,
      changing: false,
    });
    try {
      const candidates = await findDesignBomMatches(
        id,
        line.description.trim(),
      );
      patchLine(line.key, {
        searching: false,
        candidates,
        searchedDescription: line.description.trim(),
      });
    } catch (caught) {
      patchLine(line.key, { searching: false });
      toast.error(
        caught instanceof ApiError ? caught.message : 'Search failed',
      );
    }
  }

  /** Every line must be searched and then either matched or explicitly new —
   * the same discipline Sales is held to when transcribing. */
  const ready =
    lines.length > 0 &&
    lines.every(
      (line) =>
        line.description.trim() &&
        Number(line.quantity) > 0 &&
        line.unitOfMeasure.trim() &&
        line.searchedDescription === line.description.trim() &&
        !!line.existingItemId !== line.confirmCreateNew,
    );

  async function handover() {
    if (!ready) return;
    setSubmitting(true);
    try {
      const updated = await handoverDesignBom(id, {
        ...(notes.trim() ? { notes: notes.trim() } : {}),
        lines: lines.map((line) => ({
          description: line.description.trim(),
          ...(line.customerPartReference.trim()
            ? { customerPartReference: line.customerPartReference.trim() }
            : {}),
          quantity: Number(line.quantity),
          unitOfMeasure: line.unitOfMeasure.trim(),
          ...(line.existingItemId
            ? { existingItemId: line.existingItemId }
            : {}),
          confirmCreateNew: line.confirmCreateNew,
        })),
      });
      setDetail(updated);
      setLines([emptyLine()]);
      setNotes('');
      toast.success('BOM handed over — Sales and SCM can now source it');
    } catch (caught) {
      toast.error(
        caught instanceof ApiError ? caught.message : 'Handover failed',
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <SignalPage>
        <SignalHeader
          backHref="/design/bom-intake"
          backLabel="Quote BOM Requests"
          title="Loading…"
        />
        <div className="space-y-4 px-5 pb-7 pt-[18px] lg:px-7">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </SignalPage>
    );
  }

  if (error || !detail) {
    return (
      <SignalPage>
        <SignalHeader
          backHref="/design/bom-intake"
          backLabel="Quote BOM Requests"
          title="Quote BOM Request"
        />
        <div className="px-5 pb-7 pt-[18px] lg:px-7">
          <Callout variant="danger">{error ?? 'Request not found'}</Callout>
        </div>
      </SignalPage>
    );
  }

  const request = detail.designRequest;
  const owed = detail.status === 'DESIGN_PENDING';
  const progress = intakeProgress(detail.createdAt, detail.expectedBy);

  return (
    <SignalPage>
      <SignalHeader
        backHref="/design/bom-intake"
        backLabel="Quote BOM Requests"
        title={detail.productName}
        description={`${request.requestNumber} · ${detail.opportunity.name}${
          detail.opportunity.customer
            ? ` · ${detail.opportunity.customer.name}`
            : ''
        }`}
        chip={
          <div className="flex items-center gap-2">
            <ToneChip tone={PRIORITY_TONE[request.priority] ?? 'neutral'}>
              {request.priority}
            </ToneChip>
            <ToneChip tone={owed ? 'warning' : 'success'}>
              {owed ? 'BOM owed' : 'Handed over'}
            </ToneChip>
          </div>
        }
      />
      <div className="space-y-4 px-5 pb-7 pt-[18px] lg:px-7">
        <SCard className="px-5 py-[18px]">
          <SCardTitle
            title="What Sales needs designed"
            subtitle="The customer described a requirement rather than handing over a parts list."
          />
          <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <dt className="text-xs text-muted-foreground">Design request</dt>
              <dd className="font-medium">{request.title}</dd>
              <dd className="text-xs text-muted-foreground">
                {DESIGN_REQUEST_STATUS_LABEL[request.status]}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Needed by</dt>
              <dd className="font-medium tabular-nums">
                {dateOnlyStr(request.targetDate)}
              </dd>
              {progress && (
                <dd
                  className={cn(
                    'text-xs',
                    progress.overdue && owed
                      ? 'font-semibold text-destructive'
                      : 'text-muted-foreground',
                  )}
                >
                  Price promised to the customer: {progress.label}
                </dd>
              )}
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Finished good</dt>
              <dd className="font-medium">
                {detail.productName} ({detail.unitOfMeasure})
              </dd>
              <dd className="text-xs text-muted-foreground">
                {detail.businessUnit.name}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Raised by</dt>
              <dd className="font-medium">
                {detail.createdBy.firstName} {detail.createdBy.lastName}
              </dd>
              <dd className="text-xs text-muted-foreground">
                {detail.rawFileName ?? 'No customer document attached'}
              </dd>
            </div>
          </dl>
          <div className="mt-4 rounded-md bg-black/[.03] p-3.5 text-sm dark:bg-white/[.03]">
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">
              Brief from Sales
            </p>
            <p className="whitespace-pre-wrap">{request.description}</p>
          </div>
          {request.project && (
            <p className="mt-3 text-sm text-muted-foreground">
              Design project:{' '}
              <Link href="/design/projects" className={SIGNAL_LINK}>
                {request.project.projectNumber} — {request.project.name}
              </Link>{' '}
              ({request.project.status})
            </p>
          )}
        </SCard>

        {detail.bom ? (
          <SCard className="px-5 py-[18px]">
            <SCardTitle
              title={`Handed-over BOM — revision ${detail.bom.revisionNumber}`}
              subtitle="Sales and SCM can source this now. Costs land on it when the RFQ is awarded."
            />
            {detail.bom.revisionNotes && (
              <p className="mt-3 text-sm text-muted-foreground">
                {detail.bom.revisionNotes}
              </p>
            )}
            <div className="mt-4 space-y-2">
              {detail.bom.lines.map((line) => (
                <div
                  key={line.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3 text-sm"
                >
                  <span>
                    <strong>{line.item.itemCode}</strong> — {line.item.name}
                    {line.notes && (
                      <span className="block text-xs text-muted-foreground">
                        {line.notes}
                      </span>
                    )}
                  </span>
                  <span className="tabular-nums text-muted-foreground">
                    {line.quantityPerUnit} {line.unitOfMeasure} per{' '}
                    {detail.unitOfMeasure}
                  </span>
                </div>
              ))}
            </div>
          </SCard>
        ) : null}

        {owed && (
          <SCard className="px-5 py-[18px]">
            <SCardTitle
              title="Author the BOM"
              subtitle="Search Item Master for every part before matching it or explicitly creating a new component. Handing over flips the intake to Sales and SCM immediately."
              right={
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    setLines((current) => [...current, emptyLine()])
                  }
                >
                  <Plus className="size-4" /> Add part
                </Button>
              }
            />
            {request.status === 'REJECTED' && (
              <Callout variant="warning" className="mt-4">
                This design request was rejected. Talk to Sales before handing a
                BOM over — they may need to re-raise it.
              </Callout>
            )}
            <div className="mt-4 space-y-4">
              {lines.map((line, index) => {
                const pickedCandidate =
                  line.candidates.find(
                    (candidate) => candidate.id === line.existingItemId,
                  ) ?? null;
                const resolved = !!pickedCandidate || line.confirmCreateNew;
                const showCandidates =
                  !!line.searchedDescription && (!resolved || line.changing);
                return (
                  <div key={line.key} className="rounded-lg border p-4">
                    <div className="mb-3 flex items-center justify-between">
                      <strong className="text-sm">Part {index + 1}</strong>
                      {lines.length > 1 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() =>
                            setLines((current) =>
                              current.filter((item) => item.key !== line.key),
                            )
                          }
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      )}
                    </div>
                    <div className="grid gap-3 md:grid-cols-[2fr_1fr_0.7fr_0.8fr_auto]">
                      <Field label="Description" required>
                        <Input
                          value={line.description}
                          onChange={(event) =>
                            patchLine(line.key, {
                              description: event.target.value,
                              searchedDescription: null,
                              candidates: [],
                              existingItemId: '',
                              confirmCreateNew: false,
                              changing: false,
                            })
                          }
                        />
                      </Field>
                      <Field label="Drawing / part ref">
                        <Input
                          value={line.customerPartReference}
                          onChange={(event) =>
                            patchLine(line.key, {
                              customerPartReference: event.target.value,
                            })
                          }
                        />
                      </Field>
                      <Field label={`Qty per ${detail.unitOfMeasure}`} required>
                        <Input
                          type="number"
                          min="0.0001"
                          step="any"
                          value={line.quantity}
                          onChange={(event) =>
                            patchLine(line.key, {
                              quantity: event.target.value,
                            })
                          }
                        />
                      </Field>
                      <Field label="Unit" required>
                        <Input
                          value={line.unitOfMeasure}
                          onChange={(event) =>
                            patchLine(line.key, {
                              unitOfMeasure: event.target.value,
                            })
                          }
                        />
                      </Field>
                      <div className="pt-6">
                        <Button
                          type="button"
                          variant="outline"
                          disabled={line.searching}
                          onClick={() => void searchLine(line)}
                        >
                          <Search className="size-4" />{' '}
                          {line.searching ? 'Searching' : 'Search'}
                        </Button>
                      </div>
                    </div>
                    {showCandidates && (
                      <div className="mt-3 rounded-md bg-black/[.03] p-3 text-sm dark:bg-white/[.03]">
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <p className="font-medium">
                            Candidate Item Master matches
                          </p>
                          {line.changing && (
                            // Re-clicking the selected radio fires no change
                            // event, so reopening needs its own way back out.
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() =>
                                patchLine(line.key, { changing: false })
                              }
                            >
                              Cancel
                            </Button>
                          )}
                        </div>
                        {line.candidates.length ? (
                          line.candidates.map((candidate) => (
                            <label
                              key={candidate.id}
                              className={cn(
                                'mb-2 flex cursor-pointer items-center gap-2 rounded border p-2',
                                line.existingItemId === candidate.id &&
                                  'border-primary bg-primary/[.08]',
                              )}
                            >
                              <input
                                type="radio"
                                name={`resolution-${line.key}`}
                                checked={line.existingItemId === candidate.id}
                                onChange={() =>
                                  patchLine(line.key, {
                                    existingItemId: candidate.id,
                                    confirmCreateNew: false,
                                    changing: false,
                                  })
                                }
                              />
                              <span>
                                <strong>{candidate.itemCode}</strong> —{' '}
                                {candidate.name}{' '}
                                <span className="text-xs text-muted-foreground">
                                  ({Math.round(candidate.score * 100)}% match)
                                </span>
                              </span>
                            </label>
                          ))
                        ) : (
                          <p className="mb-2 text-muted-foreground">
                            No likely matches found.
                          </p>
                        )}
                        <label
                          className={cn(
                            'flex cursor-pointer items-center gap-2 rounded border border-dashed p-2',
                            line.confirmCreateNew &&
                              'border-primary bg-primary/[.08]',
                          )}
                        >
                          <input
                            type="radio"
                            name={`resolution-${line.key}`}
                            checked={line.confirmCreateNew}
                            onChange={() =>
                              patchLine(line.key, {
                                existingItemId: '',
                                confirmCreateNew: true,
                                changing: false,
                              })
                            }
                          />
                          None of these match — create a new Component item
                        </label>
                      </div>
                    )}
                    {resolved && !line.changing && (
                      // Collapsed confirmation: the list closing and this line
                      // naming the pick is the only signal the choice registered.
                      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-primary/40 bg-primary/[.06] p-3 text-sm">
                        <span className="flex items-center gap-2">
                          <Check className="size-4 shrink-0 text-primary" />
                          {pickedCandidate ? (
                            <span>
                              Matched to{' '}
                              <strong>{pickedCandidate.itemCode}</strong> —{' '}
                              {pickedCandidate.name}
                            </span>
                          ) : (
                            <span>
                              New Component item will be created for{' '}
                              <strong>{line.searchedDescription}</strong>
                            </span>
                          )}
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            patchLine(line.key, { changing: true })
                          }
                        >
                          Change
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })}
              <Field
                label="Revision notes (optional)"
                hint="What you designed, and anything SCM should know when sourcing it."
              >
                <Textarea
                  rows={3}
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                />
              </Field>
              <div className="flex justify-end">
                <Button
                  disabled={!ready || submitting}
                  onClick={() => void handover()}
                >
                  {submitting ? 'Handing over…' : 'Hand over BOM'}
                </Button>
              </div>
            </div>
          </SCard>
        )}
      </div>
    </SignalPage>
  );
}
