'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, ApiError } from '../../../../lib/api';
import { Customer, Order, PaginatedResult, Product } from '../../../../lib/types';
import { useBusinessUnitOptions } from '../../../../lib/business-units';
import { useCanManageInternalOrders } from '../../../../lib/use-can-manage-internal-orders';
import { PageContainer } from '../../../../components/ui/page-container';
import { PageHeader } from '../../../../components/ui/page-header';
import { Card, CardContent } from '../../../../components/ui/card';
import { Button } from '../../../../components/ui/button';
import { useConfirm } from '../../../../components/ui/confirm';

const fieldStyle: React.CSSProperties = {
  width: '100%',
  padding: 8,
  boxSizing: 'border-box',
};

interface LineDraft {
  productId: string;
  quantity: string;
}

function blankLine(): LineDraft {
  return { productId: '', quantity: '' };
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
      (l) => !!l.productId && Number(l.quantity) > 0,
    );
    if (validLines.length === 0) {
      setError('Add at least one line item with a product and quantity');
      return;
    }
    const productIds = validLines.map((l) => l.productId);
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
            productId: l.productId,
            quantity: Number(l.quantity),
          })),
        }),
      });
      router.push(`/sales/orders/${order.id}`);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Failed to create internal order',
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (gateLoading || loading) {
    return (
      <PageContainer>
        <p className="text-sm text-muted-foreground">Loading…</p>
      </PageContainer>
    );
  }

  if (!canManage) {
    return (
      <PageContainer>
        <PageHeader title="New Internal Order" />
        <p className="text-sm text-destructive">
          Only Sales, R&amp;D, or Project Manager staff may create internal
          orders.
        </p>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <PageHeader
        title="New Internal Order"
        description="A sample or speculative build with no bid, confirmation sheet, or customer commitment. No pricing — line items describe what's being built."
      />

      <Card>
        <CardContent className="p-6">
          <form onSubmit={handleSubmit} style={{ maxWidth: 720 }}>
            <div style={{ marginBottom: 12 }}>
              <label style={{ display: 'block', marginBottom: 4 }}>
                Prospective customer (optional)
              </label>
              <select
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
                style={fieldStyle}
              >
                <option value="">No customer — internal only</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-muted-foreground">
                A non-committal tag (e.g. &quot;sample for X&quot;), not a
                commercial commitment.
              </p>
            </div>

            <div style={{ marginBottom: 12 }}>
              <label style={{ display: 'block', marginBottom: 4 }}>
                Business unit (optional)
              </label>
              <select
                value={businessUnitId}
                onChange={(e) => setBusinessUnitId(e.target.value)}
                style={fieldStyle}
              >
                <option value="">Unassigned</option>
                {businessUnits.map((unit) => (
                  <option key={unit.id} value={unit.id}>
                    {unit.name}
                  </option>
                ))}
              </select>
            </div>

            <h3>Line items</h3>
            <table
              style={{
                width: '100%',
                borderCollapse: 'collapse',
                marginBottom: 8,
              }}
            >
              <thead>
                <tr
                  style={{
                    textAlign: 'left',
                    borderBottom: '1px solid hsl(var(--border))',
                  }}
                >
                  <th>Product</th>
                  <th>Qty</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr
                    key={i}
                    style={{ borderBottom: '1px solid hsl(var(--border))' }}
                  >
                    <td>
                      <select
                        value={l.productId}
                        onChange={(e) =>
                          updateLine(i, { productId: e.target.value })
                        }
                        style={{ padding: 4, minWidth: 220 }}
                      >
                        <option value="">Select…</option>
                        {products.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name} ({p.sku})
                            {p.businessUnitName
                              ? ` · ${p.businessUnitName}`
                              : ''}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        type="number"
                        min={0}
                        value={l.quantity}
                        onChange={(e) =>
                          updateLine(i, { quantity: e.target.value })
                        }
                        style={{ padding: 4, width: 80 }}
                      />
                    </td>
                    <td>
                      {lines.length > 1 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() =>
                            setLines((ls) => ls.filter((_, j) => j !== i))
                          }
                        >
                          ✕
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mb-4"
              onClick={() => setLines((ls) => [...ls, blankLine()])}
            >
              + Add line
            </Button>

            {error && (
              <p className="mb-3 text-sm text-destructive">{error}</p>
            )}

            <div style={{ display: 'flex', gap: 8 }}>
              <Button type="submit" disabled={submitting}>
                {submitting ? 'Creating…' : 'Create Internal Order'}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => router.back()}
              >
                Cancel
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </PageContainer>
  );
}
