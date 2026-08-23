'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ReceiptText, UserRound } from 'lucide-react';
import { apiFetch, ApiError } from '../../../../lib/api';
import { useAuth } from '../../../../lib/auth-context';
import { useIsSalesHead } from '../../../../lib/use-is-sales-head';
import { Customer, Order, OrderStatus } from '../../../../lib/types';
import {
  ORDER_NEXT_STATUSES,
  formatINR,
  prettyEnum,
} from '../../../../lib/sales';
import { useNumberFormat } from '../../../../lib/number-format-context';
import {
  SCard,
  SCardTitle,
  SIGNAL_EYEBROW,
  SIGNAL_LINK,
  SignalHeader,
  SignalPage,
} from '../../../../components/ui/signal';
import { Button } from '../../../../components/ui/button';
import { Select } from '../../../../components/ui/select';
import { Skeleton } from '../../../../components/ui/skeleton';
import { StatusBadge } from '../../../../components/ui/status-badge';
import { Badge } from '../../../../components/ui/badge';
import { BusinessUnitLabel } from '../../../../components/ui/business-unit-label';
import { ProcessFlow } from '../../../../components/ui/process-flow';
import { orderFlow } from '../../../../lib/record-flows';
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
import { ConfirmationSheetsSection } from './_components/confirmation-sheets-section';
import { ProjectKickoffSection } from './_components/project-kickoff-section';
import { PlmSection } from './_components/plm-section';
import { CustomerProgressLinks } from './_components/customer-progress-links';

