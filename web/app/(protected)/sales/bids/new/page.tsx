'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { apiFetch, ApiError } from '../../../../lib/api';
import {
  Bid,
  Opportunity,
  PaginatedResult,
  Product,
} from '../../../../lib/types';
import { formatINR } from '../../../../lib/sales';
import { todayDateStr } from '../../../../lib/date';
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
  lineDiscountPercent: string;
}

/** Client-side preview of bid totals. Always re-validated server-side on submit. */
function computeTotals(
  lines: LineDraft[],
  products: Product[],
  discountPercent: number,
) {
  const priceById = new Map(products.map((p) => [p.id, Number(p.unitPrice)]));
  let subtotal = 0;
  for (const l of lines) {
    const price = priceById.get(l.productId);
    if (price === undefined || !l.quantity) continue;
    const qty = Number(l.quantity);
    const lineDisc = l.lineDiscountPercent ? Number(l.lineDiscountPercent) : 0;
    const gross = price * qty;
    subtotal += gross * (1 - lineDisc / 100);
  }
  const discountAmount = subtotal * (discountPercent / 100);
  const taxable = subtotal - discountAmount;
  return { subtotal, discountAmount, taxable };
}

export default function NewBidPage() {
  const router = useRouter();
  const confirm = useConfirm();
  const params = useSearchParams();
  const presetOpportunityId = params.get('opportunityId') ?? '';

  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);

  const [opportunityId, setOpportunityId] = useState(presetOpportunityId);
  const [validUntil, setValidUntil] = useState('');
  const [tenderReferenceNumber, setTenderReferenceNumber] = useState('');
  const [technicalSpecification, setTechnicalSpecification] = useState('');
  const [attachmentName, setAttachmentName] = useState('');
  const [attachmentUrl, setAttachmentUrl] = useState('');
  const [discountPercent, setDiscountPercent] = useState('0');
  const [lines, setLines] = useState<LineDraft[]>([
    { productId: '', quantity: '', lineDiscountPercent: '' },
  ]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    Promise.all([
      apiFetch<PaginatedResult<Opportunity>>('/opportunities?page=1&limit=100'),
      apiFetch<PaginatedResult<Product>>('/products?page=1&limit=100'),
    ])
      .then(([oppRes, prodRes]) => {
        setOpportunities(oppRes.items);
        setProducts(prodRes.items.filter((p) => p.isActive));
      })
      .finally(() => setLoading(false));
  }, []);

  const selectedOpp = opportunities.find((o) => o.id === opportunityId);
  const customerId = selectedOpp?.customerId ?? null;

  const discountNum = Number(discountPercent) || 0;
  const totals = useMemo(
    () => computeTotals(lines, products, discountNum),
    [lines, products, discountNum],
  );
  const needsApproval = discountNum > 10;

  function updateLine(i: number, patch: Partial<LineDraft>) {
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!opportunityId) {
      setError('Select an opportunity');
      return;
    }
    if (!customerId) {
      setError(
        'The selected opportunity has no linked customer — link one before bidding',
      );
      return;
    }
    if (!validUntil) {
      setError('Valid-until date is required');
      return;
    }
    const validLines = lines.filter((l) => l.productId && Number(l.quantity) > 0);
    if (validLines.length === 0) {
      setError('Add at least one line item with a product and quantity');
      return;
    }

    const ok = await confirm({
      title: 'Create this bid?',
      description: 'A draft bid will be created for the selected opportunity.',
      confirmLabel: 'Create',
    });
    if (!ok) return;

    setSubmitting(true);
    try {
      const attachments =
        attachmentName || attachmentUrl
          ? [{ filename: attachmentName || undefined, url: attachmentUrl || undefined }]
          : undefined;
      const bid = await apiFetch<Bid>('/bids', {
        method: 'POST',
        body: JSON.stringify({
          opportunityId,
          customerId,
          validUntil,
          tenderReferenceNumber: tenderReferenceNumber || undefined,
          technicalSpecification: technicalSpecification || undefined,
          attachments,
          discountPercent: discountNum,
          lineItems: validLines.map((l) => ({
            productId: l.productId,
            quantity: Number(l.quantity),
            lineDiscountPercent: l.lineDiscountPercent
              ? Number(l.lineDiscountPercent)
              : undefined,
          })),
        }),
      });
      router.push(`/sales/bids/${bid.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create bid');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <p>Loading…</p>;

  return (
    <div>
      <h1>New Bid</h1>
      <form onSubmit={handleSubmit} style={{ maxWidth: 720 }}>
        <div style={{ marginBottom: 12 }}>
          <label style={{ display: 'block', marginBottom: 4 }}>Opportunity</label>
          <select
            value={opportunityId}
            onChange={(e) => setOpportunityId(e.target.value)}
            required
            style={fieldStyle}
          >
            <option value="">Select an opportunity…</option>
            {opportunities.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
          {selectedOpp && !customerId && (
            <p style={{ color: 'crimson', fontSize: 13 }}>
              This opportunity has no linked customer.
            </p>
          )}
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={{ display: 'block', marginBottom: 4 }}>Valid until</label>
          <input
            type="date"
            value={validUntil}
            // Forward-looking: a bid's validity can't expire in the past.
            min={todayDateStr()}
            onChange={(e) => setValidUntil(e.target.value)}
            required
            style={fieldStyle}
          />
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={{ display: 'block', marginBottom: 4 }}>
            Tender reference number (optional)
          </label>
          <input
            value={tenderReferenceNumber}
            onChange={(e) => setTenderReferenceNumber(e.target.value)}
            style={fieldStyle}
          />
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={{ display: 'block', marginBottom: 4 }}>
            Technical specification
          </label>
          <textarea
            value={technicalSpecification}
            onChange={(e) => setTechnicalSpecification(e.target.value)}
            style={{ ...fieldStyle, minHeight: 80 }}
          />
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={{ display: 'block', marginBottom: 4 }}>
            Reference link (metadata only — no file upload in this phase)
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              placeholder="File name"
              value={attachmentName}
              onChange={(e) => setAttachmentName(e.target.value)}
              style={fieldStyle}
            />
            <input
              placeholder="https://…"
              value={attachmentUrl}
              onChange={(e) => setAttachmentUrl(e.target.value)}
              style={fieldStyle}
            />
          </div>
        </div>

        <h3>Line items</h3>
        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 8 }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid #ccc' }}>
              <th>Product</th>
              <th>Unit price</th>
              <th>Qty</th>
              <th>Line disc %</th>
              <th>Line total</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => {
              const product = products.find((p) => p.id === l.productId);
              const unit = product ? Number(product.unitPrice) : 0;
              const qty = Number(l.quantity) || 0;
              const disc = Number(l.lineDiscountPercent) || 0;
              const lineTotal = unit * qty * (1 - disc / 100);
              return (
                <tr key={i} style={{ borderBottom: '1px solid #eee' }}>
                  <td>
                    <select
                      value={l.productId}
                      onChange={(e) =>
                        updateLine(i, { productId: e.target.value })
                      }
                      style={{ padding: 4, minWidth: 180 }}
                    >
                      <option value="">Select…</option>
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} ({p.sku})
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>{product ? formatINR(product.unitPrice) : '—'}</td>
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
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={l.lineDiscountPercent}
                      onChange={(e) =>
                        updateLine(i, { lineDiscountPercent: e.target.value })
                      }
                      style={{ padding: 4, width: 70 }}
                    />
                  </td>
                  <td>{product && qty ? formatINR(lineTotal) : '—'}</td>
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
              );
            })}
          </tbody>
        </table>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mb-4"
          onClick={() =>
            setLines((ls) => [
              ...ls,
              { productId: '', quantity: '', lineDiscountPercent: '' },
            ])
          }
        >
          + Add line
        </Button>

        <div style={{ marginBottom: 12, maxWidth: 300 }}>
          <label style={{ display: 'block', marginBottom: 4 }}>
            Bid-level discount %
          </label>
          <input
            type="number"
            min={0}
            max={100}
            value={discountPercent}
            onChange={(e) => setDiscountPercent(e.target.value)}
            style={fieldStyle}
          />
        </div>

        {/* Live totals preview (tax computed server-side, shown on detail). */}
        <div
          style={{
            border: '1px solid #ccc',
            borderRadius: 6,
            padding: 12,
            maxWidth: 300,
            marginBottom: 12,
          }}
        >
          <div>Subtotal: {formatINR(totals.subtotal)}</div>
          <div>Discount: −{formatINR(totals.discountAmount)}</div>
          <div style={{ fontWeight: 'bold' }}>
            Taxable: {formatINR(totals.taxable)}
          </div>
          <div style={{ fontSize: 12, color: '#666', marginTop: 4 }}>
            Tax is applied server-side from the active GST config; the final
            total appears on the bid after saving.
          </div>
        </div>

        {needsApproval && (
          <p style={{ color: '#a06000' }}>
            ⚠ This bid&apos;s discount exceeds 10% — it will require manager
            approval before it can be sent.
          </p>
        )}

        {error && <p style={{ color: 'crimson' }}>{error}</p>}

        <div style={{ display: 'flex', gap: 8 }}>
          <Button type="submit" disabled={submitting}>
            {submitting ? 'Creating…' : 'Create Bid (Draft)'}
          </Button>
          <Button type="button" variant="outline" onClick={() => router.back()}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}
