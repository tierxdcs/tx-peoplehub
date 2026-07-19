'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, PackagePlus } from 'lucide-react';
import { ApiError } from '../../../../lib/api';
import { useAuth } from '../../../../lib/auth-context';
import {
  getPurchaseOrder,
  listGrns,
  issuePurchaseOrder,
  cancelPurchaseOrder,
  isGrnFinalized,
  type PurchaseOrder,
  type GoodsReceiptNote,
} from '../../../../lib/stores';
import { formatINR } from '../../../../lib/sales';
import { dateOnlyStr } from '../../../../lib/date';
import { PageContainer } from '../../../../components/ui/page-container';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '../../../../components/ui/card';
import { Button } from '../../../../components/ui/button';
import { Skeleton } from '../../../../components/ui/skeleton';
import { StatusBadge } from '../../../../components/ui/status-badge';
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

export default function PurchaseOrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const { user } = useAuth();

  const [po, setPo] = useState<PurchaseOrder | null>(null);
  const [grns, setGrns] = useState<GoodsReceiptNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState(false);

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

  return (
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
            {po.supplierName ?? po.vendorName} · {po.supplierId ? 'Supplier' : 'Vendor'}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
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

      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Info label="Order Date" value={dateOnlyStr(po.orderDate)} />
        <Info label="Expected Delivery" value={po.expectedDeliveryDate ? dateOnlyStr(po.expectedDeliveryDate) : '—'} />
        <Info label="Raised By" value={po.createdByName ?? '—'} />
        <Info label="Total Value" value={formatINR(po.totalAmount)} />
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
                      <div className="text-xs text-muted-foreground">{line.itemCode}</div>
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
                    <TableCell className="text-right">{formatINR(line.unitPrice)}</TableCell>
                    <TableCell className="text-right">{formatINR(line.lineTotal)}</TableCell>
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
