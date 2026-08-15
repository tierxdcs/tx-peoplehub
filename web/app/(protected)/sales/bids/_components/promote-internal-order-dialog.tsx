'use client';

import { useEffect, useMemo, useState } from 'react';
import { apiFetch, ApiError } from '../../../../lib/api';
import { Bid, Order, PaginatedResult } from '../../../../lib/types';
import { Button } from '../../../../components/ui/button';
import { Badge } from '../../../../components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../../components/ui/dialog';

/** One reconciled bid line the promoter can include/exclude and re-quantify. */
interface ReconLine {
  productId: string;
  productName: string;
  bidQuantity: string;
  include: boolean;
  quantity: string;
}

export function PromoteInternalOrderDialog({
  bid,
  open,
  onOpenChange,
  onPromoted,
}: {
  bid: Bid;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPromoted: (orderId: string) => void;
}) {
  const [internalOrders, setInternalOrders] = useState<Order[]>([]);
  const [selectedOrderId, setSelectedOrderId] = useState('');
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [lines, setLines] = useState<ReconLine[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [loadingOrder, setLoadingOrder] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Real, priced bid products (ad-hoc lines are resolved before this point).
  const bidProducts = useMemo(
    () =>
      (bid.lineItems ?? []).filter(
        (li): li is typeof li & { productId: string } => !!li.productId,
      ),
    [bid.lineItems],
  );
  const bidProductIds = useMemo(
    () => new Set(bidProducts.map((li) => li.productId)),
    [bidProducts],
  );

  // Load promotable internal orders when the dialog opens.
  useEffect(() => {
    if (!open) return;
    setLoadingList(true);
    setError(null);
    apiFetch<PaginatedResult<Order>>('/orders?orderType=INTERNAL&page=1&limit=100')
      .then((res) => setInternalOrders(res.items))
      .catch(() => setError('Failed to load internal orders'))
      .finally(() => setLoadingList(false));
  }, [open]);

  // Reset everything when closed.
  useEffect(() => {
    if (open) return;
    setSelectedOrderId('');
    setSelectedOrder(null);
    setLines([]);
    setError(null);
  }, [open]);

  // When an order is picked, fetch its detail (with per-line PLM flags) and
  // seed the reconciliation rows from the bid's line items.
  useEffect(() => {
    if (!selectedOrderId) {
      setSelectedOrder(null);
      setLines([]);
      return;
    }
    setLoadingOrder(true);
    setError(null);
    apiFetch<Order>(`/orders/${selectedOrderId}`)
      .then((order) => {
        setSelectedOrder(order);
        setLines(
          bidProducts.map((li) => ({
            productId: li.productId,
            productName: li.productName,
            bidQuantity: li.quantity,
            include: true,
            quantity: li.quantity,
          })),
        );
      })
      .catch(() => setError('Failed to load the selected internal order'))
      .finally(() => setLoadingOrder(false));
  }, [selectedOrderId, bidProducts]);

  const orderProductIds = useMemo(
    () => new Set((selectedOrder?.lineItems ?? []).map((li) => li.productId)),
    [selectedOrder],
  );

  // Internal-order lines whose product is NOT in the bid: they can't be priced,
  // so they aren't part of the confirmed set. Lines with design work are kept
  // (carried forward at ₹0); the rest are dropped on promotion.
  const internalOnly = useMemo(
    () =>
      (selectedOrder?.lineItems ?? []).filter(
        (li) => !bidProductIds.has(li.productId),
      ),
    [selectedOrder, bidProductIds],
  );

  function updateLine(productId: string, patch: Partial<ReconLine>) {
    setLines((ls) =>
      ls.map((l) => (l.productId === productId ? { ...l, ...patch } : l)),
    );
  }

  async function submit() {
    setError(null);
    const confirmed = lines.filter((l) => l.include);
    if (confirmed.length === 0) {
      setError('Include at least one line item from the bid');
      return;
    }
    if (confirmed.some((l) => !(Number(l.quantity) > 0))) {
      setError('Every included line needs a quantity greater than zero');
      return;
    }
    setSubmitting(true);
    try {
      const order = await apiFetch<Order>(
        `/bids/${bid.id}/promote-internal-order`,
        {
          method: 'POST',
          body: JSON.stringify({
            orderId: selectedOrderId,
            lineItems: confirmed.map((l) => ({
              productId: l.productId,
              quantity: Number(l.quantity),
            })),
          }),
        },
      );
      onPromoted(order.id);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Failed to promote internal order',
      );
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Promote an internal order</DialogTitle>
          <DialogDescription>
            Attach this won bid to an existing internal order instead of
            creating a new one — its kickoff, PLM, and Kanban history carry
            forward. Line items are reconciled against the bid.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium">
              Internal order
            </label>
            <select
              value={selectedOrderId}
              onChange={(e) => setSelectedOrderId(e.target.value)}
              disabled={loadingList}
              className="w-full rounded-md border bg-background p-2 text-sm"
            >
              <option value="">
                {loadingList ? 'Loading…' : 'Select an internal order…'}
              </option>
              {internalOrders.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.orderNumber}
                  {o.customerName ? ` · ${o.customerName}` : ''}
                </option>
              ))}
            </select>
            {!loadingList && internalOrders.length === 0 && (
              <p className="mt-1 text-xs text-muted-foreground">
                No internal orders available to promote.
              </p>
            )}
          </div>

          {loadingOrder && (
            <p className="text-sm text-muted-foreground">Loading order…</p>
          )}

          {selectedOrder && !loadingOrder && (
            <>
              <div>
                <h4 className="mb-1 text-sm font-semibold">
                  Bid line items (the won deal)
                </h4>
                <p className="mb-2 text-xs text-muted-foreground">
                  Included lines become the customer order, priced from the bid.
                  &quot;Matched&quot; lines already exist on the internal order
                  and are updated in place, preserving any design work.
                </p>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="py-1">Include</th>
                      <th>Product</th>
                      <th>Qty</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l) => {
                      const matched = orderProductIds.has(l.productId);
                      return (
                        <tr key={l.productId} className="border-b">
                          <td className="py-1">
                            <input
                              type="checkbox"
                              checked={l.include}
                              onChange={(e) =>
                                updateLine(l.productId, {
                                  include: e.target.checked,
                                })
                              }
                            />
                          </td>
                          <td>{l.productName}</td>
                          <td>
                            <input
                              type="number"
                              min={0}
                              value={l.quantity}
                              disabled={!l.include}
                              onChange={(e) =>
                                updateLine(l.productId, {
                                  quantity: e.target.value,
                                })
                              }
                              className="w-20 rounded border p-1"
                            />
                            {l.quantity !== l.bidQuantity && (
                              <span className="ml-1 text-xs text-muted-foreground">
                                (bid: {l.bidQuantity})
                              </span>
                            )}
                          </td>
                          <td>
                            {matched ? (
                              <Badge variant="info">Matched</Badge>
                            ) : (
                              <Badge variant="secondary">New</Badge>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {internalOnly.length > 0 && (
                <div>
                  <h4 className="mb-1 text-sm font-semibold">
                    Internal-only lines (not on the bid)
                  </h4>
                  <ul className="space-y-1 text-sm">
                    {internalOnly.map((li) => (
                      <li
                        key={li.id}
                        className="flex items-center justify-between border-b py-1"
                      >
                        <span>
                          {li.productName}{' '}
                          <span className="text-xs text-muted-foreground">
                            × {li.quantity}
                          </span>
                        </span>
                        {li.hasPlmTracker ? (
                          <Badge variant="warning">Kept — design work</Badge>
                        ) : (
                          <Badge variant="muted">Will be dropped</Badge>
                        )}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-1 text-xs text-muted-foreground">
                    These products aren&apos;t on the bid, so they can&apos;t be
                    priced. Lines with in-progress design work are kept (at ₹0);
                    the rest are removed when the order is promoted.
                  </p>
                </div>
              )}
            </>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={submitting || !selectedOrder || loadingOrder}
          >
            {submitting ? 'Promoting…' : 'Promote to Customer Order'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
