'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft,
  ShieldCheck,
  Lock,
  AlertTriangle,
  PackageX,
  ClipboardList,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import { ApiError } from '../../../../../lib/api';
import { useIsQcInspector } from '../../../../../lib/use-is-qc-inspector';
import {
  getGrn,
  finalizeQc,
  listGrnInspectionTemplates,
  type GoodsReceiptNote,
  type GrnInspectionTemplate,
  type QcInspectionLineInput,
} from '../../../../../lib/stores';
import {
  CHOICE_OPTIONS,
  checklistState,
  isChoiceQuestion,
  isNumericQuestion,
  questionResult,
  type InspectionQuestion,
} from '../../../../../lib/incoming-inspection';
import { PageContainer } from '../../../../../components/ui/page-container';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '../../../../../components/ui/card';
import { Badge } from '../../../../../components/ui/badge';
import { Button } from '../../../../../components/ui/button';
import { Input } from '../../../../../components/ui/input';
import { Select } from '../../../../../components/ui/select';
import { Textarea } from '../../../../../components/ui/textarea';
import { Skeleton } from '../../../../../components/ui/skeleton';
import { StatusBadge } from '../../../../../components/ui/status-badge';
import { EmptyState } from '../../../../../components/ui/empty-state';
import { useToast } from '../../../../../components/ui/toaster';
import { useConfirm } from '../../../../../components/ui/confirm';
import { GrnFlowIndicator } from '../../../_components/grn-flow-indicator';

interface LineState {
  templateId: string;
  /** Answer + observation per question id. */
  answers: Record<string, string>;
  comments: Record<string, string>;
  /**
   * Accepted quantity — only editable when the checklist FAILED, where the
   * inspector may still salvage part of the lot. A passing checklist accepts
   * the full received quantity by definition.
   */
  accepted: string;
  reason: string;
  remarks: string;
}

const EMPTY_LINE: LineState = {
  templateId: '',
  answers: {},
  comments: {},
  accepted: '0',
  reason: '',
  remarks: '',
};

/**
 * QC Inspection screen. Visible only to QC inspectors / SUPER_ADMIN.
 *
 * Every received line is inspected against an APPROVED QMS question template of
 * type INCOMING, and the checklist DRIVES the outcome: a passing checklist
 * accepts the whole quantity, a failing one requires some quantity to be
 * rejected (which raises an NCR). The quantities are never typed free-hand
 * against a checklist that says otherwise — the same rule is enforced on the
 * server, so this screen only makes it visible earlier.
 */
