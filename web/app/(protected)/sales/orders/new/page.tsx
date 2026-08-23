'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, ApiError } from '../../../../lib/api';
import {
  Customer,
  Order,
  PaginatedResult,
  Product,
} from '../../../../lib/types';
import { useBusinessUnitOptions } from '../../../../lib/business-units';
import { useCanManageInternalOrders } from '../../../../lib/use-can-manage-internal-orders';
import {
  Callout,
  SCard,
  SCardTitle,
  SIGNAL_BTN_GHOST,
  SIGNAL_BTN_PRIMARY,
  SIGNAL_TABLE_HEAD,
  SignalHeader,
  SignalPage,
} from '../../../../components/ui/signal';
import { adHocBundleWarning } from '../../../../lib/ad-hoc-quality';
import { Field } from '../../../../components/ui/field';
import { Input } from '../../../../components/ui/input';
import { Select } from '../../../../components/ui/select';
import { Textarea } from '../../../../components/ui/textarea';
import { useConfirm } from '../../../../components/ui/confirm';
import { cn } from '../../../../lib/utils';
import { Plus, Trash2 } from 'lucide-react';

const FORM_ID = 'new-internal-order-form';

const LINE_GRID =
  'grid grid-cols-[26px_1fr_110px_32px] items-center gap-2.5 px-5';

interface LineDraft {
  productId: string;
  adHoc: boolean;
  adHocProductName: string;
  adHocDescription: string;
  quantity: string;
}

function blankLine(): LineDraft {
  return {
    productId: '',
    adHoc: false,
    adHocProductName: '',
    adHocDescription: '',
    quantity: '',
  };
}

