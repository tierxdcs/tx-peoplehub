'use client';

import { useEffect, useState } from 'react';
import { apiFetch, ApiError } from '../../../lib/api';
import { Bid, Order, PaginatedResult, Product } from '../../../lib/types';
import { Button } from '../../../components/ui/button';
import { Select } from '../../../components/ui/select';
import { useToast } from '../../../components/ui/toaster';
import { ProductForm } from './product-form';

/**
 * "Commit formally" step: resolve every ad-hoc bid line to a real Product
 * before the bid can convert to an order. Shown on the bid detail page while
 * the bid is not yet converted and at least one line is still ad-hoc.
 *
 * Each unresolved line can be resolved two ways:
 *  - Pick an existing product (available to any converter) — one PATCH resolve.
 *  - Create Product Now (Manager/SuperAdmin only) — opens the standard product
 *    form pre-filled from the ad-hoc name/description; on save the new product
 *    is fed straight into a PATCH resolve. Two calls keep product creation
 *    byte-identical to the normal catalog flow.
 */
export function AdHocResolutionCard({
  bid,
  order,
  canCreateProduct,
  onResolved,
}: {
  bid?: Bid;
  order?: Order;
  canCreateProduct: boolean;
  onResolved: () => void | Promise<void>;
}) {
  const toast = useToast();
  const [products, setProducts] = useState<Product[]>([]);
  // Per-line: which existing product is selected in the picker.
  const [picked, setPicked] = useState<Record<string, string>>({});
  // Per-line: whether a resolve request is in flight (disables both buttons).
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  // Line id whose "Create Product Now" dialog is currently open, if any.
  const [creatingFor, setCreatingFor] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<PaginatedResult<Product>>('/products?page=1&limit=100')
      .then((res) => setProducts(res.items.filter((p) => p.isActive)))
      .catch(() => setProducts([]));
  }, []);

  const record = bid ?? order;
  if (!record) return null;
  const adHocLines = (record.lineItems ?? []).filter((li) => li.isAdHoc);
  if (adHocLines.length === 0) return null;

  async function resolve(lineItemId: string, productId: string) {
    if (!productId) {
      toast.error('Pick a product to resolve this line to');
      return;
    }
    setBusy((b) => ({ ...b, [lineItemId]: true }));
    try {
      const endpoint = bid
        ? `/bids/${bid.id}/line-items/${lineItemId}/resolve`
        : `/orders/${order!.id}/line-items/${lineItemId}/resolve`;
      await apiFetch(endpoint, {
        method: 'PATCH',
        body: JSON.stringify({ productId }),
      });
      await onResolved();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : 'Failed to resolve line item',
      );
    } finally {
      setBusy((b) => ({ ...b, [lineItemId]: false }));
    }
  }

  const creatingLine =
    creatingFor != null
      ? adHocLines.find((li) => li.id === creatingFor)
      : undefined;

  return (
    <div className="mb-4 rounded-md border border-warning/40 bg-warning/10 p-4">
      <p className="mb-1 text-sm font-semibold text-warning-foreground">
        {adHocLines.length} line item{adHocLines.length === 1 ? '' : 's'}{' '}
        awaiting product setup
      </p>
      <p className="mb-3 text-xs text-muted-foreground">
        Each ad-hoc line must be resolved to a real product before this{' '}
        {bid ? 'bid can be converted' : 'internal order can be promoted'} to a
        customer order. Existing Kickoff and PLM history stays attached.
      </p>

      <div className="space-y-3">
        {adHocLines.map((li) => (
          <div
            key={li.id}
            className="flex flex-wrap items-start gap-2 rounded-md border bg-background p-3"
          >
            <div className="min-w-[180px] flex-1">
              <div className="text-sm font-medium">{li.productName}</div>
              {li.adHocDescription && (
                <div className="text-xs text-muted-foreground">
                  {li.adHocDescription}
                </div>
              )}
            </div>
            <Select
              aria-label={`Resolve "${li.productName}" to product`}
              className="w-full sm:w-64"
              value={picked[li.id] ?? ''}
              disabled={busy[li.id]}
              onChange={(e) =>
                setPicked((p) => ({ ...p, [li.id]: e.target.value }))
              }
            >
              <option value="">Pick an existing product…</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.sku})
                </option>
              ))}
            </Select>
            <Button
              size="sm"
              disabled={busy[li.id] || !picked[li.id]}
              onClick={() => resolve(li.id, picked[li.id] ?? '')}
            >
              {busy[li.id] ? '…' : 'Resolve'}
            </Button>
            {canCreateProduct && (
              <Button
                size="sm"
                variant="outline"
                disabled={busy[li.id]}
                onClick={() => setCreatingFor(li.id)}
              >
                Create Product Now
              </Button>
            )}
          </div>
        ))}
      </div>

      {creatingLine && (
        <ProductForm
          product={null}
          initialName={
            creatingLine.adHocProductName ?? creatingLine.productName
          }
          initialDescription={creatingLine.adHocDescription ?? undefined}
          onClose={() => setCreatingFor(null)}
          onSaved={async (product) => {
            const lineId = creatingLine.id;
            setCreatingFor(null);
            await resolve(lineId, product.id);
          }}
        />
      )}
    </div>
  );
}
