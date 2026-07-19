'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Plus, Trash2 } from 'lucide-react';
import { ApiError } from '../../../../lib/api';
import { createRfq, type CreateRfqInput } from '../../../../lib/rfq';
import { listItems, type Item } from '../../../../lib/scm-item-master';
import { PageContainer } from '../../../../components/ui/page-container';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '../../../../components/ui/card';
import { Button } from '../../../../components/ui/button';
import { Input } from '../../../../components/ui/input';
import { Select } from '../../../../components/ui/select';
import { Field } from '../../../../components/ui/field';
import { Textarea } from '../../../../components/ui/textarea';
import { Skeleton } from '../../../../components/ui/skeleton';
import { useToast } from '../../../../components/ui/toaster';

interface LineDraft {
  key: number;
  itemId: string;
  quantity: string;
  specificationNotes: string;
}

let lineKeySeq = 1;

export default function NewRfqPage() {
  const router = useRouter();
  const toast = useToast();

  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [submissionDeadline, setSubmissionDeadline] = useState('');
  const [requiredByDate, setRequiredByDate] = useState('');
  const [deliveryLocation, setDeliveryLocation] = useState('');
  const [paymentTermsRequested, setPaymentTermsRequested] = useState('');
  const [lines, setLines] = useState<LineDraft[]>([
    { key: lineKeySeq++, itemId: '', quantity: '', specificationNotes: '' },
  ]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        setItems(await listItems({ activeOnly: true }));
      } catch {
        toast.error('Failed to load items.');
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function updateLine(key: number, patch: Partial<LineDraft>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }
  function addLine() {
    setLines((prev) => [
      ...prev,
      { key: lineKeySeq++, itemId: '', quantity: '', specificationNotes: '' },
    ]);
  }
  function removeLine(key: number) {
    setLines((prev) => (prev.length > 1 ? prev.filter((l) => l.key !== key) : prev));
  }

  const validLines = lines.filter((l) => l.itemId && Number(l.quantity) > 0);
  const canSubmit = !!title.trim() && !!submissionDeadline && validLines.length > 0 && !submitting;

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    const input: CreateRfqInput = {
      title: title.trim(),
      ...(description.trim() ? { description: description.trim() } : {}),
      submissionDeadline: new Date(submissionDeadline).toISOString(),
      ...(requiredByDate ? { requiredByDate } : {}),
      ...(deliveryLocation.trim() ? { deliveryLocation: deliveryLocation.trim() } : {}),
      ...(paymentTermsRequested.trim()
        ? { paymentTermsRequested: paymentTermsRequested.trim() }
        : {}),
      lines: validLines.map((l, i) => ({
        itemId: l.itemId,
        quantity: Number(l.quantity),
        ...(l.specificationNotes.trim()
          ? { specificationNotes: l.specificationNotes.trim() }
          : {}),
        sequence: i,
      })),
    };
    try {
      const rfq = await createRfq(input);
      toast.success(`RFQ ${rfq.rfqNumber} created`);
      router.push(`/scm/rfqs/${rfq.id}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to create RFQ');
      setSubmitting(false);
    }
  }

  return (
    <PageContainer>
      <div className="mb-4">
        <Link
          href="/scm/rfqs"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> RFQs
        </Link>
      </div>
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">New RFQ</h1>

      {loading ? (
        <Skeleton className="h-96 w-full" />
      ) : (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Field label="Title" htmlFor="title" required>
                <Input
                  id="title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Sheet metal fabrication — Q3 batch"
                />
              </Field>
              <Field label="Description" htmlFor="description">
                <Textarea
                  id="description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </Field>
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Submission Deadline" htmlFor="deadline" required>
                  <Input
                    id="deadline"
                    type="datetime-local"
                    value={submissionDeadline}
                    onChange={(e) => setSubmissionDeadline(e.target.value)}
                  />
                </Field>
                <Field label="Required By Date" htmlFor="requiredBy">
                  <Input
                    id="requiredBy"
                    type="date"
                    value={requiredByDate}
                    onChange={(e) => setRequiredByDate(e.target.value)}
                  />
                </Field>
                <Field label="Delivery Location" htmlFor="deliveryLocation">
                  <Input
                    id="deliveryLocation"
                    value={deliveryLocation}
                    onChange={(e) => setDeliveryLocation(e.target.value)}
                  />
                </Field>
                <Field label="Payment Terms Requested" htmlFor="paymentTerms">
                  <Input
                    id="paymentTerms"
                    value={paymentTermsRequested}
                    onChange={(e) => setPaymentTermsRequested(e.target.value)}
                    placeholder="e.g. Net 30"
                  />
                </Field>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Line Items</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {lines.map((line) => {
                const item = items.find((it) => it.id === line.itemId) ?? null;
                return (
                  <div
                    key={line.key}
                    className="grid items-end gap-3 md:grid-cols-[1fr_140px_1fr_40px]"
                  >
                    <Field label="Item">
                      <Select
                        value={line.itemId}
                        onChange={(e) => updateLine(line.key, { itemId: e.target.value })}
                      >
                        <option value="">Select item…</option>
                        {items.map((it) => (
                          <option key={it.id} value={it.id}>
                            {it.itemCode} — {it.name}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label={`Qty${item ? ` (${item.baseUnitOfMeasure})` : ''}`}>
                      <Input
                        type="number"
                        min="0"
                        step="any"
                        value={line.quantity}
                        onChange={(e) => updateLine(line.key, { quantity: e.target.value })}
                      />
                    </Field>
                    <Field label="Specification Notes">
                      <Input
                        value={line.specificationNotes}
                        onChange={(e) =>
                          updateLine(line.key, { specificationNotes: e.target.value })
                        }
                      />
                    </Field>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => removeLine(line.key)}
                      disabled={lines.length === 1}
                      aria-label="Remove line"
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                );
              })}
              <div className="pt-2">
                <Button type="button" variant="outline" size="sm" onClick={addLine}>
                  <Plus className="size-4" /> Add line
                </Button>
              </div>
            </CardContent>
          </Card>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => router.push('/scm/rfqs')}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={!canSubmit}>
              {submitting ? 'Creating…' : 'Create RFQ'}
            </Button>
          </div>
        </div>
      )}
    </PageContainer>
  );
}