export default function NewInternalOrderPage() {
  const router = useRouter();
  const confirm = useConfirm();
  const { canManage, loading: gateLoading } = useCanManageInternalOrders();
  const { businessUnits } = useBusinessUnitOptions();

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);

  const [customerId, setCustomerId] = useState('');
  const [businessUnitId, setBusinessUnitId] = useState('');
  const [lines, setLines] = useState<LineDraft[]>([blankLine()]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    Promise.all([
      apiFetch<PaginatedResult<Customer>>('/customers?page=1&limit=100'),
      apiFetch<PaginatedResult<Product>>('/products?page=1&limit=100'),
    ])
      .then(([custRes, prodRes]) => {
        setCustomers(custRes.items);
        setProducts(prodRes.items.filter((p) => p.isActive));
      })
      .catch(() => setError('Failed to load customers and products'))
      .finally(() => setLoading(false));
  }, []);

  function updateLine(i: number, patch: Partial<LineDraft>) {
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const validLines = lines.filter(
      (l) =>
        (l.adHoc ? !!l.adHocProductName.trim() : !!l.productId) &&
        Number(l.quantity) > 0,
    );
    if (validLines.length === 0) {
      setError('Add at least one line item with a product and quantity');
      return;
    }
    const productIds = validLines
      .filter((l) => !l.adHoc)
      .map((l) => l.productId);
    if (new Set(productIds).size !== productIds.length) {
      setError('Each product may appear only once');
      return;
    }

    const ok = await confirm({
      title: 'Create this internal order?',
      description:
        'An internal order has no pricing or customer commitment. You can promote it to a real customer order later if a bid is won.',
      confirmLabel: 'Create',
    });
    if (!ok) return;

    setSubmitting(true);
    try {
      const order = await apiFetch<Order>('/orders', {
        method: 'POST',
        body: JSON.stringify({
          customerId: customerId || undefined,
          businessUnitId: businessUnitId || undefined,
          lineItems: validLines.map((l) => ({
            ...(l.adHoc
              ? {
                  adHocProductName: l.adHocProductName.trim(),
                  adHocDescription: l.adHocDescription.trim() || undefined,
                }
              : { productId: l.productId }),
            quantity: Number(l.quantity),
          })),
        }),
      });
      router.push(`/sales/orders/${order.id}`);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Failed to create internal order',
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (gateLoading || loading) {
    return (
      <SignalPage>
        <div className="px-5 py-[18px] lg:px-7">
          <p className="text-sm text-muted-foreground">Loading…</p>
        </div>
      </SignalPage>
    );
  }

  if (!canManage) {
    return (
      <SignalPage>
        <SignalHeader title="New Internal Order" />
        <div className="px-5 py-[18px] lg:px-7">
          <p className="text-sm text-destructive">
            Only Sales, R&amp;D, or Project Manager staff may create internal
            orders.
          </p>
        </div>
      </SignalPage>
    );
  }

  return (
    <SignalPage>
      <SignalHeader
        backHref="/sales/orders"
        backLabel="Orders"
        title="New Internal Order"
        description="A sample or speculative build with no bid, confirmation sheet, or customer commitment. No pricing — line items describe what's being built."
        actions={
          <>
            <button
              type="button"
              onClick={() => router.back()}
              className={SIGNAL_BTN_GHOST}
            >
              Cancel
            </button>
            <button
              type="submit"
              form={FORM_ID}
              disabled={submitting}
              className={SIGNAL_BTN_PRIMARY}
            >
              {submitting ? 'Creating…' : 'Create Internal Order'}
            </button>
          </>
        }
      />

      <form id={FORM_ID} onSubmit={handleSubmit}>
        <div className="space-y-4 px-5 pb-7 pt-[18px] lg:px-7">
          <SCard className="px-5 py-[18px]">
            <SCardTitle
              title="Order Details"
              subtitle="Both fields are optional tags, not commitments"
            />
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <Field
                label="Prospective customer"
                htmlFor="io-customer"
                hint={`A non-committal tag (e.g. "sample for X"), not a commercial commitment.`}
              >
                <Select
                  id="io-customer"
                  value={customerId}
                  onChange={(e) => setCustomerId(e.target.value)}
                >
                  <option value="">No customer — internal only</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Business unit" htmlFor="io-bu">
                <Select
                  id="io-bu"
                  value={businessUnitId}
                  onChange={(e) => setBusinessUnitId(e.target.value)}
                >
                  <option value="">Unassigned</option>
                  {businessUnits.map((unit) => (
                    <option key={unit.id} value={unit.id}>
                      {unit.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          </SCard>

          <SCard className="overflow-hidden">
            <div className="flex flex-wrap items-center gap-2.5 px-5 pb-3.5 pt-[18px]">
              <span className="text-[14px] font-bold">Line Items</span>
              <span className="rounded-full bg-black/10 px-2 py-[3px] text-[10.5px] font-semibold text-black/65 dark:bg-white/[.08] dark:text-white/60">
                {lines.length} {lines.length === 1 ? 'line' : 'lines'}
              </span>
              <span className="ml-auto text-[11.5px] text-black/40 dark:text-white/35">
                No pricing — quantities only
              </span>
            </div>
            <div className={cn(LINE_GRID, SIGNAL_TABLE_HEAD, 'py-[9px]')}>
              <span>#</span>
              <span>
                Product{' '}
                <span className="text-[#D9363E] dark:text-[#FF5257]">*</span>
              </span>
              <span className="text-right">Qty</span>
              <span />
            </div>
            {lines.map((l, i) => (
              <div
                key={i}
                className={cn(
                  i > 0 && 'border-t border-black/[.06] dark:border-white/[.06]',
                )}
              >
                <div className={cn(LINE_GRID, 'pb-3 pt-[11px]')}>
                  <span className="text-[11.5px] font-semibold tabular-nums text-black/40 dark:text-white/35">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <Select
                    aria-label="Product"
                    value={l.adHoc ? '__AD_HOC__' : l.productId}
                    onChange={(e) => {
                      const adHoc = e.target.value === '__AD_HOC__';
                      updateLine(i, {
                        adHoc,
                        productId: adHoc ? '' : e.target.value,
                        adHocProductName: adHoc ? l.adHocProductName : '',
                        adHocDescription: adHoc ? l.adHocDescription : '',
                      });
                    }}
                  >
                    <option value="">Select…</option>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.sku})
                        {p.businessUnitName ? ` · ${p.businessUnitName}` : ''}
                      </option>
                    ))}
                    <option value="__AD_HOC__">
                      ➕ Enter a new product (ad-hoc)…
                    </option>
                  </Select>
                  <Input
                    type="number"
                    min={0}
                    aria-label="Quantity"
                    className="text-right tabular-nums"
                    value={l.quantity}
                    onChange={(e) => updateLine(i, { quantity: e.target.value })}
                  />
                  {lines.length > 1 ? (
                    <button
                      type="button"
                      onClick={() =>
                        setLines((ls) => ls.filter((_, j) => j !== i))
                      }
                      aria-label="Remove line"
                      className="grid size-8 place-items-center justify-self-center rounded-md text-black/35 hover:bg-black/5 hover:text-black/70 dark:text-white/35 dark:hover:bg-white/5 dark:hover:text-white/70"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  ) : (
                    <span />
                  )}
                </div>
                {l.adHoc && (
                  <div className="space-y-2 px-5 pb-3 pl-[56px]">
                    <Input
                      aria-label="Ad-hoc product name"
                      placeholder="Product name"
                      value={l.adHocProductName}
                      onChange={(e) =>
                        updateLine(i, { adHocProductName: e.target.value })
                      }
                      required
                    />
                    <Textarea
                      aria-label="Ad-hoc product description"
                      placeholder="Description (optional)"
                      value={l.adHocDescription}
                      onChange={(e) =>
                        updateLine(i, { adHocDescription: e.target.value })
                      }
                      rows={2}
                    />
                    <p className="text-[11px] text-black/40 dark:text-white/35">
                      Ad-hoc · must be resolved to a real product before this
                      order can be promoted to a customer order.
                    </p>
                    {adHocBundleWarning(l.adHocProductName) && (
                      <Callout className="mt-0">
                        {adHocBundleWarning(l.adHocProductName)}
                      </Callout>
                    )}
                  </div>
                )}
              </div>
            ))}
            <div className="flex flex-wrap items-center gap-2.5 border-t border-black/10 bg-black/[.02] px-5 py-3 dark:border-white/[.08] dark:bg-white/[.02]">
              <button
                type="button"
                onClick={() => setLines((ls) => [...ls, blankLine()])}
                className="inline-flex items-center gap-1 rounded-lg border border-dashed border-black/25 px-3 py-[7px] text-[12px] font-semibold text-black/70 hover:bg-black/[.03] dark:border-white/[.22] dark:text-white/70 dark:hover:bg-white/[.04]"
              >
                <Plus className="size-3.5" /> Add line
              </button>
            </div>
          </SCard>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
      </form>
    </SignalPage>
  );
}
