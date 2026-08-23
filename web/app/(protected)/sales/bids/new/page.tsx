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
import { adHocBundleWarning } from '../../../../lib/ad-hoc-quality';
import { useNumberFormat } from '../../../../lib/number-format-context';
import { orderProductsForOpportunity } from '../../../../lib/business-unit-rules';
import { todayDateStr } from '../../../../lib/date';
import { Button } from '../../../../components/ui/button';
import { Input } from '../../../../components/ui/input';
import { Select } from '../../../../components/ui/select';
import { Field } from '../../../../components/ui/field';
import { Textarea } from '../../../../components/ui/textarea';
import { useConfirm } from '../../../../components/ui/confirm';
import {
  Callout,
  SCard,
  SCardTitle,
  SIGNAL_BTN_GHOST,
  SIGNAL_BTN_PRIMARY,
  SIGNAL_TABLE_HEAD,
  SignalChip,
  SignalHeader,
  SignalPage,
  SummaryRow,
} from '../../../../components/ui/signal';
import { cn } from '../../../../lib/utils';

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

/** Shared column template so the line-items header and body rows align. */
const LINE_GRID =
  'grid grid-cols-[26px_minmax(210px,1.6fr)_120px_84px_84px_84px_110px_36px] items-center gap-2.5 px-5';

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

  if (loading)
    return (
      <SignalPage>
        <SignalHeader
          backHref="/sales/bids"
          backLabel="Bids"
          title="New Bid"
          chip={<SignalChip>Draft</SignalChip>}
        />
        <div className="px-5 py-[18px] lg:px-7">
          <p>Loading…</p>
        </div>
      </SignalPage>
    );

  return (
    <SignalPage>
      <SignalHeader
        backHref="/sales/bids"
        backLabel="Bids"
        title="New Bid"
        chip={<SignalChip>Draft</SignalChip>}
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
              form="new-bid-form"
              disabled={submitting}
              className={SIGNAL_BTN_PRIMARY}
            >
              {submitting ? 'Creating…' : 'Create Bid (Draft)'}
            </button>
          </>
        }
      />

      <form
        id="new-bid-form"
        onSubmit={handleSubmit}
        className="grid items-start gap-4 px-5 pb-7 pt-[18px] lg:px-7 xl:grid-cols-[1fr_316px]"
      >
        {/* ── Left column ─────────────────────────────────────────── */}
        <div className="flex min-w-0 flex-col gap-3.5">
          {/* Bid details */}
          <SCard className="px-5 py-[18px]">
            <SCardTitle title="Bid Details" />
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <Field
                label="Opportunity"
                htmlFor="opportunity"
                required
                error={
                  selectedOpp && !customerId
                    ? 'This opportunity has no linked customer.'
                    : undefined
                }
              >
                <Select
                  id="opportunity"
                  value={opportunityId}
                  onChange={(e) => setOpportunityId(e.target.value)}
                  required
                >
                  <option value="">Select an opportunity…</option>
                  {opportunities.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Valid until" htmlFor="validUntil" required>
                <Input
                  id="validUntil"
                  type="date"
                  value={validUntil}
                  // Forward-looking: a bid's validity can't expire in the past.
                  min={todayDateStr()}
                  onChange={(e) => setValidUntil(e.target.value)}
                  required
                />
              </Field>
              <Field
                label="Tender reference number (optional)"
                htmlFor="tenderRef"
              >
                <Input
                  id="tenderRef"
                  value={tenderReferenceNumber}
                  onChange={(e) => setTenderReferenceNumber(e.target.value)}
                />
              </Field>
              <Field
                label="Quotation subject (optional)"
                htmlFor="quotationSubject"
                className="md:col-span-2"
                hint="Used in both the Subject line and the opening paragraph of the proposal."
              >
                <Input
                  id="quotationSubject"
                  value={quotationSubject}
                  onChange={(e) => setQuotationSubject(e.target.value)}
                  placeholder="e.g. Submission of quotation for supply of 24U & 42U 800x800 racks, along with MDU"
                />
              </Field>
              <Field
                label="Technical specification"
                htmlFor="technicalSpecification"
                className="md:col-span-2"
                hint="Internal notes only — not printed on the proposal (the per-line product description carries the technical detail)."
              >
                <Textarea
                  id="technicalSpecification"
                  value={technicalSpecification}
                  onChange={(e) => setTechnicalSpecification(e.target.value)}
                />
              </Field>
              <Field
                label="Reference link (metadata only — no file upload in this phase)"
                className="md:col-span-2"
              >
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    placeholder="File name"
                    aria-label="Reference link file name"
                    value={attachmentName}
                    onChange={(e) => setAttachmentName(e.target.value)}
                  />
                  <Input
                    placeholder="https://…"
                    aria-label="Reference link URL"
                    value={attachmentUrl}
                    onChange={(e) => setAttachmentUrl(e.target.value)}
                  />
                </div>
              </Field>
            </div>
          </SCard>

          {/* Line items — aligned table */}
          <SCard className="overflow-hidden">
            <div className="flex flex-wrap items-center gap-2.5 px-5 pb-3.5 pt-[18px]">
              <span className="text-[14px] font-bold">Line items</span>
              <span className="ml-auto text-[11.5px] text-black/40 dark:text-white/35">
                Amounts in ₹
              </span>
            </div>
            <div className="overflow-x-auto">
              <div className="min-w-[860px]">
                <div className={cn(LINE_GRID, 'py-[9px]', SIGNAL_TABLE_HEAD)}>
                  <span>#</span>
                  <span>Product</span>
                  <span className="text-right">Unit price</span>
                  <span className="text-right">Qty</span>
                  <span className="text-right">Margin %</span>
                  <span className="text-right">Line disc %</span>
                  <span className="text-right">Line total</span>
                  <span />
                </div>
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
                  const quotedUnit = effectiveUnitPrice(
                    unit,
                    lineMargin,
                    marginNum,
                  );
                  const lineTotal = quotedUnit * qty * (1 - disc / 100);
                  const hasValue = l.adHoc
                    ? l.adHocUnitPrice !== ''
                    : !!product;
                  return (
                    <div
                      key={i}
                      className={cn(
                        i > 0 &&
                          'border-t border-black/[.06] dark:border-white/[.06]',
                      )}
                    >
                      <div
                        className={cn(
                          LINE_GRID,
                          'pt-[11px]',
                          l.adHoc ? 'pb-1' : 'pb-3',
                        )}
                      >
                        <span className="text-[11.5px] font-semibold tabular-nums text-black/40 dark:text-white/35">
                          {String(i + 1).padStart(2, '0')}
                        </span>
                        <Select
                          aria-label="Product"
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
                        </Select>
                        {l.adHoc ? (
                          <Input
                            type="number"
                            min={0}
                            step="0.01"
                            placeholder="0.00"
                            className="text-right tabular-nums"
                            value={l.adHocUnitPrice}
                            onChange={(e) =>
                              updateLine(i, { adHocUnitPrice: e.target.value })
                            }
                          />
                        ) : (
                          <div className="text-right text-[12.5px] tabular-nums text-black/65 dark:text-white/60">
                            {product
                              ? formatINR(product.unitPrice, numberFormatStyle)
                              : '—'}
                          </div>
                        )}
                        <Input
                          type="number"
                          min={0}
                          className="text-right tabular-nums"
                          value={l.quantity}
                          onChange={(e) =>
                            updateLine(i, { quantity: e.target.value })
                          }
                        />
                        <Input
                          type="number"
                          min={0}
                          max={500}
                          step="0.01"
                          className="text-right tabular-nums"
                          value={l.marginPercent}
                          onChange={(e) =>
                            updateLine(i, { marginPercent: e.target.value })
                          }
                          placeholder="0"
                          title="Sales margin (markup) % — internal, not shown to the customer"
                        />
                        <Input
                          type="number"
                          min={0}
                          max={100}
                          className="text-right tabular-nums"
                          value={l.lineDiscountPercent}
                          onChange={(e) =>
                            updateLine(i, {
                              lineDiscountPercent: e.target.value,
                            })
                          }
                        />
                        <div className="text-right text-[13px] font-bold tabular-nums">
                          {hasValue && qty
                            ? formatINR(lineTotal, numberFormatStyle)
                            : '—'}
                        </div>
                        <div className="justify-self-center">
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
                        </div>
                      </div>
                      {l.adHoc && (
                        <div className="grid gap-2 px-5 pb-3 pl-[56px] md:grid-cols-2">
                          <Input
                            placeholder="New product name"
                            value={l.adHocProductName}
                            onChange={(e) =>
                              updateLine(i, {
                                adHocProductName: e.target.value,
                              })
                            }
                          />
                          <Input
                            placeholder="Description (optional)"
                            value={l.adHocDescription}
                            onChange={(e) =>
                              updateLine(i, {
                                adHocDescription: e.target.value,
                              })
                            }
                          />
                          <span className="text-xs text-warning md:col-span-2">
                            Needs product setup before order conversion.
                          </span>
                          {adHocBundleWarning(l.adHocProductName) && (
                            <Callout className="mt-0 md:col-span-2">
                              {adHocBundleWarning(l.adHocProductName)}
                            </Callout>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2.5 border-t border-black/10 bg-black/[.02] px-5 py-3 dark:border-white/[.08] dark:bg-white/[.02]">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setLines((ls) => [...ls, blankLine()])}
              >
                + Add line
              </Button>
            </div>
          </SCard>

          {/* Bid-level pricing */}
          <SCard className="px-5 py-[18px]">
            <SCardTitle title="Pricing" />
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <Field
                label="Bid-level margin %"
                htmlFor="bidMargin"
                hint="Your markup on top of each line’s margin. Internal only — it’s built into the quoted prices and never shown on the proposal."
              >
                <Input
                  id="bidMargin"
                  type="number"
                  min={0}
                  max={500}
                  step="0.01"
                  value={marginPercent}
                  onChange={(e) => setMarginPercent(e.target.value)}
                />
              </Field>
              <Field label="Bid-level discount %" htmlFor="bidDiscount">
                <Input
                  id="bidDiscount"
                  type="number"
                  min={0}
                  max={100}
                  value={discountPercent}
                  onChange={(e) => setDiscountPercent(e.target.value)}
                />
              </Field>
            </div>
          </SCard>

          {/* AMC charges */}
          <SCard className="px-5 py-[18px]">
            <SCardTitle title="AMC Charges" />
            <p className="mt-1 text-xs text-muted-foreground">
              Enter each year as a direct amount, or switch to % to charge a
              percentage of the taxable value (
              {formatINR(totals.taxable, numberFormatStyle)}).
            </p>
            <div className="mt-4 space-y-3">
              {AMC_YEARS.map(({ yearNumber, label }) => {
                const input = amcInputs[yearNumber];
                const isPercent = input.mode === 'percent';
                return (
                  <div
                    key={yearNumber}
                    className="grid gap-1 text-sm sm:grid-cols-[1fr_110px_170px] sm:items-center"
                  >
                    <span>{label}</span>
                    <Select
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
                    >
                      <option value="amount">Amount (₹)</option>
                      <option value="percent">Percent (%)</option>
                    </Select>
                    <div>
                      <Input
                        type="number"
                        min={0}
                        max={isPercent ? 100 : undefined}
                        step="0.01"
                        inputMode="decimal"
                        className="text-right tabular-nums"
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
            <div className="mt-3 flex justify-between border-t border-black/10 pt-3 font-semibold dark:border-white/[.08]">
              <span>AMC Total</span>
              <span className="tabular-nums">
                {formatINR(amcTotal, numberFormatStyle)}
              </span>
            </div>
          </SCard>
        </div>

        {/* ── Sticky summary rail ─────────────────────────────────── */}
        <div className="flex flex-col gap-3.5 xl:sticky xl:top-[4.5rem]">
          {/* Live totals preview (tax computed server-side, shown on detail). */}
          <SCard className="px-5 py-[18px]">
            <div className="text-[14px] font-bold">Bid Summary</div>
            <div className="mt-3.5 flex flex-col">
              <SummaryRow
                label="Subtotal"
                value={formatINR(totals.subtotal, numberFormatStyle)}
              />
              <SummaryRow
                label="Discount"
                value={`−${formatINR(totals.discountAmount, numberFormatStyle)}`}
              />
              <SummaryRow
                label="Taxable"
                value={formatINR(totals.taxable, numberFormatStyle)}
              />
              <SummaryRow
                label="AMC Total (untaxed)"
                value={formatINR(amcTotal, numberFormatStyle)}
              />
              <div className="flex items-baseline justify-between gap-3 pt-3">
                <span className="text-[12.5px] font-semibold">
                  Grand Total before GST
                </span>
                <span className="text-2xl font-bold tabular-nums tracking-[-1px]">
                  {formatINR(totals.taxable + amcTotal, numberFormatStyle)}
                </span>
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                Tax is applied server-side from the active GST config; the
                final total appears on the bid after saving.
              </div>
            </div>
          </SCard>

          {needsApproval && (
            <Callout className="mt-0">
              This bid&apos;s discount exceeds 10% — it will require manager
              approval before it can be sent.
            </Callout>
          )}

          {error && <p className="text-destructive">{error}</p>}
        </div>
      </form>
    </SignalPage>
  );
}
