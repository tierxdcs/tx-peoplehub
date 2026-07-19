'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, FileWarning } from 'lucide-react';
import { ApiError } from '../../../../lib/api';
import {
  getNcr,
  dispositionNcr,
  closeNcr,
  NCR_DISPOSITION_LABEL,
  type NonConformanceReport,
  type NcrDispositionType,
} from '../../../../lib/stores';
import { dateOnlyStr } from '../../../../lib/date';
import { PageContainer } from '../../../../components/ui/page-container';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '../../../../components/ui/card';
import { Button } from '../../../../components/ui/button';
import { Select } from '../../../../components/ui/select';
import { Field } from '../../../../components/ui/field';
import { Textarea } from '../../../../components/ui/textarea';
import { Skeleton } from '../../../../components/ui/skeleton';
import { StatusBadge } from '../../../../components/ui/status-badge';
import { useToast } from '../../../../components/ui/toaster';

const DISPOSITIONS: NcrDispositionType[] = [
  'RETURN_TO_SUPPLIER',
  'REWORK',
  'USE_AS_IS',
  'SCRAP',
];

export default function NcrDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();

  const [ncr, setNcr] = useState<NonConformanceReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [disposition, setDisposition] = useState<NcrDispositionType | ''>('');
  const [notes, setNotes] = useState('');
  const [acting, setActing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setNcr(await getNcr(id));
    } catch {
      setError('Failed to load NCR.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleDisposition() {
    if (!ncr || !disposition) return;
    setActing(true);
    try {
      await dispositionNcr(ncr.id, {
        disposition,
        ...(notes ? { dispositionNotes: notes } : {}),
      });
      toast.success('Disposition recorded');
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to record disposition');
    } finally {
      setActing(false);
    }
  }

  async function handleClose() {
    if (!ncr) return;
    setActing(true);
    try {
      await closeNcr(ncr.id);
      toast.success('NCR closed');
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to close NCR');
    } finally {
      setActing(false);
    }
  }

  if (loading) {
    return (
      <PageContainer>
        <Skeleton className="mb-4 h-8 w-64" />
        <Skeleton className="h-64 w-full" />
      </PageContainer>
    );
  }
  if (error || !ncr) {
    return (
      <PageContainer>
        <p className="text-sm text-destructive">{error ?? 'Not found.'}</p>
        <Button variant="outline" className="mt-4" onClick={() => router.push('/stores/ncr')}>
          <ArrowLeft className="size-4" /> Back
        </Button>
      </PageContainer>
    );
  }

  return (
    <PageContainer className="max-w-3xl">
      <div className="mb-4">
        <Link href="/stores/ncr" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> Non-Conformance Reports
        </Link>
      </div>

      <div className="mb-6 flex items-start justify-between gap-4">
        <h1 className="flex items-center gap-3 text-2xl font-semibold tracking-tight">
          <FileWarning className="size-6 text-destructive" />
          {ncr.ncrNumber}
          <StatusBadge value={ncr.status} />
        </h1>
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">Rejection Summary</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 md:grid-cols-3">
          <Info label="Item" value={ncr.itemName ?? ncr.itemCode ?? '—'} />
          <Info label="Rejected Quantity" value={ncr.rejectedQuantity} emphasize />
          <Info
            label="Source GRN"
            value={ncr.grnNumber ?? '—'}
            href={`/stores/grn/${ncr.grnId}`}
          />
          <Info label="Raised By" value={ncr.raisedByName ?? '—'} />
          <Info label="Raised On" value={dateOnlyStr(ncr.createdAt)} />
          {ncr.dispositionedByName && (
            <Info label="Dispositioned By" value={ncr.dispositionedByName} />
          )}
        </CardContent>
      </Card>

      {ncr.rejectionReason && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-sm">Rejection Reason</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {ncr.rejectionReason}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Disposition</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {ncr.status === 'OPEN' ? (
            <>
              <Field label="Disposition" htmlFor="disp" required>
                <Select
                  id="disp"
                  value={disposition}
                  onChange={(e) => setDisposition(e.target.value as NcrDispositionType | '')}
                >
                  <option value="">Select disposition…</option>
                  {DISPOSITIONS.map((d) => (
                    <option key={d} value={d}>
                      {NCR_DISPOSITION_LABEL[d]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Disposition Notes" htmlFor="dnotes">
                <Textarea id="dnotes" value={notes} onChange={(e) => setNotes(e.target.value)} />
              </Field>
              <div className="flex justify-end">
                <Button onClick={handleDisposition} disabled={!disposition || acting}>
                  Record Disposition
                </Button>
              </div>
            </>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-4">
                <Info
                  label="Disposition"
                  value={ncr.disposition ? NCR_DISPOSITION_LABEL[ncr.disposition] : '—'}
                />
                {ncr.dispositionedAt && (
                  <Info label="Dispositioned On" value={dateOnlyStr(ncr.dispositionedAt)} />
                )}
              </div>
              {ncr.dispositionNotes && (
                <p className="text-sm text-muted-foreground">{ncr.dispositionNotes}</p>
              )}
              {ncr.status === 'DISPOSITIONED' && (
                <div className="flex justify-end">
                  <Button variant="outline" onClick={handleClose} disabled={acting}>
                    Close NCR
                  </Button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </PageContainer>
  );
}

function Info({
  label,
  value,
  href,
  emphasize,
}: {
  label: string;
  value: string;
  href?: string;
  emphasize?: boolean;
}) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`mt-0.5 text-sm font-medium ${emphasize ? 'text-destructive' : ''}`}>
        {href ? (
          <Link href={href} className="text-primary hover:underline">
            {value}
          </Link>
        ) : (
          value
        )}
      </div>
    </div>
  );
}
