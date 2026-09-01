'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Check, Download, Mail, PackagePlus, X } from 'lucide-react';
import { ApiError } from '../../../../lib/api';
import { useAuth } from '../../../../lib/auth-context';
import {
  getPurchaseOrder,
  listGrns,
  issuePurchaseOrder,
  cancelPurchaseOrder,
  approveAdHocPurchaseOrder,
  rejectAdHocPurchaseOrder,
  emailPurchaseOrder,
  isGrnFinalized,
  type PurchaseOrder,
  type GoodsReceiptNote,
} from '../../../../lib/stores';
import { inviteEmailMessage } from '../../../../lib/invite-email';
import { formatINR } from '../../../../lib/sales';
import { useNumberFormat } from '../../../../lib/number-format-context';
import { dateOnlyStr, todayDateStr } from '../../../../lib/date';
import { PageContainer } from '../../../../components/ui/page-container';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '../../../../components/ui/card';
import { Button } from '../../../../components/ui/button';
import { Input } from '../../../../components/ui/input';
import { Textarea } from '../../../../components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../../components/ui/dialog';
import { Skeleton } from '../../../../components/ui/skeleton';
import { StatusBadge } from '../../../../components/ui/status-badge';
import { ProcessFlow } from '../../../../components/ui/process-flow';
import { poFlow } from '../../../../lib/record-flows';
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
import { PurchaseOrderPrintDocument } from '../_components/po-print-document';

