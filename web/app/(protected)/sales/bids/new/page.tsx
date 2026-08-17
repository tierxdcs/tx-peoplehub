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
import { useNumberFormat } from '../../../../lib/number-format-context';
import { orderProductsForOpportunity } from '../../../../lib/business-unit-rules';
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
  /** Per-line sales margin (markup) %. Internal — never shown to the customer. */
  marginPercent: string;
  /** True when this is an ad-hoc line typed in without a real Product yet. */
  adHoc: boolean;
  adHocProductName: string;
  adHocDescription: string;
  /** Rep-typed unit price for an ad-hoc line (real lines derive it). */
  adHocUnitPrice: string;
}

/** Sentinel <option> value that switches a line into ad-hoc entry mode. */
const AD_HOC_OPTION = '__ad_hoc__';

function blankLine(): LineDraft {
  return {
    productId: '',
    quantity: '',
    lineDiscountPercent: '',
    marginPercent: '',
    adHoc: false,
    adHocProductName: '',
    adHocDescription: '',
    adHocUnitPrice: '',
  };
}

const AMC_YEARS = [
  { yearNumber: 2, label: 'AMC Charges for 2nd Year' },
  { yearNumber: 3, label: 'AMC Charges for 3rd Year' },
  { yearNumber: 4, label: 'AMC Charges for 4th Year' },
  { yearNumber: 5, label: 'AMC Charges for 5th Year' },
] as const;

/** How a year's AMC charge is entered: a direct rupee amount, or a percentage
 *  of the bid's taxable (net-of-discount) value. Either way the bid stores a
 *  flat rupee amount — the percentage is only an input convenience. */
type AmcMode = 'amount' | 'percent';
interface AmcInput {
  mode: AmcMode;
  value: string;
}

/** Resolve a year's typed input into a rupee AMC amount. Percentage mode is
 *  computed against the taxable (post-discount) base. */
function amcAmountFor(input: AmcInput, taxableBase: number): number {
  const v = Number(input.value);
  if (!v || v <= 0 || Number.isNaN(v)) return 0;
  const raw = input.mode === 'percent' ? (taxableBase * v) / 100 : v;
  // Match the server's 2-dp money rounding so the preview and payload agree.
  return Math.round(raw * 100) / 100;
}

/**
 * The quoted (margin-inclusive) unit price for a line: the base price marked
 * up by the per-line margin, then the bid-level margin on top. Mirrors the
 * server's calc so the preview matches what gets saved. Rounded to money
 * precision so unit × qty reconciles.
 */
function effectiveUnitPrice(
  base: number,
  lineMarginPercent: number,
  bidMarginPercent: number,
) {
  const marked =
    base * (1 + lineMarginPercent / 100) * (1 + bidMarginPercent / 100);
  return Math.round(marked * 100) / 100;
}

/** Client-side preview of bid totals. Always re-validated server-side on submit. */
function computeTotals(
  lines: LineDraft[],
  products: Product[],
  discountPercent: number,
  bidMarginPercent: number,
) {
  const priceById = new Map(products.map((p) => [p.id, Number(p.unitPrice)]));
  let subtotal = 0;
  for (const l of lines) {
    const price = l.adHoc
      ? Number(l.adHocUnitPrice)
      : priceById.get(l.productId);
    if (price === undefined || Number.isNaN(price) || !l.quantity) continue;
    const qty = Number(l.quantity);
    const lineDisc = l.lineDiscountPercent ? Number(l.lineDiscountPercent) : 0;
    const lineMargin = l.marginPercent ? Number(l.marginPercent) : 0;
    const unit = effectiveUnitPrice(price, lineMargin, bidMarginPercent);
    const gross = unit * qty;
    subtotal += gross * (1 - lineDisc / 100);
  }
  const discountAmount = subtotal * (discountPercent / 100);
  const taxable = subtotal - discountAmount;
  return { subtotal, discountAmount, taxable };
}