export default function OrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const toast = useToast();
  const confirm = useConfirm();
  const { user } = useAuth();
  const { isSalesHead } = useIsSalesHead();
  const { style: numberFormatStyle } = useNumberFormat();

  const [order, setOrder] = useState<Order | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nextStatus, setNextStatus] = useState<OrderStatus | ''>('');
  const [acting, setActing] = useState(false);
  // Whether the order's latest confirmation sheet is EXECUTED — reported up
  // from the sheets section, so the CONFIRMED→IN_PRODUCTION gate re-enables
  // live when a sheet is signed (no reload).
  const [latestExecuted, setLatestExecuted] = useState(false);

  const handleLatestExecutedChange = useCallback((executed: boolean) => {
    setLatestExecuted(executed);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const o = await apiFetch<Order>(`/orders/${id}`);
      setOrder(o);
      setNextStatus('');
      // Recipient details for the printable confirmation sheet — best-effort
      // so a customer-fetch failure never blocks the order view itself.
      try {
        setCustomer(await apiFetch<Customer>(`/customers/${o.customerId}`));
      } catch {
        setCustomer(null);
      }
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
      <SignalPage>
        <div className="px-5 py-[18px] lg:px-7">
          <Skeleton className="mb-4 h-6 w-24" />
          <Skeleton className="mb-6 h-9 w-64" />
          <Skeleton className="h-48 w-full" />
        </div>
      </SignalPage>
    );
  }
  if (error || !order) {
    return (
      <SignalPage>
        <div className="px-5 py-[18px] lg:px-7">
          <p className="text-destructive">{error ?? 'Order not found'}</p>
        </div>
      </SignalPage>
    );
  }

  const nextOptions = ORDER_NEXT_STATUSES[order.status];
  const isReviewer = user?.role === 'SUPER_ADMIN' || isSalesHead;
  // Frontend mirror of the backend gate: a CONFIRMED order can't advance
  // (its only forward step is IN_PRODUCTION) until its latest Order
  // Confirmation Sheet is EXECUTED. Only this step is gated — later
  // transitions (IN_PRODUCTION→READY_TO_SHIP, …) are unaffected.
  const blockedPendingConfirmation =
    order.status === 'CONFIRMED' && !latestExecuted;

  return (
    <SignalPage>
      <SignalHeader
        backHref="/sales/orders"
        backLabel="Orders"
        title={order.orderNumber}
        chip={
          <>
            {order.orderType === 'INTERNAL' && (
              <Badge variant="muted">Internal</Badge>
            )}
            <StatusBadge value={order.status} />
            <BusinessUnitLabel
              name={order.businessUnitName}
              colorHex={order.businessUnitColorHex}
            />
          </>
        }
      />

      <div className="space-y-4 px-5 pb-7 pt-[18px] lg:px-7">

      {/* Live flow indicator — stage derived from the order's status. */}
      <ProcessFlow title="Order progress" {...orderFlow(order.status)} />

      {/* Metadata card: Total (prominent) + Linked bid (link) */}
      <SCard className="px-5 py-[18px]">
        <div className="grid gap-6 sm:grid-cols-3">
          <div>
            <div className={SIGNAL_EYEBROW}>Total</div>
            <div className="mt-1.5 text-2xl font-bold tabular-nums tracking-[-1px]">
              {formatINR(order.totalAmount, numberFormatStyle)}
            </div>
          </div>
          <div>
            <div className={SIGNAL_EYEBROW}>Owner</div>
            <div className="mt-1.5 flex items-center gap-2 text-sm font-medium">
              <UserRound className="size-4 text-black/45 dark:text-white/40" />
              {order.ownerName}
            </div>
          </div>
          <div>
            <div className={SIGNAL_EYEBROW}>Linked bid</div>
            <div className="mt-1.5 text-sm font-medium">
              {order.bidId ? (
                <Link
                  href={`/sales/bids/${order.bidId}`}
                  className={`inline-flex items-center gap-1 ${SIGNAL_LINK}`}
                >
                  <ReceiptText className="size-4" /> View bid
                </Link>
              ) : (
                '—'
              )}
            </div>
          </div>
        </div>
      </SCard>

      {/* Line items — full width (no line-level discount on orders) */}
      <SCard className="overflow-hidden">
        <div className="px-5 pb-3.5 pt-[18px]">
          <SCardTitle title="Line items" />
        </div>
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
                    <div className="flex items-center gap-2">
                      <ProductCell name={li.productName} sku={li.productSku} />
                      {li.isAdHoc && (
                        <Badge variant="warning">Awaiting setup</Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">{li.quantity}</TableCell>
                  <TableCell className="text-right">
                    {formatINR(li.unitPrice, numberFormatStyle)}
                  </TableCell>
                  <TableCell className="text-right">
                    {formatINR(li.lineTotal, numberFormatStyle)}
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
      </SCard>

      {/* Update status — small form card, not full width */}
      <SCard className="max-w-[400px] px-5 py-[18px]">
        <SCardTitle title="Update status" />
        <div className="mt-4">
          {nextOptions.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              This order is in a terminal state — no further transitions.
            </p>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <Select
                  value={nextStatus}
                  onChange={(e) => setNextStatus(e.target.value as OrderStatus)}
                  disabled={blockedPendingConfirmation}
                >
                  <option value="">Select next status…</option>
                  {nextOptions.map((s) => (
                    <option key={s} value={s}>
                      {prettyEnum(s)}
                    </option>
                  ))}
                </Select>
                <Button
                  onClick={updateStatus}
                  disabled={acting || !nextStatus || blockedPendingConfirmation}
                >
                  {acting ? '…' : 'Update'}
                </Button>
              </div>
              {blockedPendingConfirmation && (
                <p className="mt-2 text-sm text-muted-foreground">
                  Requires an executed Order Confirmation Sheet before this
                  order can move to production.
                </p>
              )}
            </>
          )}
        </div>
      </SCard>

      <ConfirmationSheetsSection
        orderId={order.id}
        canWrite
        isReviewer={isReviewer}
        customer={customer}
        onLatestExecutedChange={handleLatestExecutedChange}
      />

      <ProjectKickoffSection
        orderId={order.id}
        orderNumber={order.orderNumber}
        latestExecuted={latestExecuted}
        customerName={customer?.name ?? null}
      />

      <PlmSection orderId={order.id} />
      <CustomerProgressLinks orderId={order.id} />
      </div>
    </SignalPage>
  );
}