export default function PurchaseOrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const { user } = useAuth();
  const { style: numberFormatStyle } = useNumberFormat();

  const [po, setPo] = useState<PurchaseOrder | null>(null);
  const [grns, setGrns] = useState<GoodsReceiptNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState(false);
  const [rejectionComment, setRejectionComment] = useState('');
  const [emailOpen, setEmailOpen] = useState(false);
  const [emailTo, setEmailTo] = useState('');
  const [emailNote, setEmailNote] = useState('');
  const [emailing, setEmailing] = useState(false);

  const canManage = user?.role === 'SUPER_ADMIN' || user?.role === 'MANAGER';

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [poData, grnData] = await Promise.all([
        getPurchaseOrder(id),
        listGrns({ purchaseOrderId: id }),
      ]);
      setPo(poData);
      setGrns(grnData);
    } catch {
      setError('Failed to load purchase order.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  // Computed received quantity per PO line: sum of ACCEPTED quantities across
  // all finalized GRNs against that line. Received-but-not-yet-inspected qty is
  // shown separately so the two aren't conflated.
  function receivedFor(poLineId: string): { accepted: number; pending: number } {
    let accepted = 0;
    let pending = 0;
    for (const grn of grns) {
      if (grn.status === 'CANCELLED') continue;
      for (const line of grn.lines) {
        if (line.purchaseOrderLineId !== poLineId) continue;
        if (isGrnFinalized(grn.status)) {
          accepted += Number(line.acceptedQuantity ?? 0);
        } else {
          pending += Number(line.receivedQuantity);
        }
      }
    }
    return { accepted, pending };
  }

  async function handleIssue() {
    if (!po) return;
    if (!(await confirm({ title: 'Issue purchase order', description: `Issue ${po.poNumber}? It can no longer be edited.`, confirmLabel: 'Issue' }))) return;
    setActing(true);
    try {
      await issuePurchaseOrder(po.id);
      toast.success('Purchase order issued');
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to issue');
    } finally {
      setActing(false);
    }
  }

  async function handleCancel() {
    if (!po) return;
    if (!(await confirm({ title: 'Cancel purchase order', description: `Cancel ${po.poNumber}?`, confirmLabel: 'Cancel PO', destructive: true }))) return;
    setActing(true);
    try {
      await cancelPurchaseOrder(po.id);
      toast.success('Purchase order cancelled');
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to cancel');
    } finally {
      setActing(false);
    }
  }

  async function handleApproveAdHoc() {
    if (!po) return;
    if (!(await confirm({
      title: 'Approve ad-hoc purchase order',
      description: `Approve ${po.poNumber} for ${po.adHocPartyName}? SCM may then issue it and receive goods against it.`,
      confirmLabel: 'Approve',
    }))) return;
    setActing(true);
    try {
      await approveAdHocPurchaseOrder(po.id);
      toast.success('Ad-hoc purchase order approved');
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to approve');
    } finally {
      setActing(false);
    }
  }

  async function handleRejectAdHoc() {
    if (!po || !rejectionComment.trim()) {
      toast.error('Enter a rejection reason before rejecting');
      return;
    }
    if (!(await confirm({
      title: 'Reject ad-hoc purchase order',
      description: `Reject ${po.poNumber}? This decision is terminal.`,
      confirmLabel: 'Reject',
      destructive: true,
    }))) return;
    setActing(true);
    try {
      await rejectAdHocPurchaseOrder(po.id, rejectionComment.trim());
      toast.success('Ad-hoc purchase order rejected');
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to reject');
    } finally {
      setActing(false);
    }
  }

  /**
   * Emailing the order to the party. Deliberately a dialog rather than a
   * one-click send: the address is worth showing before an order leaves the
   * company, an ad-hoc party has none on file, and the covering note is often
   * where the real instruction lives ("freight to our account").
   */
  function openEmailDialog() {
    if (!po) return;
    setEmailTo(po.partyEmail ?? '');
    setEmailNote('');
    setEmailOpen(true);
  }

  async function handleEmail() {
    if (!po) return;
    const to = emailTo.trim();
    if (!to) {
      toast.error('Enter the address to send this purchase order to');
      return;
    }
    setEmailing(true);
    try {
      const result = await emailPurchaseOrder(po.id, {
        // Only send an override when it differs from the registered address, so
        // the server keeps owning the default.
        ...(to === po.partyEmail ? {} : { to }),
        ...(emailNote.trim() ? { note: emailNote.trim() } : {}),
      });
      // A dry-run or allowlist-suppressed send is reported as held, never as
      // sent — a buyer who believes the supplier has the order and waits is
      // worse off than one who is told the mail was not delivered.
      const message = inviteEmailMessage(result, to, 'Purchase order');
      if (message.tone === 'success') toast.success(message.text);
      else toast.toast({ title: 'Email not sent', description: message.text });
      setEmailOpen(false);
      await load();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : 'Failed to email the purchase order',
      );
    } finally {
      setEmailing(false);
    }
  }

  /**
   * Print/Save-as-PDF. Chrome prints the browser tab title (document.title) in
   * its own page header — swap it to a clean line for the duration of the
   * print, then restore it so the app tab title is unaffected. Mirrors the Bid
   * Techno-Commercial Proposal print flow.
   */
  function printPurchaseOrder() {
    const previous = document.title;
    document.title = 'System generated by PhazeOne';
    const restore = () => {
      document.title = previous;
      window.removeEventListener('afterprint', restore);
    };
    window.addEventListener('afterprint', restore);
    window.print();
    // Fallback for browsers that don't fire afterprint reliably.
    setTimeout(restore, 1000);
  }

  if (loading) {
    return (
      <PageContainer>
        <Skeleton className="mb-4 h-8 w-64" />
        <Skeleton className="h-64 w-full" />
      </PageContainer>
    );
  }
  if (error || !po) {
    return (
      <PageContainer>
        <p className="text-sm text-destructive">{error ?? 'Not found.'}</p>
        <Button variant="outline" className="mt-4" onClick={() => router.push('/stores/purchase-orders')}>
          <ArrowLeft className="size-4" /> Back
        </Button>
      </PageContainer>
    );
  }

  const canReceive = po.status === 'ISSUED' || po.status === 'PARTIALLY_RECEIVED';
  const partyLabel = po.supplierId ? 'Supplier' : po.vendorId ? 'Vendor' : 'Party';
  // A DRAFT is not yet an order and an unapproved ad-hoc PO is not yet a
  // commitment — neither may be put in front of a supplier. The server enforces
  // the same list; this only keeps the button off the page.
  const canEmail =
    canManage &&
    (po.status === 'ISSUED' ||
      po.status === 'PARTIALLY_RECEIVED' ||
      po.status === 'FULLY_RECEIVED');

  return (
    <>
      {/* Hidden on screen; the only thing shown when printing / Save-as-PDF. */}
      <PurchaseOrderPrintDocument po={po} generatedOn={todayDateStr()} />

      <PageContainer>
      <div className="mb-4">
        <Link
          href="/stores/purchase-orders"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> Purchase Orders
        </Link>
      </div>

      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-3 text-2xl font-semibold tracking-tight">
            {po.poNumber}
            <StatusBadge value={po.status} />
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {po.supplierName ?? po.vendorName ?? po.adHocPartyName} ·{' '}
            {po.supplierId ? 'Supplier' : po.vendorId ? 'Vendor' : 'Ad-hoc / Unlisted Party'}
          </p>
          {/* Whether the order has actually reached them, and where — the
              question a buyer asks before chasing a supplier. */}
          {po.lastEmailedAt && (
            <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
              <Mail className="size-3" />
              Emailed to {po.lastEmailedTo} on {dateOnlyStr(po.lastEmailedAt)}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="outline" onClick={printPurchaseOrder}>
            <Download className="size-4" /> Download PDF
          </Button>
          {canEmail && (
            <Button variant="outline" onClick={openEmailDialog} disabled={emailing}>
              <Mail className="size-4" />
              {po.lastEmailedAt ? `Resend to ${partyLabel}` : `Email to ${partyLabel}`}
            </Button>
          )}
          {canReceive && (
            <Button onClick={() => router.push(`/stores/grn/new?poId=${po.id}`)}>
              <PackagePlus className="size-4" /> Receive Goods (GRN)
            </Button>
          )}
          {canManage && po.status === 'DRAFT' && (
            <Button variant="outline" onClick={handleIssue} disabled={acting}>
              Issue
            </Button>
          )}
          {canManage && (po.status === 'DRAFT' || po.status === 'ISSUED') && (
            <Button variant="destructive" onClick={handleCancel} disabled={acting}>
              Cancel
            </Button>
          )}
        </div>
      </div>

      {/* Live flow indicator — stage derived from the PO's status. */}
      <ProcessFlow title="PO progress" className="mb-6" {...poFlow(po.status)} />

      {po.status === 'PENDING_CEO_APPROVAL' && (
        <Card className="mb-6 border-warning/40 bg-warning/10">
          <CardHeader>
            <CardTitle className="text-base">CEO/SuperAdmin approval required</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              This PO uses the unlisted party <strong className="text-foreground">{po.adHocPartyName}</strong>.
              It cannot be issued or used to receive a GRN until approved.
            </p>
            {po.adHocContactInfo && <Info label="Contact" value={po.adHocContactInfo} />}
            {po.adHocPartyAddress && <Info label="Address" value={po.adHocPartyAddress} />}
            {user?.role === 'SUPER_ADMIN' && (
              <div className="space-y-3 border-t pt-4">
                <Textarea
                  value={rejectionComment}
                  onChange={(e) => setRejectionComment(e.target.value)}
                  placeholder="Rejection reason (required only when rejecting)"
                />
                <div className="flex gap-2">
                  <Button onClick={handleApproveAdHoc} disabled={acting}>
                    <Check className="size-4" /> Approve exception
                  </Button>
                  <Button variant="destructive" onClick={handleRejectAdHoc} disabled={acting || !rejectionComment.trim()}>
                    <X className="size-4" /> Reject
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {po.status === 'REJECTED' && po.rejectionComment && (
        <Card className="mb-6 border-destructive/40">
          <CardHeader><CardTitle className="text-base text-destructive">PO rejected</CardTitle></CardHeader>
          <CardContent className="text-sm">{po.rejectionComment}</CardContent>
        </Card>
      )}

      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Info label="Order Date" value={dateOnlyStr(po.orderDate)} />
        <Info label="Expected Delivery" value={po.expectedDeliveryDate ? dateOnlyStr(po.expectedDeliveryDate) : '—'} />
        <Info label="Raised By" value={po.createdByName ?? '—'} />
        <Info label="Total Value" value={formatINR(po.totalAmount, numberFormatStyle)} />
      </div>

      {po.notes && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-sm">Notes</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">{po.notes}</CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Line Items</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead className="text-right">Ordered</TableHead>
                <TableHead className="text-right">Received (accepted)</TableHead>
                <TableHead className="text-right">Unit Price</TableHead>
                <TableHead className="text-right">Line Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {po.lines.map((line) => {
                const rec = receivedFor(line.id);
                return (
                  <TableRow key={line.id}>
                    <TableCell>
                      <div className="font-medium">{line.itemName}</div>
                      <div className="text-xs text-muted-foreground">
                        {line.itemCode ?? 'Free-text line · non-inventory'}
                      </div>
                      {line.adHocDescription && (
                        <div className="mt-1 text-xs text-muted-foreground">
                          {line.adHocDescription}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {line.orderedQuantity} {line.unitOfMeasure}
                    </TableCell>
                    <TableCell className="text-right">
                      <span className="font-medium">{rec.accepted}</span>
                      {rec.pending > 0 && (
                        <span className="ml-1 text-xs text-warning">
                          (+{rec.pending} pending QC)
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">{formatINR(line.unitPrice, numberFormatStyle)}</TableCell>
                    <TableCell className="text-right">{formatINR(line.lineTotal, numberFormatStyle)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {grns.length > 0 && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="text-base">Goods Receipts</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>GRN No.</TableHead>
                  <TableHead>Received</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {grns.map((grn) => (
                  <TableRow
                    key={grn.id}
                    className="cursor-pointer"
                    onClick={() => router.push(`/stores/grn/${grn.id}`)}
                  >
                    <TableCell className="font-medium text-primary">{grn.grnNumber}</TableCell>
                    <TableCell>{dateOnlyStr(grn.receivedDate)}</TableCell>
                    <TableCell>
                      <StatusBadge value={grn.status} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Dialog open={emailOpen} onOpenChange={(open) => !emailing && setEmailOpen(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {po.lastEmailedAt ? 'Resend' : 'Email'} {po.poNumber}
            </DialogTitle>
            <DialogDescription>
              Sends the order as a PDF attachment to{' '}
              {po.supplierName ?? po.vendorName ?? po.adHocPartyName}
              {po.lastEmailedAt
                ? '. The email will say it is a repeat, not a new order.'
                : '.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <label htmlFor="po-email-to" className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Send to
              </label>
              <Input
                id="po-email-to"
                type="email"
                value={emailTo}
                onChange={(e) => setEmailTo(e.target.value)}
                placeholder="supplier@example.com"
                className="mt-1"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                {po.partyEmail
                  ? `Contact on record: ${po.partyEmail}. Change it to send elsewhere this time only — the ${partyLabel.toLowerCase()} master is not updated.`
                  : 'This party has no email on record, so an address is required here.'}
              </p>
            </div>
            <div>
              <label htmlFor="po-email-note" className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Note (optional)
              </label>
              <Textarea
                id="po-email-note"
                value={emailNote}
                onChange={(e) => setEmailNote(e.target.value)}
                placeholder="e.g. Freight is to our account. Please confirm the dispatch date."
                className="mt-1"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Added to the covering email. The attached order is unchanged — use
                the PO notes for anything that must appear on the document itself.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEmailOpen(false)} disabled={emailing}>
              Cancel
            </Button>
            <Button onClick={handleEmail} disabled={emailing || !emailTo.trim()}>
              <Mail className="size-4" />
              {emailing ? 'Sending…' : po.lastEmailedAt ? 'Resend order' : 'Send order'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      </PageContainer>
    </>
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
