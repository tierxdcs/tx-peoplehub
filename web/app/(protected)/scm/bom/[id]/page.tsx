'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { ApiError } from '../../../../lib/api';
import { useAuth } from '../../../../lib/auth-context';
import { useIsRndHead } from '../../../../lib/use-is-rnd-head';
import {
  approveBom,
  getBom,
  newBomRevision,
  rejectBom,
  submitBom,
  type Bom,
} from '../../../../lib/scm-bom';
import { PageContainer } from '../../../../components/ui/page-container';
import { Card, CardContent, CardHeader, CardTitle } from '../../../../components/ui/card';
import { Button } from '../../../../components/ui/button';
import { Textarea } from '../../../../components/ui/textarea';
import { Skeleton } from '../../../../components/ui/skeleton';
import { StatusBadge } from '../../../../components/ui/status-badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../../components/ui/dialog';
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

export default function BomDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const { isRndHead } = useIsRndHead();
  const toast = useToast();
  const confirm = useConfirm();

  const [bom, setBom] = useState<Bom | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [rejectComment, setRejectComment] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setBom(await getBom(id));
    } catch (err) {
      setError(
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

  async function onSubmit() {
    if (
      !(await confirm({
        title: 'Submit for approval?',
        description: 'The BOM will be locked and sent to an R&D Head for approval.',
        confirmLabel: 'Submit',
      }))
    )
      return;
    setBusy(true);
    try {
      await submitBom(id);
      toast.success('Submitted for approval.');
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to submit.');
    } finally {
      setBusy(false);
    }
  }

  async function onApprove() {
    if (
      !(await confirm({
        title: 'Approve this BOM?',
        description: 'Approving releases the BOM. This is recorded against your name.',
        confirmLabel: 'Approve',
      }))
    )
      return;
    setBusy(true);
    try {
      await approveBom(id);
      toast.success('BOM approved and released.');
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to approve.');
    } finally {
      setBusy(false);
    }
  }

  async function onReject() {
    if (!rejectComment.trim()) return;
    setBusy(true);
    try {
      await rejectBom(id, rejectComment.trim());
      toast.success('BOM rejected.');
      setRejecting(false);
      setRejectComment('');
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to reject.');
    } finally {
      setBusy(false);
    }
  }

  async function onNewRevision() {
    setBusy(true);
    try {
      const created = await newBomRevision(id);
      toast.success('New revision created.');
      router.push('/scm/bom/' + created.id);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to create revision.');
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <PageContainer>
        <Skeleton className="mb-4 h-6 w-24" />
        <Skeleton className="mb-6 h-9 w-64" />
        <Skeleton className="h-48 w-full" />
      </PageContainer>
    );
  }

  if (error || !bom) {
    return (
      <PageContainer>
        <Link
          href="/scm/bom"
          className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> Bills of Material
        </Link>
        <p className="text-destructive">{error ?? 'BOM not found'}</p>
      </PageContainer>
    );
  }

  const isCreator = bom.createdById === user?.sub;
  const canReview = bom.status === 'PENDING_APPROVAL' && isRndHead;

  return (
    <PageContainer>
      <Link
        href="/scm/bom"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Bills of Material
      </Link>

      {/* Header */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">
          {bom.itemCode ? `${bom.itemCode} — ${bom.itemName ?? ''}` : 'BOM'}
        </h1>
        <span className="text-lg text-muted-foreground">Rev {bom.revisionNumber}</span>
        <StatusBadge value={bom.status} />
      </div>

      {/* Workflow actions */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {(bom.status === 'DRAFT' || bom.status === 'REJECTED') && (
          <>
            <Button
              variant="outline"
              onClick={() => router.push('/scm/bom/' + id + '/edit')}
              disabled={busy}
            >
              Edit
            </Button>
            <Button onClick={onSubmit} disabled={busy}>
              Submit for Approval
            </Button>
          </>
        )}
        {canReview && !isCreator && (
          <>
            <Button onClick={onApprove} disabled={busy}>
              Approve
            </Button>
            <Button
              variant="destructive"
              onClick={() => setRejecting(true)}
              disabled={busy}
            >
              Reject
            </Button>
          </>
        )}
        {canReview && isCreator && (
          <p className="text-sm text-muted-foreground">
            You created this BOM; another R&D Head must approve it.
          </p>
        )}
        {bom.status === 'PENDING_APPROVAL' && !isRndHead && (
          <p className="text-sm text-muted-foreground">
            Awaiting technical approval. Only a designated R&D Head can approve
            or reject this BOM. An admin can designate an R&D-vertical employee
            as an R&D Head from Admin → Employees.
          </p>
        )}
        {bom.status === 'RELEASED' && (
          <Button variant="outline" onClick={onNewRevision} disabled={busy}>
            Create New Revision
          </Button>
        )}
      </div>

      {bom.status === 'RELEASED' && (
        <p className="mb-4 text-sm text-muted-foreground">
          Released BOMs are immutable. Create a new revision to make changes.
        </p>
      )}

      {/* Info card */}
      <Card className="mb-4">
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-x-8 gap-y-2 pt-0 text-sm sm:grid-cols-2">
          <Info label="Item code" value={bom.itemCode ?? '—'} />
          <Info label="Item type" value={bom.itemType ?? '—'} />
          <Info label="Creator" value={bom.createdByName ?? '—'} />
          <Info
            label="Submitted"
            value={
              bom.submittedAt
                ? new Date(bom.submittedAt).toLocaleDateString()
                : '—'
            }
          />
          <Info
            label="Approved by"
            value={
              bom.approvedByName
                ? `${bom.approvedByName}${
                    bom.approvedAt
                      ? ' · ' + new Date(bom.approvedAt).toLocaleDateString()
                      : ''
                  }`
                : '—'
            }
          />
          <Info
            label="Effective date"
            value={
              bom.effectiveDate
                ? new Date(bom.effectiveDate).toLocaleDateString()
                : '—'
            }
          />
          <Info label="Revision notes" value={bom.revisionNotes ?? '—'} />
          {bom.approverSignatureTextSnapshot && (
            <Info
              label="Approved signature"
              value={bom.approverSignatureTextSnapshot}
            />
          )}
        </CardContent>
      </Card>

      {/* Rejection note */}
      {bom.status === 'REJECTED' && bom.rejectionComment && (
        <Card className="mb-4 border-destructive">
          <CardHeader>
            <CardTitle className="text-destructive">Rejected</CardTitle>
          </CardHeader>
          <CardContent className="pt-0 text-sm text-destructive">
            {bom.rejectionComment}
          </CardContent>
        </Card>
      )}

      {/* Lines */}
      <Card className="mb-4">
        <CardHeader>
          <CardTitle>Components</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>#</TableHead>
                <TableHead>Code</TableHead>
                <TableHead>Item</TableHead>
                <TableHead>Qty / unit</TableHead>
                <TableHead>UoM</TableHead>
                <TableHead>Wastage %</TableHead>
                <TableHead>Make / Buy</TableHead>
                <TableHead>Notes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bom.lines.map((l) => (
                <TableRow key={l.id}>
                  <TableCell>{l.sequence}</TableCell>
                  <TableCell className="font-medium">{l.itemCode}</TableCell>
                  <TableCell>{l.itemName}</TableCell>
                  <TableCell>{l.quantityPerUnit}</TableCell>
                  <TableCell>{l.unitOfMeasure}</TableCell>
                  <TableCell>{l.wastagePercent}</TableCell>
                  <TableCell>{l.makeBuy === 'MAKE' ? 'Make' : 'Buy'}</TableCell>
                  <TableCell>{l.notes ?? '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Revision history */}
      {bom.events && bom.events.length > 0 && (
        <Card className="mb-4">
          <CardHeader>
            <CardTitle>History</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Event</TableHead>
                  <TableHead>Actor</TableHead>
                  <TableHead>Comment</TableHead>
                  <TableHead>When</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bom.events.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="font-medium">{e.type}</TableCell>
                    <TableCell>{e.actorName ?? '—'}</TableCell>
                    <TableCell>{e.comment ?? '—'}</TableCell>
                    <TableCell>
                      {new Date(e.createdAt).toLocaleString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Reject dialog */}
      <Dialog open={rejecting} onOpenChange={(o) => !o && setRejecting(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject BOM</DialogTitle>
            <DialogDescription>
              Explain what needs to change. A comment is required and shown to the
              author.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            rows={4}
            value={rejectComment}
            onChange={(e) => setRejectComment(e.target.value)}
            placeholder="Reason for rejection…"
          />
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRejecting(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={onReject}
              disabled={busy || !rejectComment.trim()}
            >
              Reject
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <div>{value}</div>
    </div>
  );
}
