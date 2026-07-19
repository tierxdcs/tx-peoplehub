'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { ApiError } from '../../../../../lib/api';
import {
  getBom,
  updateBom,
  type Bom,
  type BomLineInput,
} from '../../../../../lib/scm-bom';
import { listItems, type Item } from '../../../../../lib/scm-item-master';
import { PageContainer } from '../../../../../components/ui/page-container';
import { PageHeader } from '../../../../../components/ui/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '../../../../../components/ui/card';
import { Button } from '../../../../../components/ui/button';
import { Input } from '../../../../../components/ui/input';
import { Textarea } from '../../../../../components/ui/textarea';
import { Field } from '../../../../../components/ui/field';
import { Skeleton } from '../../../../../components/ui/skeleton';
import { useToast } from '../../../../../components/ui/toaster';
import {
  BomLineEditor,
  emptyBomLine,
  type BomLineDraft,
} from '../../_components/bom-line-editor';

export default function EditBomPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();

  const [bom, setBom] = useState<Bom | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [effectiveDate, setEffectiveDate] = useState('');
  const [revisionNotes, setRevisionNotes] = useState('');
  const [lines, setLines] = useState<BomLineDraft[]>([emptyBomLine()]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [b, itemsRes] = await Promise.all([
        getBom(id),
        listItems({ activeOnly: true }),
      ]);
      setBom(b);
      setItems(itemsRes);
      setEffectiveDate(b.effectiveDate ? b.effectiveDate.slice(0, 10) : '');
      setRevisionNotes(b.revisionNotes ?? '');
      setLines(
        b.lines.length > 0
          ? b.lines.map((l) => ({
              itemId: l.itemId,
              quantityPerUnit: l.quantityPerUnit,
              unitOfMeasure: l.unitOfMeasure,
              wastagePercent: l.wastagePercent,
              makeBuy: l.makeBuy,
              notes: l.notes ?? '',
            }))
          : [emptyBomLine()],
      );
    } catch (err) {
      setLoadError(
        err instanceof ApiError && err.statusCode === 404
          ? 'BOM not found.'
          : 'Failed to load BOM.',
      );
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function submit() {
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
      await updateBom(id, {
        effectiveDate: effectiveDate || undefined,
        revisionNotes: revisionNotes.trim() || undefined,
        lines: payloadLines,
      });
      toast.success('BOM updated.');
      router.push('/scm/bom/' + id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to update BOM.');
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <PageContainer>
        <Skeleton className="mb-4 h-6 w-24" />
        <Skeleton className="h-64 w-full" />
      </PageContainer>
    );
  }

  if (loadError || !bom) {
    return (
      <PageContainer>
        <Link
          href="/scm/bom"
          className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> Bills of Material
        </Link>
        <p className="text-destructive">{loadError ?? 'BOM not found'}</p>
      </PageContainer>
    );
  }

  if (bom.status !== 'DRAFT' && bom.status !== 'REJECTED') {
    return (
      <PageContainer>
        <Link
          href={'/scm/bom/' + id}
          className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> Back to BOM
        </Link>
        <p className="text-sm text-muted-foreground">
          Only draft or rejected BOMs can be edited.
        </p>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <Link
        href={'/scm/bom/' + id}
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Back to BOM
      </Link>

      <PageHeader
        title={`Edit BOM — ${bom.itemCode ?? ''} (Rev ${bom.revisionNumber})`}
        description="Update components and quantities, then resubmit for approval."
      />

      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 pt-0 sm:grid-cols-2">
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
            onClick={() => router.push('/scm/bom/' + id)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      </div>
    </PageContainer>
  );
}
