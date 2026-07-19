'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { ApiError } from '../../../../lib/api';
import { createBom, type BomLineInput } from '../../../../lib/scm-bom';
import { ITEM_TYPE_LABEL, listItems, type Item } from '../../../../lib/scm-item-master';
import { PageContainer } from '../../../../components/ui/page-container';
import { PageHeader } from '../../../../components/ui/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '../../../../components/ui/card';
import { Button } from '../../../../components/ui/button';
import { Input } from '../../../../components/ui/input';
import { Select } from '../../../../components/ui/select';
import { Textarea } from '../../../../components/ui/textarea';
import { Field } from '../../../../components/ui/field';
import { Skeleton } from '../../../../components/ui/skeleton';
import { useToast } from '../../../../components/ui/toaster';
import {
  BomLineEditor,
  emptyBomLine,
  type BomLineDraft,
} from '../_components/bom-line-editor';

export default function NewBomPage() {
  const router = useRouter();
  const toast = useToast();

  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);

  const [itemId, setItemId] = useState('');
  const [effectiveDate, setEffectiveDate] = useState('');
  const [revisionNotes, setRevisionNotes] = useState('');
  const [lines, setLines] = useState<BomLineDraft[]>([emptyBomLine()]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    listItems({ activeOnly: true })
      .then((itemsRes) => {
        setItems(itemsRes);
      })
      .catch((err) =>
        setError(
          err instanceof ApiError ? err.message : 'Failed to load form data.',
        ),
      )
      .finally(() => setLoading(false));
  }, []);

  async function submit() {
    if (!itemId) {
      setError('Select an item.');
      return;
    }
    const validLines = lines.filter((l) => l.itemId);
    if (validLines.length === 0) {
      setError('Add at least one BOM line with an item.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const payloadLines: BomLineInput[] = validLines.map((l, i) => ({
        itemId: l.itemId,
        quantityPerUnit: Number(l.quantityPerUnit),
        unitOfMeasure: l.unitOfMeasure,
        wastagePercent:
          l.wastagePercent.trim() === '' ? undefined : Number(l.wastagePercent),
        makeBuy: l.makeBuy,
        notes: l.notes.trim() || undefined,
        sequence: i + 1,
      }));
      const created = await createBom({
        itemId,
        effectiveDate: effectiveDate || undefined,
        revisionNotes: revisionNotes.trim() || undefined,
        lines: payloadLines,
      });
      toast.success('BOM created.');
      router.push('/scm/bom/' + created.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create BOM.');
      setSubmitting(false);
    }
  }

  return (
    <PageContainer>
      <Link
        href="/scm/bom"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Bills of Material
      </Link>

      <PageHeader
        title="New BOM"
        description="Define an item’s components and quantities."
      />

      {loading ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Item</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 pt-0 sm:grid-cols-2">
              <Field label="Item" required htmlFor="b-item">
                <Select
                  id="b-item"
                  value={itemId}
                  onChange={(e) => setItemId(e.target.value)}
                >
                  <option value="">Select item…</option>
                  {items.map((it) => (
                    <option key={it.id} value={it.id}>
                      {it.itemCode} — {it.name} ({ITEM_TYPE_LABEL[it.itemType]})
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Effective date" htmlFor="b-eff">
                <Input
                  id="b-eff"
                  type="date"
                  value={effectiveDate}
                  onChange={(e) => setEffectiveDate(e.target.value)}
                />
              </Field>
              <Field label="Revision notes" htmlFor="b-notes" className="sm:col-span-2">
                <Textarea
                  id="b-notes"
                  rows={2}
                  value={revisionNotes}
                  onChange={(e) => setRevisionNotes(e.target.value)}
                />
              </Field>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>BOM Lines</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <BomLineEditor items={items} lines={lines} onChange={setLines} />
            </CardContent>
          </Card>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => router.push('/scm/bom')}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button onClick={submit} disabled={submitting}>
              {submitting ? 'Creating…' : 'Create BOM'}
            </Button>
          </div>
        </div>
      )}
    </PageContainer>
  );
}
