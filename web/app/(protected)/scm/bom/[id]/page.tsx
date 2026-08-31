'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Pencil } from 'lucide-react';
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
  type BomLine,
} from '../../../../lib/scm-bom';
import {
  ITEM_TYPE_LABEL,
  updateItem,
  type ItemType,
} from '../../../../lib/scm-item-master';
import { PageContainer } from '../../../../components/ui/page-container';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '../../../../components/ui/card';
import { Button } from '../../../../components/ui/button';
import { Field } from '../../../../components/ui/field';
import { Input } from '../../../../components/ui/input';
import { Select } from '../../../../components/ui/select';
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
  // The component line whose Item the reviewer is correcting, plus the drafts.
  const [editingLine, setEditingLine] = useState<BomLine | null>(null);
  const [itemName, setItemName] = useState('');
  const [itemType, setItemType] = useState<ItemType>('COMPONENT');

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

  function openItemEditor(line: BomLine) {
    setEditingLine(line);
    setItemName(line.itemName);
    setItemType(line.itemType);
  }

  /**
   * Correct a component's Item master record from inside the review — Sales
   * transcribes intake lines and every new Item lands as a COMPONENT, so the
   * reviewer is the first person who can actually classify it. Writes to the
   * Item (PATCH /items/:id, R&D Head/SA), not to the BOM line, so the BOM's
   * own approval state is untouched and the correction is visible everywhere
   * the Item appears.
   */
  async function onSaveItem() {
    if (!editingLine) return;
    const name = itemName.trim();
    if (!name) return;
    setBusy(true);
    try {
      await updateItem(editingLine.itemId, { name, itemType });
      toast.success(`${editingLine.itemCode} updated.`);
      setEditingLine(null);
      await load();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : 'Failed to update the item.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function onSubmit() {
    if (
      !(await confirm({
        title: 'Submit for approval?',
        description:
          'The BOM will be locked and sent to an R&D Head for approval.',
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
        description:
          'Approving releases the BOM. This is recorded against your name.',
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
      toast.error(
        err instanceof ApiError ? err.message : 'Failed to create revision.',
      );
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
  // Mirrors the backend's assertCanManageItems (R&D Head or SUPER_ADMIN).
  // Withheld once RELEASED: that BOM is frozen, so corrections belong to a new
  // revision or to the Item Master directly, not to a released document.
  const canEditItems =
    (isRndHead || user?.role === 'SUPER_ADMIN') &&
    bom.status !== 'RELEASED' &&
    bom.status !== 'OBSOLETE';

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
        <span className="text-lg text-muted-foreground">
          Rev {bom.revisionNumber}
        </span>
        <StatusBadge value={bom.status} />
      </div>

      {bom.customerBomIntake && bom.status !== 'RELEASED' && (
        <Card className="mb-4 border-warning/50 bg-warning/10">
          <CardHeader>
            <CardTitle>
              Sales-created quote-stage BOM — R&amp;D review required
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 pt-0 text-sm">
            <p>
              {bom.customerBomIntake.rawFileName ? (
                <>
                  Created from customer file{' '}
                  <strong>{bom.customerBomIntake.rawFileName}</strong>
                </>
              ) : (
                <>Created from manually entered customer BOM lines</>
              )}{' '}
              for {bom.customerBomIntake.opportunityName}. Verify descriptions,
              quantities, Make/Buy choices and possible duplicate Items before
              release.
            </p>
            {bom.customerBomIntake.lines.some(
              (line) =>
                line.createdNewItem && (line.fuzzyCandidates?.length ?? 0) > 0,
            ) && (
              <div className="rounded-md border border-warning/40 p-3">
                <strong>Possible missed Item matches</strong>
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  {bom.customerBomIntake.lines
                    .filter(
                      (line) =>
                        line.createdNewItem &&
                        (line.fuzzyCandidates?.length ?? 0) > 0,
                    )
                    .map((line, index) => (
                      <li key={`${line.resolvedItemId}-${index}`}>
                        {line.description}:{' '}
                        {line
                          .fuzzyCandidates!.slice(0, 3)
                          .map(
                            (candidate) =>
                              `${candidate.itemCode} ${candidate.name}`,
                          )
                          .join(', ')}
                      </li>
                    ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}

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
          {canEditItems && (
            <p className="mt-1 text-sm text-muted-foreground">
              Correct a component&apos;s name or type before releasing — Sales
              transcribes intake lines, and every Item it creates starts as a
              Component.
            </p>
          )}
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>#</TableHead>
                <TableHead>Code</TableHead>
                <TableHead>Item</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Qty / unit</TableHead>
                <TableHead>UoM</TableHead>
                <TableHead>Wastage %</TableHead>
                <TableHead>Make / Buy</TableHead>
                <TableHead>Notes</TableHead>
                {canEditItems && <TableHead className="w-10" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {bom.lines.map((l) => (
                <TableRow key={l.id}>
                  <TableCell>{l.sequence}</TableCell>
                  <TableCell className="font-medium">{l.itemCode}</TableCell>
                  <TableCell>{l.itemName}</TableCell>
                  <TableCell>
                    {ITEM_TYPE_LABEL[l.itemType] ?? l.itemType}
                  </TableCell>
                  <TableCell>{l.quantityPerUnit}</TableCell>
                  <TableCell>{l.unitOfMeasure}</TableCell>
                  <TableCell>{l.wastagePercent}</TableCell>
                  <TableCell>{l.makeBuy === 'MAKE' ? 'Make' : 'Buy'}</TableCell>
                  <TableCell>{l.notes ?? '—'}</TableCell>
                  {canEditItems && (
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Edit item ${l.itemCode}`}
                        title="Correct name or type"
                        onClick={() => openItemEditor(l)}
                        disabled={busy}
                      >
                        <Pencil className="size-4" />
                      </Button>
                    </TableCell>
                  )}
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

      {/* Correct a component Item (name / classification) */}
      <Dialog
        open={!!editingLine}
        onOpenChange={(o) => !o && setEditingLine(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit {editingLine?.itemCode}</DialogTitle>
            <DialogDescription>
              Updates the Item master record, not this BOM line. Quantity, UoM
              and Make/Buy stay part of the BOM.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Field label="Item name" htmlFor="item-name" required>
              <Input
                id="item-name"
                value={itemName}
                onChange={(e) => setItemName(e.target.value)}
                placeholder="e.g. Copper busbar, 40×5 mm"
              />
            </Field>
            <Field
              label="Item type"
              htmlFor="item-type"
              hint="Classification only — Make/Buy is what drives BOM explosion."
            >
              <Select
                id="item-type"
                value={itemType}
                onChange={(e) => setItemType(e.target.value as ItemType)}
              >
                {(
                  Object.keys(ITEM_TYPE_LABEL) as Array<
                    keyof typeof ITEM_TYPE_LABEL
                  >
                ).map((type) => (
                  <option key={type} value={type}>
                    {ITEM_TYPE_LABEL[type]}
                  </option>
                ))}
              </Select>
            </Field>
            {editingLine && itemType !== editingLine.itemType && (
              <p className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
                Item codes are permanent, so this stays{' '}
                <strong>{editingLine.itemCode}</strong> — its prefix will no
                longer match the new type.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setEditingLine(null)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button onClick={onSaveItem} disabled={busy || !itemName.trim()}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject dialog */}
      <Dialog open={rejecting} onOpenChange={(o) => !o && setRejecting(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject BOM</DialogTitle>
            <DialogDescription>
              Explain what needs to change. A comment is required and shown to
              the author.
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
