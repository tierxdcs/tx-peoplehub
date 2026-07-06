'use client';

import { useCallback, useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { apiFetch, ApiError } from '../../../lib/api';
import {
  BidAssessmentQuestion,
  BidAssessmentQuestionType,
} from '../../../lib/types';
import { PageContainer } from '../../../components/ui/page-container';
import { PageHeader } from '../../../components/ui/page-header';
import { Card, CardContent } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Select } from '../../../components/ui/select';
import { Field } from '../../../components/ui/field';
import { Skeleton } from '../../../components/ui/skeleton';
import { StatusBadge } from '../../../components/ui/status-badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../components/ui/dialog';
import { useToast } from '../../../components/ui/toaster';
import { useConfirm } from '../../../components/ui/confirm';

const TYPES: BidAssessmentQuestionType[] = [
  'BOOLEAN',
  'TEXT',
  'SCALE',
  'SELECT',
];

export default function BidAssessmentQuestionsPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const [items, setItems] = useState<BidAssessmentQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<BidAssessmentQuestion | 'new' | null>(
    null,
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch<BidAssessmentQuestion[]>(
        '/bid-assessment-questions?includeInactive=true',
      );
      setItems(res.sort((a, b) => a.displayOrder - b.displayOrder));
    } catch {
      toast.error('Failed to load questions');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  async function deactivate(q: BidAssessmentQuestion) {
    const ok = await confirm({
      title: 'Deactivate this question?',
      description:
        'It will no longer appear on new assessments. Existing answered assessments keep it. You can reactivate it later by editing.',
      confirmLabel: 'Deactivate',
      destructive: true,
    });
    if (!ok) return;
    try {
      await apiFetch(`/bid-assessment-questions/${q.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: false }),
      });
      toast.success('Question deactivated');
      await load();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : 'Failed to deactivate',
      );
    }
  }

  return (
    <PageContainer>
      <PageHeader
        title="Bid Assessment Questions"
        description="The configurable Bid/No-Bid questionnaire. Deactivate rather than delete — answered history keeps its reference."
        action={
          <Button onClick={() => setEditing('new')}>
            <Plus /> New Question
          </Button>
        }
      />

      <Card>
        <CardContent className="pt-6">
          {loading ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16 text-right">Order</TableHead>
                  <TableHead>Question</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((q) => (
                  <TableRow key={q.id}>
                    <TableCell className="text-right tabular-nums">
                      {q.displayOrder}
                    </TableCell>
                    <TableCell className="font-medium">{q.text}</TableCell>
                    <TableCell>{q.type}</TableCell>
                    <TableCell>
                      <StatusBadge value={q.isActive ? 'ACTIVE' : 'INACTIVE'} />
                    </TableCell>
                    <TableCell className="space-x-2 text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setEditing(q)}
                      >
                        Edit
                      </Button>
                      {q.isActive && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => deactivate(q)}
                        >
                          Deactivate
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {items.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={5}
                      className="text-center text-muted-foreground"
                    >
                      No questions configured yet.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {editing && (
        <QuestionForm
          question={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void load();
          }}
        />
      )}
    </PageContainer>
  );
}

function QuestionForm({
  question,
  onClose,
  onSaved,
}: {
  question: BidAssessmentQuestion | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const isEdit = question !== null;
  const [text, setText] = useState(question?.text ?? '');
  const [type, setType] = useState<BidAssessmentQuestionType>(
    question?.type ?? 'BOOLEAN',
  );
  const [optionsText, setOptionsText] = useState(
    (question?.options ?? []).join('\n'),
  );
  const [displayOrder, setDisplayOrder] = useState(
    String(question?.displayOrder ?? 0),
  );
  const [isActive, setIsActive] = useState(question?.isActive ?? true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!text.trim()) {
      setError('Question text is required');
      return;
    }
    const options =
      type === 'SELECT'
        ? optionsText
            .split('\n')
            .map((o) => o.trim())
            .filter(Boolean)
        : undefined;
    if (type === 'SELECT' && (!options || options.length === 0)) {
      setError('A SELECT question needs at least one option (one per line)');
      return;
    }

    const body = {
      text: text.trim(),
      type,
      options,
      displayOrder: Number(displayOrder) || 0,
      isActive,
    };

    setSubmitting(true);
    try {
      await apiFetch(
        isEdit
          ? `/bid-assessment-questions/${question!.id}`
          : '/bid-assessment-questions',
        {
          method: isEdit ? 'PATCH' : 'POST',
          body: JSON.stringify(body),
        },
      );
      toast.success(isEdit ? 'Question updated' : 'Question created');
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit question' : 'New question'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Field label="Question text" htmlFor="q-text" required>
            <Input
              id="q-text"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </Field>
          <Field label="Type" htmlFor="q-type" required>
            <Select
              id="q-type"
              value={type}
              onChange={(e) =>
                setType(e.target.value as BidAssessmentQuestionType)
              }
            >
              {TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
          </Field>
          {type === 'SELECT' && (
            <Field
              label="Options (one per line)"
              htmlFor="q-options"
              required
            >
              <textarea
                id="q-options"
                className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={optionsText}
                onChange={(e) => setOptionsText(e.target.value)}
                placeholder={'Sole vendor\nFew competitors\nCrowded'}
              />
            </Field>
          )}
          <Field label="Display order" htmlFor="q-order">
            <Input
              id="q-order"
              type="number"
              min={0}
              value={displayOrder}
              onChange={(e) => setDisplayOrder(e.target.value)}
            />
          </Field>
          {isEdit && (
            <Field label="Active" htmlFor="q-active">
              <Select
                id="q-active"
                value={isActive ? 'true' : 'false'}
                onChange={(e) => setIsActive(e.target.value === 'true')}
              >
                <option value="true">Active</option>
                <option value="false">Inactive</option>
              </Select>
            </Field>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
