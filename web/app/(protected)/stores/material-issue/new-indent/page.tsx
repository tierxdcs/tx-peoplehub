'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { ApiError } from '../../../../lib/api';
import { createIndent } from '../../../../lib/stores';
import { listItems, type Item } from '../../../../lib/scm-item-master';
import { listKickoffs, type ProjectKickoff } from '../../../../lib/project-kickoff';
import { PageContainer } from '../../../../components/ui/page-container';
import { Card, CardContent, CardHeader, CardTitle } from '../../../../components/ui/card';
import { Button } from '../../../../components/ui/button';
import { Input } from '../../../../components/ui/input';
import { Select } from '../../../../components/ui/select';
import { Field } from '../../../../components/ui/field';
import { Textarea } from '../../../../components/ui/textarea';
import { Skeleton } from '../../../../components/ui/skeleton';
import { useToast } from '../../../../components/ui/toaster';

/** Raise a material indent (Production). Optional project/kickoff link enables
 *  reservation-aware issuing against that project's reserved stock. */
export default function NewIndentPage() {
  const router = useRouter();
  const toast = useToast();

  const [items, setItems] = useState<Item[]>([]);
  const [kickoffs, setKickoffs] = useState<ProjectKickoff[]>([]);
  const [loading, setLoading] = useState(true);

  const [itemId, setItemId] = useState('');
  const [requestedQuantity, setRequestedQuantity] = useState('');
  const [projectKickoffId, setProjectKickoffId] = useState('');
  const [requiredByDate, setRequiredByDate] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const [it, ko] = await Promise.all([
          listItems({ activeOnly: true }),
          listKickoffs(),
        ]);
        setItems(it);
        setKickoffs(ko);
      } catch {
        toast.error('Failed to load form data.');
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const qty = Number(requestedQuantity);
  const canSubmit = !!itemId && Number.isFinite(qty) && qty > 0 && !submitting;

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const indent = await createIndent({
        itemId,
        requestedQuantity: qty,
        ...(projectKickoffId ? { projectKickoffId } : {}),
        ...(requiredByDate ? { requiredByDate: new Date(requiredByDate).toISOString() } : {}),
        ...(notes ? { notes } : {}),
      });
      toast.success(`Indent ${indent.indentNumber} raised`);
      router.push('/stores/material-issue');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to raise indent');
      setSubmitting(false);
    }
  }

  return (
    <PageContainer className="max-w-2xl">
      <div className="mb-4">
        <Link href="/stores/material-issue" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> Material Issue
        </Link>
      </div>
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">Raise Material Indent</h1>

      {loading ? (
        <Skeleton className="h-80 w-full" />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Indent Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field label="Item" htmlFor="item" required>
              <Select id="item" value={itemId} onChange={(e) => setItemId(e.target.value)}>
                <option value="">Select item…</option>
                {items.map((it) => (
                  <option key={it.id} value={it.id}>
                    {it.itemCode} — {it.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Requested Quantity" htmlFor="qty" required>
              <Input
                id="qty"
                type="number"
                min="0"
                step="any"
                value={requestedQuantity}
                onChange={(e) => setRequestedQuantity(e.target.value)}
              />
            </Field>
            <Field
              label="Project / Kickoff"
              htmlFor="kickoff"
              hint="Optional — links the indent to a project so its reserved stock can be issued."
            >
              <Select id="kickoff" value={projectKickoffId} onChange={(e) => setProjectKickoffId(e.target.value)}>
                <option value="">No project link</option>
                {kickoffs.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.projectName}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Required By" htmlFor="reqby">
              <Input id="reqby" type="date" value={requiredByDate} onChange={(e) => setRequiredByDate(e.target.value)} />
            </Field>
            <Field label="Notes" htmlFor="notes">
              <Textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </Field>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => router.push('/stores/material-issue')}>
                Cancel
              </Button>
              <Button onClick={handleSubmit} disabled={!canSubmit}>
                {submitting ? 'Raising…' : 'Raise Indent'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </PageContainer>
  );
}