export default function QcInspectionPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const { isQcInspector, loading: gateLoading } = useIsQcInspector();

  const [grn, setGrn] = useState<GoodsReceiptNote | null>(null);
  const [templates, setTemplates] = useState<GrnInspectionTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lines, setLines] = useState<Record<string, LineState>>({});
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [data, tpls] = await Promise.all([
        getGrn(id),
        listGrnInspectionTemplates(),
      ]);
      setGrn(data);
      setTemplates(tpls);
      // One template? Pre-select it — the common case is a single general
      // incoming checklist, and making the inspector pick it adds nothing.
      const only = tpls.length === 1 ? tpls[0].id : '';
      const seed: Record<string, LineState> = {};
      for (const line of data.lines) {
        seed[line.id] = { ...EMPTY_LINE, templateId: only };
      }
      setLines(seed);
    } catch {
      setError('Failed to load GRN.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const templateById = useMemo(
    () => new Map(templates.map((t) => [t.id, t])),
    [templates],
  );

  function patchLine(lineId: string, patch: Partial<LineState>) {
    setLines((prev) => ({ ...prev, [lineId]: { ...prev[lineId], ...patch } }));
  }

  function setAnswer(lineId: string, questionId: string, value: string) {
    setLines((prev) => ({
      ...prev,
      [lineId]: {
        ...prev[lineId],
        answers: { ...prev[lineId].answers, [questionId]: value },
      },
    }));
  }

  function setComment(lineId: string, questionId: string, value: string) {
    setLines((prev) => ({
      ...prev,
      [lineId]: {
        ...prev[lineId],
        comments: { ...prev[lineId].comments, [questionId]: value },
      },
    }));
  }

  /** Switching template discards answers keyed to the old one. */
  function chooseTemplate(lineId: string, templateId: string) {
    patchLine(lineId, { templateId, answers: {}, comments: {} });
  }

  function applyTemplateToAll(templateId: string) {
    if (!grn) return;
    setLines((prev) => {
      const next = { ...prev };
      for (const line of grn.lines) {
        next[line.id] = {
          ...next[line.id],
          templateId,
          answers: {},
          comments: {},
        };
      }
      return next;
    });
  }

  /**
   * Per line: the checklist verdict, the quantities it implies, and the first
   * thing preventing a submit.
   */
  const evaluated = useMemo(() => {
    const out: Record<
      string,
      {
        questions: InspectionQuestion[];
        result: 'PASS' | 'FAIL';
        complete: boolean;
        failedPrompts: string[];
        accepted: number;
        rejected: number;
        error: string | null;
      }
    > = {};
    if (!grn) return out;
    for (const line of grn.lines) {
      const st = lines[line.id] ?? EMPTY_LINE;
      const received = Number(line.receivedQuantity);
      const template = templateById.get(st.templateId);
      if (!template) {
        out[line.id] = {
          questions: [],
          result: 'PASS',
          complete: false,
          failedPrompts: [],
          accepted: 0,
          rejected: 0,
          error: 'Choose an inspection template for this item.',
        };
        continue;
      }
      const check = checklistState(template.questions, st.answers, st.comments);
      const passing = check.result === 'PASS';
      const accepted = passing ? received : Number(st.accepted);
      const rejected = passing
        ? 0
        : Number((received - accepted).toFixed(4));

      let err: string | null = check.blocker;
      if (!err && !passing) {
        if (!Number.isFinite(accepted) || accepted < 0 || accepted > received) {
          err = `Accepted quantity must be between 0 and ${received}.`;
        } else if (rejected <= 0) {
          err =
            'The inspection failed, so some quantity must be rejected. Correct the checklist if the material is acceptable.';
        } else if (!st.reason.trim()) {
          err = 'A rejection reason is required.';
        }
      }
      out[line.id] = {
        questions: template.questions,
        result: check.result,
        complete: check.complete,
        failedPrompts: check.failedPrompts,
        accepted,
        rejected,
        error: err,
      };
    }
    return out;
  }, [grn, lines, templateById]);

  const totals = useMemo(() => {
    let accepted = 0;
    let rejected = 0;
    for (const e of Object.values(evaluated)) {
      accepted += Number.isFinite(e.accepted) ? e.accepted : 0;
      rejected += Number.isFinite(e.rejected) ? e.rejected : 0;
    }
    return { accepted, rejected };
  }, [evaluated]);

  const canSubmit =
    !!grn &&
    grn.status === 'PENDING_QC' &&
    grn.lines.length > 0 &&
    grn.lines.every((l) => evaluated[l.id] && !evaluated[l.id].error) &&
    !submitting;

  async function handleFinalize() {
    if (!grn || !canSubmit) return;
    const anyRejected = totals.rejected > 0;
    const ok = await confirm({
      title: 'Finalize QC inspection',
      description: anyRejected
        ? `${totals.accepted} will enter stock; ${totals.rejected} will be rejected and an NCR raised. The inspection record is filed against this GRN. This cannot be undone.`
        : `${totals.accepted} will enter stock. The inspection record is filed against this GRN. This cannot be undone.`,
      confirmLabel: 'Finalize & Update Stock',
    });
    if (!ok) return;
    setSubmitting(true);
    try {
      const payload: QcInspectionLineInput[] = grn.lines.map((line) => {
        const st = lines[line.id];
        const e = evaluated[line.id];
        return {
          grnLineId: line.id,
          templateId: st.templateId,
          responses: e.questions.map((q) => ({
            questionKey: q.id,
            answer: st.answers[q.id] ?? '',
            ...(st.comments[q.id]?.trim()
              ? { comments: st.comments[q.id].trim() }
              : {}),
          })),
          acceptedQuantity: e.accepted,
          rejectedQuantity: e.rejected,
          ...(e.rejected > 0 ? { rejectionReason: st.reason.trim() } : {}),
          ...(st.remarks.trim() ? { remarks: st.remarks.trim() } : {}),
        };
      });
      const result = await finalizeQc(grn.id, payload);
      const ncrMsg = result.ncrs.length
        ? ` NCR ${result.ncrs.map((n) => n.ncrNumber).join(', ')} raised.`
        : '';
      toast.success(`QC finalized (${result.status.replace(/_/g, ' ')}).${ncrMsg}`);
      router.push(`/stores/grn/${grn.id}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to finalize QC');
      setSubmitting(false);
    }
  }

  if (gateLoading || loading) {
    return (
      <PageContainer>
        <Skeleton className="mb-4 h-8 w-64" />
        <Skeleton className="h-64 w-full" />
      </PageContainer>
    );
  }

  // isQcInspector gate — non-inspectors get a clear, non-actionable screen.
  if (!isQcInspector) {
    return (
      <PageContainer>
        <EmptyState
          icon={Lock}
          title="QC inspection is restricted"
          description="Only a designated QC Inspector (or the CEO) can inspect incoming goods and finalize the QC gate."
        />
        <div className="flex justify-center">
          <Button variant="outline" onClick={() => router.push(`/stores/grn/${id}`)}>
            <ArrowLeft className="size-4" /> Back to GRN
          </Button>
        </div>
      </PageContainer>
    );
  }

  if (error || !grn) {
    return (
      <PageContainer>
        <p className="text-sm text-destructive">{error ?? 'Not found.'}</p>
      </PageContainer>
    );
  }

  const alreadyInspected = grn.status !== 'PENDING_QC';

  return (
    <PageContainer className="max-w-5xl">
      <div className="mb-4">
        <Link href={`/stores/grn/${grn.id}`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> {grn.grnNumber}
        </Link>
      </div>
      <h1 className="mb-2 flex items-center gap-3 text-2xl font-semibold tracking-tight">
        <ShieldCheck className="size-6 text-primary" /> QC Inspection
        <StatusBadge value={grn.status} />
      </h1>

      <GrnFlowIndicator status={grn.status} className="my-6" />

      {alreadyInspected ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            This GRN has already been inspected (status {grn.status.replace(/_/g, ' ')}).
          </CardContent>
        </Card>
      ) : templates.length === 0 ? (
        // Inspection is mandatory, so with no approved template there is nothing
        // legitimate to inspect against. Say so plainly rather than silently
        // falling back to typing quantities.
        <>
          <EmptyState
            icon={ClipboardList}
            title="No approved incoming-inspection template"
            description="Incoming material must be inspected against an approved checklist before it can enter stock. Create an INCOMING template in QMS → Templates and have the QMS Head approve it, then inspect this GRN."
          />
          <div className="flex justify-center gap-2">
            <Button variant="outline" onClick={() => router.push(`/stores/grn/${grn.id}`)}>
              <ArrowLeft className="size-4" /> Back to GRN
            </Button>
            <Button onClick={() => router.push('/qms/templates')}>
              Go to QMS Templates
            </Button>
          </div>
        </>
      ) : (
        <>
          {/* The critical control, stated unmistakably. */}
          <div className="mb-6 flex items-start gap-3 rounded-lg border border-primary/30 bg-primary/5 p-4">
            <PackageX className="mt-0.5 size-5 shrink-0 text-primary" />
            <div className="text-sm">
              <p className="font-semibold">
                The inspection decides. Only the accepted quantity enters stock.
              </p>
              <p className="text-muted-foreground">
                Each item is inspected against an approved incoming checklist. A{' '}
                <span className="font-medium">passing</span> checklist accepts the full
                received quantity; a <span className="font-medium">failing</span> one
                requires the non-conforming quantity to be rejected, which raises a
                Non-Conformance Report. Rejected quantity is never added to inventory.
              </p>
            </div>
          </div>

          <div className="space-y-6">
            {grn.lines.map((line) => {
              const st = lines[line.id] ?? EMPTY_LINE;
              const e = evaluated[line.id];
              const received = Number(line.receivedQuantity);
              const failing = e && e.complete && e.result === 'FAIL';
              const passing = e && e.complete && e.result === 'PASS';
              return (
                <Card key={line.id}>
                  <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
                    <div>
                      <CardTitle className="text-base">{line.itemName}</CardTitle>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {line.itemCode} · Received{' '}
                        <span className="font-medium text-foreground">
                          {line.receivedQuantity} {line.unitOfMeasure}
                        </span>
                      </p>
                    </div>
                    {e?.complete ? (
                      <Badge variant={passing ? 'success' : 'destructive'}>
                        {passing ? (
                          <CheckCircle2 className="mr-1 size-3" />
                        ) : (
                          <XCircle className="mr-1 size-3" />
                        )}
                        Checklist {e.result}
                      </Badge>
                    ) : (
                      <Badge variant="muted">Checklist incomplete</Badge>
                    )}
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {/* Template choice — per line, because different items need
                        different checks. */}
                    <div className="flex flex-wrap items-end gap-2">
                      <div className="min-w-64 flex-1">
                        <label className="mb-1 block text-xs font-medium text-muted-foreground">
                          Inspection template
                        </label>
                        <Select
                          value={st.templateId}
                          onChange={(ev) => chooseTemplate(line.id, ev.target.value)}
                        >
                          <option value="">Select a template</option>
                          {templates.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.templateCode} v{t.version} — {t.name}
                            </option>
                          ))}
                        </Select>
                      </div>
                      {grn.lines.length > 1 && st.templateId && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => applyTemplateToAll(st.templateId)}
                        >
                          Apply to all lines
                        </Button>
                      )}
                    </div>

                    {/* The checklist itself. */}
                    {e && e.questions.length > 0 && (
                      <div className="divide-y rounded-lg border">
                        {e.questions.map((q) => {
                          const answer = st.answers[q.id] ?? '';
                          const qResult = questionResult(q, answer);
                          const needsNote =
                            qResult === 'FAIL' &&
                            q.evidenceOnFailure &&
                            !(st.comments[q.id] ?? '').trim();
                          return (
                            <div
                              key={q.id}
                              className="grid gap-2 p-3 md:grid-cols-[1fr_14rem]"
                            >
                              <div>
                                <div className="text-sm font-medium">
                                  {q.prompt}
                                  {q.required && (
                                    <span className="ml-1 text-destructive">*</span>
                                  )}
                                </div>
                                <div className="text-xs text-muted-foreground">
                                  {q.section}
                                  {q.acceptanceCriteria
                                    ? ` · ${q.acceptanceCriteria}`
                                    : ''}
                                  {q.lowerLimit || q.upperLimit
                                    ? ` · Limits ${q.lowerLimit ?? '—'} to ${q.upperLimit ?? '—'}${q.unit ? ` ${q.unit}` : ''}`
                                    : ''}
                                </div>
                                {(qResult === 'FAIL' ||
                                  (st.comments[q.id] ?? '').trim()) && (
                                  <Input
                                    className="mt-2"
                                    placeholder={
                                      needsNote
                                        ? 'Required — what was observed?'
                                        : 'Observation'
                                    }
                                    aria-invalid={needsNote}
                                    value={st.comments[q.id] ?? ''}
                                    onChange={(ev) =>
                                      setComment(line.id, q.id, ev.target.value)
                                    }
                                  />
                                )}
                              </div>
                              <div className="flex items-center gap-2">
                                {isChoiceQuestion(q.responseType) ? (
                                  <Select
                                    value={answer}
                                    onChange={(ev) =>
                                      setAnswer(line.id, q.id, ev.target.value)
                                    }
                                  >
                                    <option value="">Select</option>
                                    {(CHOICE_OPTIONS[q.responseType] ?? []).map(
                                      (opt) => (
                                        <option key={opt} value={opt}>
                                          {opt}
                                        </option>
                                      ),
                                    )}
                                  </Select>
                                ) : (
                                  <Input
                                    type={
                                      isNumericQuestion(q.responseType)
                                        ? 'number'
                                        : q.responseType === 'DATE'
                                          ? 'date'
                                          : 'text'
                                    }
                                    step="any"
                                    value={answer}
                                    onChange={(ev) =>
                                      setAnswer(line.id, q.id, ev.target.value)
                                    }
                                  />
                                )}
                                {qResult && qResult !== 'NOT_APPLICABLE' && (
                                  <Badge
                                    variant={
                                      qResult === 'PASS' ? 'success' : 'destructive'
                                    }
                                  >
                                    {qResult}
                                  </Badge>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Quantities — derived from the checklist, not typed against it. */}
                    <div className="rounded-lg border bg-muted/30 p-3">
                      {passing ? (
                        <p className="text-sm">
                          <span className="font-medium text-success">
                            Full acceptance:
                          </span>{' '}
                          all {line.receivedQuantity} {line.unitOfMeasure} enter stock.
                        </p>
                      ) : failing ? (
                        <div className="grid gap-3 sm:grid-cols-[8rem_8rem_1fr]">
                          <div>
                            <label className="mb-1 block text-xs font-medium text-muted-foreground">
                              Accepted
                            </label>
                            <Input
                              type="number"
                              min="0"
                              max={received}
                              step="any"
                              className="text-right"
                              value={st.accepted}
                              onChange={(ev) =>
                                patchLine(line.id, { accepted: ev.target.value })
                              }
                            />
                          </div>
                          <div>
                            <label className="mb-1 block text-xs font-medium text-muted-foreground">
                              Rejected → NCR
                            </label>
                            <div className="flex h-9 items-center justify-end rounded-md border bg-background px-3 text-sm font-semibold text-destructive">
                              {Number.isFinite(e.rejected) ? e.rejected : '—'}
                            </div>
                          </div>
                          <div>
                            <label className="mb-1 block text-xs font-medium text-muted-foreground">
                              Rejection reason
                            </label>
                            <Textarea
                              className="min-h-[38px]"
                              placeholder="Required — why is this quantity rejected?"
                              value={st.reason}
                              onChange={(ev) =>
                                patchLine(line.id, { reason: ev.target.value })
                              }
                            />
                          </div>
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground">
                          Complete the checklist to set the accepted and rejected
                          quantities.
                        </p>
                      )}
                      <div className="mt-3">
                        <label className="mb-1 block text-xs font-medium text-muted-foreground">
                          Inspector remarks (optional)
                        </label>
                        <Input
                          placeholder="Recorded on the inspection record"
                          value={st.remarks}
                          onChange={(ev) =>
                            patchLine(line.id, { remarks: ev.target.value })
                          }
                        />
                      </div>
                    </div>

                    {e?.error && (
                      <div className="flex items-center gap-1 text-xs text-destructive">
                        <AlertTriangle className="size-3 shrink-0" /> {e.error}
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>

          <div className="mt-6 flex items-center justify-between">
            <div className="text-sm">
              <span className="text-success">
                Entering stock: <span className="font-semibold">{totals.accepted}</span>
              </span>
              {totals.rejected > 0 && (
                <span className="ml-4 text-destructive">
                  Rejected (→ NCR): <span className="font-semibold">{totals.rejected}</span>
                </span>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => router.push(`/stores/grn/${grn.id}`)}>
                Cancel
              </Button>
              <Button onClick={handleFinalize} disabled={!canSubmit}>
                {submitting ? 'Finalizing…' : 'Finalize & Update Stock'}
              </Button>
            </div>
          </div>
        </>
      )}
    </PageContainer>
  );
}
