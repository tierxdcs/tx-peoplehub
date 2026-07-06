'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiFetch, ApiError } from '../../../lib/api';
import { BidAssessmentQuestion } from '../../../lib/types';
import {
  SCALE_OPTIONS,
  unansweredQuestionIds,
} from '../../../lib/bid-assessment';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../components/ui/dialog';
import { Button } from '../../../components/ui/button';
import { Select } from '../../../components/ui/select';
import { Textarea } from '../../../components/ui/textarea';
import { Field } from '../../../components/ui/field';
import { Skeleton } from '../../../components/ui/skeleton';
import { useToast } from '../../../components/ui/toaster';
import { useConfirm } from '../../../components/ui/confirm';

/**
 * Submit / resubmit a Bid/No-Bid assessment for an opportunity. Renders one
 * field per active question (in displayOrder) by type, enforces the
 * all-required rule client-side, and (on resubmit) shows the prior rejection
 * comments as context so the rep knows what to address.
 */
export function BidAssessmentDialog({
  opportunityId,
  open,
  onOpenChange,
  onSubmitted,
  priorRejectionComments,
}: {
  opportunityId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmitted: () => void;
  priorRejectionComments?: string | null;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const [questions, setQuestions] = useState<BidAssessmentQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [touched, setTouched] = useState(false);

  const loadQuestions = useCallback(async () => {
    setLoading(true);
    try {
      const qs = await apiFetch<BidAssessmentQuestion[]>(
        '/bid-assessment-questions',
      );
      // Active-only, ordered — the backend returns active by default; sort
      // defensively by displayOrder for a stable render.
      const active = qs
        .filter((q) => q.isActive)
        .sort((a, b) => a.displayOrder - b.displayOrder);
      setQuestions(active);
      setAnswers({});
      setTouched(false);
    } catch {
      toast.error('Failed to load assessment questions');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    if (open) void loadQuestions();
  }, [open, loadQuestions]);

  const missing = unansweredQuestionIds(questions, answers);

  function setAnswer(id: string, value: string) {
    setAnswers((a) => ({ ...a, [id]: value }));
  }

  async function handleSubmit() {
    setTouched(true);
    if (questions.length === 0 || missing.length > 0) return;
    const ok = await confirm({
      title: 'Submit assessment for review?',
      description:
        'This will be sent to the Sales Head. You cannot edit it after submitting.',
      confirmLabel: 'Submit',
    });
    if (!ok) return;
    setSubmitting(true);
    try {
      await apiFetch(`/opportunities/${opportunityId}/bid-assessment`, {
        method: 'POST',
        body: JSON.stringify({
          answers: questions.map((q) => ({
            questionId: q.id,
            answerValue: answers[q.id],
          })),
        }),
      });
      toast.success('Assessment submitted for review');
      onOpenChange(false);
      onSubmitted();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : 'Failed to submit assessment',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Bid/No-Bid Assessment</DialogTitle>
          <DialogDescription>
            Answer every question. A Sales Head reviews this before a bid can
            be created.
          </DialogDescription>
        </DialogHeader>

        {priorRejectionComments && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
            <span className="font-semibold">
              Previous submission was rejected:
            </span>{' '}
            {priorRejectionComments}
          </div>
        )}

        {loading ? (
          <div className="space-y-3">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : questions.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No active assessment questions are configured. Ask an Admin to add
            some.
          </p>
        ) : (
          <div className="space-y-4">
            {questions.map((q) => {
              const blank = touched && (!answers[q.id] || !answers[q.id].trim());
              return (
                <Field
                  key={q.id}
                  label={q.text}
                  htmlFor={`q-${q.id}`}
                  required
                  error={blank ? 'This question is required' : null}
                >
                  {q.type === 'TEXT' ? (
                    <Textarea
                      id={`q-${q.id}`}
                      value={answers[q.id] ?? ''}
                      onChange={(e) => setAnswer(q.id, e.target.value)}
                    />
                  ) : q.type === 'BOOLEAN' ? (
                    <Select
                      id={`q-${q.id}`}
                      value={answers[q.id] ?? ''}
                      onChange={(e) => setAnswer(q.id, e.target.value)}
                    >
                      <option value="">Select…</option>
                      <option value="true">Yes</option>
                      <option value="false">No</option>
                    </Select>
                  ) : q.type === 'SCALE' ? (
                    <Select
                      id={`q-${q.id}`}
                      value={answers[q.id] ?? ''}
                      onChange={(e) => setAnswer(q.id, e.target.value)}
                    >
                      <option value="">Select…</option>
                      {SCALE_OPTIONS.map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    <Select
                      id={`q-${q.id}`}
                      value={answers[q.id] ?? ''}
                      onChange={(e) => setAnswer(q.id, e.target.value)}
                    >
                      <option value="">Select…</option>
                      {(q.options ?? []).map((opt) => (
                        <option key={opt} value={opt}>
                          {opt}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              );
            })}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={submitting || loading || questions.length === 0}
          >
            {submitting ? 'Submitting…' : 'Submit for review'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