export default function NewBidPage() {
  const router = useRouter();
  const confirm = useConfirm();
  const { style: numberFormatStyle } = useNumberFormat();
  const params = useSearchParams();
  const presetOpportunityId = params.get('opportunityId') ?? '';

  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);

  const [opportunityId, setOpportunityId] = useState(presetOpportunityId);
  const [validUntil, setValidUntil] = useState('');
  const [tenderReferenceNumber, setTenderReferenceNumber] = useState('');
  const [quotationSubject, setQuotationSubject] = useState('');
  const [technicalSpecification, setTechnicalSpecification] = useState('');
  const [attachmentName, setAttachmentName] = useState('');
  const [attachmentUrl, setAttachmentUrl] = useState('');
  const [discountPercent, setDiscountPercent] = useState('0');
  const [marginPercent, setMarginPercent] = useState('0');
  const [amcInputs, setAmcInputs] = useState<Record<number, AmcInput>>({
    2: { mode: 'amount', value: '' },
    3: { mode: 'amount', value: '' },
    4: { mode: 'amount', value: '' },
    5: { mode: 'amount', value: '' },
  });
  const [lines, setLines] = useState<LineDraft[]>([blankLine()]);
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
  const marginNum = Number(marginPercent) || 0;
  const totals = useMemo(
    () => computeTotals(lines, products, discountNum, marginNum),
    [lines, products, discountNum, marginNum],
  );
  const needsApproval = discountNum > 10;
  // Resolve each year to a rupee amount (percentage years use the taxable base),
  // keyed by year so the UI can show a live per-row preview too.
  const amcResolved = useMemo(() => {
    const out: Record<number, number> = {};
    for (const { yearNumber } of AMC_YEARS) {
      out[yearNumber] = amcAmountFor(amcInputs[yearNumber], totals.taxable);
    }
    return out;
  }, [amcInputs, totals.taxable]);
  const amcTotal = AMC_YEARS.reduce(
    (sum, { yearNumber }) => sum + amcResolved[yearNumber],
    0,
  );

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
    const validLines = lines.filter(
      (l) =>
        Number(l.quantity) > 0 &&
        (l.adHoc ? !!l.adHocProductName.trim() : !!l.productId),
    );
    if (validLines.length === 0) {
      setError('Add at least one line item with a product and quantity');
      return;
    }
    // Ad-hoc lines have no Product to snapshot a price from — require one.
    const adHocMissingPrice = validLines.some(
      (l) => l.adHoc && (l.adHocUnitPrice === '' || Number(l.adHocUnitPrice) < 0),
    );
    if (adHocMissingPrice) {
      setError('Enter a unit price for each new (ad-hoc) product line');
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
          ? [
              {
                filename: attachmentName || undefined,
                url: attachmentUrl || undefined,
              },
            ]
          : undefined;
      const bid = await apiFetch<Bid>('/bids', {
        method: 'POST',
        body: JSON.stringify({
          opportunityId,
          customerId,
          validUntil,
          tenderReferenceNumber: tenderReferenceNumber || undefined,
          quotationSubject: quotationSubject || undefined,
          technicalSpecification: technicalSpecification || undefined,
          attachments,
          discountPercent: discountNum,
          marginPercent: marginNum,
          amcCharges: AMC_YEARS.map(({ yearNumber }) => ({
            yearNumber,
            amount: amcResolved[yearNumber],
          })).filter((charge) => charge.amount > 0),
          lineItems: validLines.map((l) => ({
            ...(l.adHoc
              ? {
                  adHocProductName: l.adHocProductName.trim(),
                  adHocDescription: l.adHocDescription.trim() || undefined,
                  unitPrice: Number(l.adHocUnitPrice),
                }
              : { productId: l.productId }),
            quantity: Number(l.quantity),
            lineDiscountPercent: l.lineDiscountPercent
              ? Number(l.lineDiscountPercent)
              : undefined,
            marginPercent: l.marginPercent
              ? Number(l.marginPercent)
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
          <label style={{ display: 'block', marginBottom: 4 }}>
            Opportunity
          </label>
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
            <p className="text-sm text-destructive">
              This opportunity has no linked customer.
            </p>
          )}
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={{ display: 'block', marginBottom: 4 }}>
            Valid until
          </label>
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
            Quotation subject (optional)
          </label>
          <input
            value={quotationSubject}
            onChange={(e) => setQuotationSubject(e.target.value)}
            placeholder="e.g. Submission of quotation for supply of 24U & 42U 800x800 racks, along with MDU"
            style={fieldStyle}
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Used in both the Subject line and the opening paragraph of the
            proposal.
          </p>
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
          <p className="mt-1 text-xs text-muted-foreground">
            Internal notes only — not printed on the proposal (the per-line
            product description carries the technical detail).
          </p>
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
        <table
          style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 8 }}
        >
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid hsl(var(--border))' }}>
              <th>Product</th>
              <th>Unit price</th>
              <th>Qty</th>
              <th>Margin %</th>
              <th>Line disc %</th>
              <th>Line total</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => {
              const product = products.find((p) => p.id === l.productId);
              const unit = l.adHoc
                ? Number(l.adHocUnitPrice) || 0
                : product
                  ? Number(product.unitPrice)
                  : 0;
              const qty = Number(l.quantity) || 0;
              const disc = Number(l.lineDiscountPercent) || 0;
              const lineMargin = Number(l.marginPercent) || 0;
              const quotedUnit = effectiveUnitPrice(unit, lineMargin, marginNum);
              const lineTotal = quotedUnit * qty * (1 - disc / 100);
              const hasValue = l.adHoc ? l.adHocUnitPrice !== '' : !!product;
              return (
                <tr key={i} style={{ borderBottom: '1px solid hsl(var(--border))' }}>
                  <td>
                    <select
                      value={l.adHoc ? AD_HOC_OPTION : l.productId}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v === AD_HOC_OPTION) {
                          updateLine(i, { adHoc: true, productId: '' });
                        } else {
                          updateLine(i, {
                            adHoc: false,
                            productId: v,
                            adHocProductName: '',
                            adHocDescription: '',
                            adHocUnitPrice: '',
                          });
                        }
                      }}
                      style={{ padding: 4, minWidth: 180 }}
                    >
                      <option value="">Select…</option>
                      <option value={AD_HOC_OPTION}>
                        ➕ Enter a new product (ad-hoc)…
                      </option>
                      {orderProductsForOpportunity(
                        products,
                        selectedOpp?.businessUnitId,
                      ).map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name} ({p.sku})
                            {p.businessUnitName
                              ? ` · ${p.businessUnitName}`
                              : ''}
                          </option>
                        ))}
                    </select>
                    {l.adHoc && (
                      <div style={{ marginTop: 6, display: 'grid', gap: 4 }}>
                        <input
                          placeholder="New product name"
                          value={l.adHocProductName}
                          onChange={(e) =>
                            updateLine(i, { adHocProductName: e.target.value })
                          }
                          style={{ padding: 4, minWidth: 180 }}
                        />
                        <input
                          placeholder="Description (optional)"
                          value={l.adHocDescription}
                          onChange={(e) =>
                            updateLine(i, { adHocDescription: e.target.value })
                          }
                          style={{ padding: 4, minWidth: 180 }}
                        />
                        <span className="text-xs text-warning">
                          Needs product setup before order conversion.
                        </span>
                      </div>
                    )}
                  </td>
                  <td>
                    {l.adHoc ? (
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        placeholder="0.00"
                        value={l.adHocUnitPrice}
                        onChange={(e) =>
                          updateLine(i, { adHocUnitPrice: e.target.value })
                        }
                        style={{ padding: 4, width: 100 }}
                      />
                    ) : product ? (
                      formatINR(product.unitPrice, numberFormatStyle)
                    ) : (
                      '—'
                    )}
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
                    <input
                      type="number"
                      min={0}
                      max={500}
                      step="0.01"
                      value={l.marginPercent}
                      onChange={(e) =>
                        updateLine(i, { marginPercent: e.target.value })
                      }
                      placeholder="0"
                      title="Sales margin (markup) % — internal, not shown to the customer"
                      style={{ padding: 4, width: 70 }}
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
                  <td>
                    {hasValue && qty
                      ? formatINR(lineTotal, numberFormatStyle)
                      : '—'}
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
              );
            })}
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

        <div style={{ marginBottom: 12, maxWidth: 300 }}>
          <label style={{ display: 'block', marginBottom: 4 }}>
            Bid-level margin %
          </label>
          <input
            type="number"
            min={0}
            max={500}
            step="0.01"
            value={marginPercent}
            onChange={(e) => setMarginPercent(e.target.value)}
            style={fieldStyle}
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Your markup on top of each line’s margin. Internal only — it’s built
            into the quoted prices and never shown on the proposal.
          </p>
        </div>

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

        <section className="mb-4 max-w-md rounded-md border p-4">
          <h3 className="mb-1 text-base font-semibold">AMC Charges</h3>
          <p className="mb-3 text-xs text-muted-foreground">
            Enter each year as a direct amount, or switch to % to charge a
            percentage of the taxable value ({formatINR(totals.taxable, numberFormatStyle)}).
          </p>
          <div className="space-y-3">
            {AMC_YEARS.map(({ yearNumber, label }) => {
              const input = amcInputs[yearNumber];
              const isPercent = input.mode === 'percent';
              return (
                <div
                  key={yearNumber}
                  className="grid gap-1 text-sm sm:grid-cols-[1fr_110px_170px] sm:items-center"
                >
                  <span>{label}</span>
                  <select
                    value={input.mode}
                    onChange={(event) =>
                      setAmcInputs((current) => ({
                        ...current,
                        [yearNumber]: {
                          ...current[yearNumber],
                          mode: event.target.value as AmcMode,
                        },
                      }))
                    }
                    aria-label={`${label} — entry mode`}
                    style={{ padding: 4 }}
                  >
                    <option value="amount">Amount (₹)</option>
                    <option value="percent">Percent (%)</option>
                  </select>
                  <div>
                    <input
                      type="number"
                      min={0}
                      max={isPercent ? 100 : undefined}
                      step="0.01"
                      inputMode="decimal"
                      value={input.value}
                      onChange={(event) =>
                        setAmcInputs((current) => ({
                          ...current,
                          [yearNumber]: {
                            ...current[yearNumber],
                            value: event.target.value,
                          },
                        }))
                      }
                      placeholder={isPercent ? '0' : '0.00'}
                      aria-label={`${label} — ${isPercent ? 'percent' : 'amount'}`}
                      style={fieldStyle}
                    />
                    {isPercent && amcResolved[yearNumber] > 0 && (
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        = {formatINR(amcResolved[yearNumber], numberFormatStyle)}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-3 flex justify-between border-t pt-3 font-semibold">
            <span>AMC Total</span>
            <span>{formatINR(amcTotal, numberFormatStyle)}</span>
          </div>
        </section>

        {/* Live totals preview (tax computed server-side, shown on detail). */}
        <div
          style={{
            border: '1px solid hsl(var(--border))',
            borderRadius: 6,
            padding: 12,
            maxWidth: 300,
            marginBottom: 12,
          }}
        >
          <div>
            Subtotal: {formatINR(totals.subtotal, numberFormatStyle)}
          </div>
          <div>
            Discount: −{formatINR(totals.discountAmount, numberFormatStyle)}
          </div>
          <div style={{ fontWeight: 'bold' }}>
            Taxable: {formatINR(totals.taxable, numberFormatStyle)}
          </div>
          <div>
            AMC Total (untaxed): {formatINR(amcTotal, numberFormatStyle)}
          </div>
          <div className="mt-1 flex justify-between border-t pt-1 font-bold">
            <span>Grand Total before GST</span>
            <span>
              {formatINR(totals.taxable + amcTotal, numberFormatStyle)}
            </span>
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            Tax is applied server-side from the active GST config; the final
            total appears on the bid after saving.
          </div>
        </div>

        {needsApproval && (
          <p className="text-warning">
            ⚠ This bid&apos;s discount exceeds 10% — it will require manager
            approval before it can be sent.
          </p>
        )}

        {error && <p className="text-destructive">{error}</p>}

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
