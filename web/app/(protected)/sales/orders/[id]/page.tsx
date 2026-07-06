'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, ReceiptText } from 'lucide-react';
import { apiFetch, ApiError } from '../../../../lib/api';
import { Order, OrderStatus } from '../../../../lib/types';
import { ORDER_NEXT_STATUSES, formatINR, prettyEnum } from '../../../../lib/sales';
import { PageContainer } from '../../../../components/ui/page-container';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '../../../../components/ui/card';
import { Button } from '../../../../components/ui/button';
import { Select } from '../../../../components/ui/select';
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
import { ProductCell } from '../../_components/product-cell';

export default function OrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const toast = useToast();
  const confirm = useConfirm();

  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nextStatus, setNextStatus] = useState<OrderStatus | ''>('');
  const [acting, setActing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const o = await apiFetch<Order>(`/orders/${id}`);
      setOrder(o);
      setNextStatus('');
    } catch {
      setError('Failed to load order');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function updateStatus() {
    if (!nextStatus) return;
    const ok = await confirm(
      nextStatus === 'CANCELLED'
        ? {
            title: 'Cancel this order?',
            description: 'This cannot be undone.',
            destructive: true,
          }
        : {
            title: 'Update order status?',
            description: `The order status will change to ${prettyEnum(
              nextStatus,
            )}.`,
          },
    );
    if (!ok) return;
    setActing(true);
    try {
      await apiFetch(`/orders/${id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: nextStatus }),
      });
      await load();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : 'Failed to update status',
      );
    } finally {
      setActing(false);
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
  if (error || !order) {
    return (
      <PageContainer>
        <p className="text-destructive">{error ?? 'Order not found'}</p>
      </PageContainer>
    );
  }

  const nextOptions = ORDER_NEXT_STATUSES[order.status];

  return (
    <PageContainer>
      <Link
        href="/sales/orders"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Orders
      </Link>

      {/* Header row: number + status */}
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">
          {order.orderNumber}
        </h1>
        <StatusBadge value={order.status} />
      </div>

      {/* Metadata card: Total (prominent) + Linked bid (link) */}
      <Card className="mb-4">
        <CardContent className="grid gap-6 p-6 sm:grid-cols-2">
          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Total
            </div>
            <div className="mt-1 text-2xl font-semibold">
              {formatINR(order.totalAmount)}
            </div>
          </div>
          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Linked bid
            </div>
            <div className="mt-1 text-sm font-medium">
              {order.bidId ? (
                <Link
                  href={`/sales/bids/${order.bidId}`}
                  className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"
                >
                  <ReceiptText className="size-4" /> View bid
                </Link>
              ) : (
                '—'
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Line items — full width (no line-level discount on orders) */}
      <Card className="mb-4">
        <CardHeader>
          <CardTitle>Line items</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Unit Price</TableHead>
                <TableHead className="text-right">Line Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(order.lineItems ?? []).map((li) => (
                <TableRow key={li.id}>
                  <TableCell>
                    <ProductCell name={li.productName} sku={li.productSku} />
                  </TableCell>
                  <TableCell className="text-right">{li.quantity}</TableCell>
                  <TableCell className="text-right">
                    {formatINR(li.unitPrice)}
                  </TableCell>
                  <TableCell className="text-right">
                    {formatINR(li.lineTotal)}
                  </TableCell>
                </TableRow>
              ))}
              {(order.lineItems ?? []).length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={4}
                    className="text-center text-muted-foreground"
                  >
                    No line items.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Update status — small form card, not full width */}
      <Card className="max-w-[400px]">
        <CardHeader>
          <CardTitle>Update status</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {nextOptions.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              This order is in a terminal state — no further transitions.
            </p>
          ) : (
            <div className="flex items-center gap-2">
              <Select
                value={nextStatus}
                onChange={(e) => setNextStatus(e.target.value as OrderStatus)}
              >
                <option value="">Select next status…</option>
                {nextOptions.map((s) => (
                  <option key={s} value={s}>
                    {prettyEnum(s)}
                  </option>
                ))}
              </Select>
              <Button onClick={updateStatus} disabled={acting || !nextStatus}>
                {acting ? '…' : 'Update'}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </PageContainer>
  );
}
