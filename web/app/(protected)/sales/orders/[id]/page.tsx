'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  PenLine,
  ReceiptText,
  SquarePen,
  Trash2,
  UserRound,
} from 'lucide-react';
import { apiFetch, ApiError } from '../../../../lib/api';
import { useAuth } from '../../../../lib/auth-context';
import { useIsSalesHead } from '../../../../lib/use-is-sales-head';
import {
  Customer,
  Order,
  OrderLineItem,
  OrderStatus,
} from '../../../../lib/types';
import {
  ORDER_NEXT_STATUSES,
  formatINR,
  prettyEnum,
} from '../../../../lib/sales';
import { useNumberFormat } from '../../../../lib/number-format-context';
import {
  Callout,
  SCard,
  SCardTitle,
  SIGNAL_BTN_GHOST,
  SIGNAL_BTN_PRIMARY,
  SIGNAL_DIALOG,
  SIGNAL_DIALOG_TITLE,
  SIGNAL_EYEBROW,
  SIGNAL_LINK,
  SignalHeader,
  SignalPage,
} from '../../../../components/ui/signal';
import { Button } from '../../../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../../components/ui/dialog';
import { Field } from '../../../../components/ui/field';
import { Input } from '../../../../components/ui/input';
import { Textarea } from '../../../../components/ui/textarea';
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

  // Per-line customer-facing wording editor (display-only override — the
  // underlying Product/BOM/PLM keying is untouched by design).
  const [editingLine, setEditingLine] = useState<OrderLineItem | null>(null);
  const [cfName, setCfName] = useState('');
  const [cfDescription, setCfDescription] = useState('');
  const [savingCf, setSavingCf] = useState(false);

  function openCustomerFacingEditor(li: OrderLineItem) {
    setCfName(li.customerFacingProductName ?? '');
    setCfDescription(li.customerFacingDescription ?? '');
    setEditingLine(li);
  }

  async function saveCustomerFacing() {
    if (!editingLine) return;
    setSavingCf(true);
    try {
      await apiFetch(
        `/orders/${id}/line-items/${editingLine.id}/customer-facing`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            customerFacingProductName: cfName.trim() || null,
            customerFacingDescription: cfDescription.trim() || null,
          }),
        },
      );
      toast.success('Customer-facing wording updated');
      setEditingLine(null);
      await load();
    } catch (err) {
      toast.error(
        err instanceof ApiError
          ? err.message
          : 'Failed to update customer-facing wording',
      );
    } finally {
      setSavingCf(false);
    }
  }

  // Per-line commercial editor — the customer PO that arrives after a
  // quotation rarely covers every quoted item at the quoted rate.
  const [pricingLine, setPricingLine] = useState<OrderLineItem | null>(null);
  const [qtyInput, setQtyInput] = useState('');
  const [priceInput, setPriceInput] = useState('');
  const [savingLine, setSavingLine] = useState(false);
  const [removingLineId, setRemovingLineId] = useState<string | null>(null);

  function openLineEditor(li: OrderLineItem) {
    setQtyInput(li.quantity);
    setPriceInput(li.unitPrice);
    setPricingLine(li);
  }

  /** Money/quantity precision is Decimal(14,2) server-side; match it here so a
   * stray third decimal isn't rejected as a validation error. */
  function toTwoPlaces(raw: string): number {
    return Number(Number(raw).toFixed(2));
  }

  async function saveLine() {
    if (!pricingLine) return;
    const quantity = toTwoPlaces(qtyInput);
    const unitPrice = toTwoPlaces(priceInput);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      toast.error('Quantity must be greater than zero');
      return;
    }
    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      toast.error('Unit price cannot be negative');
      return;
    }
    setSavingLine(true);
    try {
      await apiFetch(`/orders/${id}/line-items/${pricingLine.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ quantity, unitPrice }),
      });
      toast.success('Line item updated');
      setPricingLine(null);
      await load();
    } catch (err) {
      toast.error(
        err instanceof ApiError
          ? err.message
          : 'Failed to update the line item',
      );
    } finally {
      setSavingLine(false);
    }
  }

  async function removeLine(li: OrderLineItem) {
    const ok = await confirm({
      title: `Remove ${li.productName}?`,
      description:
        'The line is dropped from this order and the order total re-derived. Refused if design (PLM), QC or dispatch work already references it.',
      destructive: true,
    });
    if (!ok) return;
    setRemovingLineId(li.id);
    try {
      await apiFetch(`/orders/${id}/line-items/${li.id}`, { method: 'DELETE' });
      toast.success('Line item removed');
      await load();
    } catch (err) {
      toast.error(
        err instanceof ApiError
          ? err.message
          : 'Failed to remove the line item',
      );
    } finally {
      setRemovingLineId(null);
    }
  }

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
  // Mirrors the backend gate: quantity/price corrections and line removals stop
  // at CONFIRMED — from production onwards, material planning, PLM and dispatch
  // have committed to these quantities.
  const canEditLines = order.status === 'CONFIRMED';

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
            <SCardTitle
              title="Line items"
              subtitle={
                canEditLines
                  ? "Adjust quantity or unit price, or drop a line the customer's PO didn't cover. Locked once the order enters production."
                  : `Locked — line items can only be changed while an order is Confirmed (this order is ${prettyEnum(
                      order.status,
                    )}).`
              }
            />
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Unit Price</TableHead>
                <TableHead className="text-right">Line Total</TableHead>
                {canEditLines && (
                  <TableHead className="w-[88px] text-right">Actions</TableHead>
                )}
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
                      <button
                        type="button"
                        onClick={() => openCustomerFacingEditor(li)}
                        title="Edit customer-facing wording"
                        className="text-black/40 transition-colors hover:text-black/70 dark:text-white/40 dark:hover:text-white/70"
                      >
                        <PenLine className="size-3.5" />
                      </button>
                    </div>
                    {li.customerFacingProductName && (
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        Internal: {li.internalProductName}
                      </div>
                    )}
                    {li.customerFacingDescription && (
                      <div className="mt-0.5 max-w-[420px] truncate text-xs text-muted-foreground">
                        {li.customerFacingDescription}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-right">{li.quantity}</TableCell>
                  <TableCell className="text-right">
                    {formatINR(li.unitPrice, numberFormatStyle)}
                  </TableCell>
                  <TableCell className="text-right">
                    {formatINR(li.lineTotal, numberFormatStyle)}
                  </TableCell>
                  {canEditLines && (
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => openLineEditor(li)}
                          title="Edit quantity and unit price"
                          className="text-black/40 transition-colors hover:text-black/70 dark:text-white/40 dark:hover:text-white/70"
                        >
                          <SquarePen className="size-4" />
                        </button>
                        <button
                          type="button"
                          disabled={
                            removingLineId === li.id ||
                            li.hasPlmTracker === true
                          }
                          onClick={() => void removeLine(li)}
                          title={
                            li.hasPlmTracker
                              ? 'Design (PLM) work has started on this line — it cannot be removed'
                              : "Remove this line (customer's PO didn't cover it)"
                          }
                          className="text-black/40 transition-colors hover:text-destructive disabled:opacity-40 dark:text-white/40"
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))}
              {(order.lineItems ?? []).length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={canEditLines ? 5 : 4}
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
                    onChange={(e) =>
                      setNextStatus(e.target.value as OrderStatus)
                    }
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
                    disabled={
                      acting || !nextStatus || blockedPendingConfirmation
                    }
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

      {/* Quantity / unit price correction — the received PO didn't match the
          quotation. The line keeps its id, so its delivery classification and
          any PLM tracking are untouched; the order total is re-derived (a
          bid-backed order re-applies the quotation's discount, tax and AMC). */}
      <Dialog
        open={pricingLine !== null}
        onOpenChange={(open) => !open && setPricingLine(null)}
      >
        <DialogContent className={SIGNAL_DIALOG}>
          <DialogHeader>
            <DialogTitle className={SIGNAL_DIALOG_TITLE}>
              Edit quantity &amp; unit price
            </DialogTitle>
            <DialogDescription>
              {pricingLine?.productName ?? ''} — the order total is recalculated
              from the new figures.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Field label="Quantity">
              <Input
                type="number"
                min="0"
                step="0.01"
                value={qtyInput}
                onChange={(e) => setQtyInput(e.target.value)}
              />
            </Field>
            <Field
              label="Unit price (₹)"
              hint={
                order.orderType === 'INTERNAL'
                  ? 'An internal order normally carries no pricing — leave at 0 unless you are costing this build.'
                  : undefined
              }
            >
              <Input
                type="number"
                min="0"
                step="0.01"
                value={priceInput}
                onChange={(e) => setPriceInput(e.target.value)}
              />
            </Field>
            <div className="flex items-baseline justify-between text-sm">
              <span className="text-muted-foreground">New line total</span>
              <span className="font-semibold tabular-nums">
                {formatINR(
                  Number.isFinite(
                    toTwoPlaces(qtyInput) * toTwoPlaces(priceInput),
                  )
                    ? toTwoPlaces(qtyInput) * toTwoPlaces(priceInput)
                    : null,
                  numberFormatStyle,
                )}
              </span>
            </div>
            {latestExecuted && order.orderType !== 'INTERNAL' && (
              <Callout>
                This order&apos;s executed Order Confirmation Sheet quotes the
                current figures. Issue a revised confirmation sheet after
                changing them.
              </Callout>
            )}
          </div>
          <DialogFooter>
            <button
              type="button"
              onClick={() => setPricingLine(null)}
              className={SIGNAL_BTN_GHOST}
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={savingLine}
              onClick={() => void saveLine()}
              className={SIGNAL_BTN_PRIMARY}
            >
              {savingLine ? 'Saving…' : 'Save'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Customer-facing wording override — shows on the order, kickoff, PLM,
          customer portal, challans, and invoices; internal screens (Item
          Master, BOM, Resource Planning) keep the real product name. */}
      <Dialog
        open={editingLine !== null}
        onOpenChange={(open) => !open && setEditingLine(null)}
      >
        <DialogContent className={SIGNAL_DIALOG}>
          <DialogHeader>
            <DialogTitle className={SIGNAL_DIALOG_TITLE}>
              Customer-facing wording
            </DialogTitle>
            <DialogDescription>
              Shown to the customer on this order, its documents, and the order
              portal. Internal screens keep the real product name
              {editingLine ? ` (${editingLine.internalProductName})` : ''}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Field
              label="Customer-facing product name"
              hint="Leave blank to use the internal product name."
            >
              <Input
                value={cfName}
                onChange={(e) => setCfName(e.target.value)}
                placeholder={editingLine?.internalProductName ?? ''}
                maxLength={300}
              />
            </Field>
            <Field label="Customer-facing description">
              <Textarea
                value={cfDescription}
                onChange={(e) => setCfDescription(e.target.value)}
                rows={3}
                maxLength={2000}
              />
            </Field>
          </div>
          <DialogFooter>
            <button
              type="button"
              onClick={() => setEditingLine(null)}
              className={SIGNAL_BTN_GHOST}
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={savingCf}
              onClick={() => void saveCustomerFacing()}
              className={SIGNAL_BTN_PRIMARY}
            >
              {savingCf ? 'Saving…' : 'Save'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SignalPage>
  );
}
