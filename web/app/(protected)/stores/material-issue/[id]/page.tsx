'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Ban } from 'lucide-react';
import { ApiError } from '../../../../lib/api';
import {
  getIndent,
  cancelIndent,
  type MaterialIndent,
} from '../../../../lib/stores';
import { listStores, type StoreLocation } from '../../../../lib/scm-inventory';
import { dateOnlyStr } from '../../../../lib/date';
import { PageContainer } from '../../../../components/ui/page-container';
import { Card, CardContent, CardHeader, CardTitle } from '../../../../components/ui/card';
import { Button } from '../../../../components/ui/button';
import { Skeleton } from '../../../../components/ui/skeleton';
import { StatusBadge } from '../../../../components/ui/status-badge';
import { EmptyState } from '../../../../components/ui/empty-state';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../../components/ui/table';
import { useToast } from '../../../../components/ui/toaster';
import { useConfirm } from '../../../../components/ui/confirm';
import { IssueDialog } from '../_components/issue-dialog';

export default function IndentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();

  const [indent, setIndent] = useState<MaterialIndent | null>(null);
  const [stores, setStores] = useState<StoreLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [issuing, setIssuing] = useState(false);
  const [acting, setActing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [ind, st] = await Promise.all([getIndent(id), listStores()]);
      setIndent(ind);
      setStores(st);
    } catch {
      setError('Failed to load indent.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleCancel() {
    if (!indent) return;
    if (!(await confirm({ title: 'Cancel indent', description: `Cancel ${indent.indentNumber}?`, confirmLabel: 'Cancel Indent', destructive: true }))) return;
    setActing(true);
    try {
      await cancelIndent(indent.id);
      toast.success('Indent cancelled');
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to cancel indent');
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
  if (error || !indent) {
    return (
      <PageContainer>
        <p className="text-sm text-destructive">{error ?? 'Not found.'}</p>
        <Button variant="outline" className="mt-4" onClick={() => router.push('/stores/material-issue')}>
          <ArrowLeft className="size-4" /> Back
        </Button>
      </PageContainer>
    );
  }

  const canIssue = indent.status === 'OPEN' || indent.status === 'PARTIALLY_ISSUED';
  const canCancel = indent.issueNotes.length === 0 && indent.status !== 'CANCELLED';

  return (
    <PageContainer className="max-w-4xl">
      <div className="mb-4">
        <Link href="/stores/material-issue" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> Material Issue
        </Link>
      </div>

      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-3 text-2xl font-semibold tracking-tight">
            {indent.indentNumber}
            <StatusBadge value={indent.status} />
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {indent.itemName} ({indent.itemCode})
            {indent.projectName ? ` · ${indent.projectName}` : ''}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {canIssue && <Button onClick={() => setIssuing(true)}>Issue</Button>}
          {canCancel && (
            <Button variant="destructive" onClick={handleCancel} disabled={acting}>
              <Ban className="size-4" /> Cancel
            </Button>
          )}
        </div>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Info label="Requested" value={indent.requestedQuantity} />
        <Info label="Issued" value={indent.issuedQuantity} />
        <Info label="Outstanding" value={indent.outstandingQuantity} />
        <Info label="Required By" value={indent.requiredByDate ? dateOnlyStr(indent.requiredByDate) : '—'} />
        <Info label="Raised By" value={indent.raisedByName ?? '—'} />
        <Info label="Raised On" value={dateOnlyStr(indent.createdAt)} />
      </div>

      {indent.notes && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-sm">Notes</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">{indent.notes}</CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Issue History</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {indent.issueNotes.length === 0 ? (
            <EmptyState icon={Ban} title="Nothing issued yet" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>MIN No.</TableHead>
                  <TableHead>Issued</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead>Store / Bin</TableHead>
                  <TableHead>By</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {indent.issueNotes.map((n) => (
                  <TableRow key={n.id}>
                    <TableCell className="font-medium">{n.minNumber}</TableCell>
                    <TableCell>{dateOnlyStr(n.issuedAt)}</TableCell>
                    <TableCell className="text-right">{n.issuedQuantity}</TableCell>
                    <TableCell>
                      {n.storeLocationName ?? '—'}
                      {n.binLocation ? ` · ${n.binLocation}` : ''}
                    </TableCell>
                    <TableCell>{n.issuedByName ?? '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {issuing && (
        <IssueDialog
          indent={indent}
          stores={stores}
          onClose={() => setIssuing(false)}
          onIssued={() => {
            setIssuing(false);
            void load();
          }}
        />
      )}
    </PageContainer>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-sm font-medium">{value}</div>
    </div>
  );
}
