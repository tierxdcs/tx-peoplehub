'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Check, Plus, Trash2, AlertTriangle } from 'lucide-react';
import { ApiError } from '../../../../lib/api';
import {
  createPurchaseOrder,
  isQualifiedStatus,
  type CreatePurchaseOrderInput,
} from '../../../../lib/stores';
import { listSuppliers, type Supplier } from '../../../../lib/scm-supplier';
import { listVendors, type Vendor } from '../../../../lib/scm';
import { listItems, type Item } from '../../../../lib/scm-item-master';
import { formatINR } from '../../../../lib/sales';
import { useNumberFormat } from '../../../../lib/number-format-context';
import { humanizeEnum } from '../../../../lib/status';
import { Input } from '../../../../components/ui/input';
import { Select } from '../../../../components/ui/select';
import { Field } from '../../../../components/ui/field';
import { Textarea } from '../../../../components/ui/textarea';
import { Badge } from '../../../../components/ui/badge';
import { OverrideTag } from '../../../../components/ui/override-tag';
import { Skeleton } from '../../../../components/ui/skeleton';
import { useToast } from '../../../../components/ui/toaster';
import { ItemPicker } from '../../../../components/ui/item-picker';
import { cn } from '../../../../lib/utils';

type PartnerType = 'SUPPLIER' | 'VENDOR' | 'AD_HOC';
interface LineDraft {
  key: number;
  source: 'CATALOG' | 'FREE_TEXT';
  itemId: string;
  adHocItemName: string;
  adHocDescription: string;
  unitOfMeasure: string;
  /** Free-text unit entry mode — chosen via "Other…" in the unit dropdown. */
  customUnit: boolean;
  orderedQuantity: string;
  unitPrice: string;
}

/** Common purchase-order units. The backend stores unitOfMeasure as a free
 * string, so this only guides input — "Other…" allows anything else. */
const COMMON_UNITS = [
  'NOS',
  'PCS',
  'SET',
  'PAIR',
  'KG',
  'G',
  'TON',
  'M',
  'MM',
  'FT',
  'SQM',
  'SQFT',
  'LTR',
  'ML',
  'ROLL',
  'SHEET',
  'BOX',
  'PACK',
  'LOT',
  'JOB',
  'HOUR',
  'DAY',
];
const OTHER_UNIT = '__OTHER__';

function emptyLine(source: LineDraft['source'] = 'CATALOG'): LineDraft {
  return {
    key: lineKeySeq++,
    source,
    itemId: '',
    adHocItemName: '',
    adHocDescription: '',
    unitOfMeasure: '',
    customUnit: false,
    orderedQuantity: '',
    unitPrice: '',
  };
}

let lineKeySeq = 1;

const LINE_GRID =
  'grid grid-cols-[26px_1.4fr_1.6fr_70px_88px_110px_110px_32px] items-center gap-2.5 px-5';

export default function NewPurchaseOrderPage() {
  const router = useRouter();
  const toast = useToast();
  const { style: numberFormatStyle } = useNumberFormat();

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);

  const [partnerType, setPartnerType] = useState<PartnerType>('SUPPLIER');
  const [partnerId, setPartnerId] = useState('');
  const [adHocPartyName, setAdHocPartyName] = useState('');
  const [adHocContactInfo, setAdHocContactInfo] = useState('');
  const [adHocPartyAddress, setAdHocPartyAddress] = useState('');
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()]);
  const [submitting, setSubmitting] = useState(false);

  // Shares the dashboard's Signal-page plumbing: paints the shell's stretched
  // <main> column in the page's theme-matched background (see globals.css).
  useEffect(() => {
    document.body.dataset.dashboardDark = '';
    return () => {
      delete document.body.dataset.dashboardDark;
    };
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const [s, v, i] = await Promise.all([
          listSuppliers(),
          listVendors(),
          listItems({ activeOnly: true }),
        ]);
        setSuppliers(s);
        setVendors(v);
        setItems(i);
      } catch {
        toast.error('Failed to load form data.');
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const partners = useMemo(
    () =>
      partnerType === 'SUPPLIER'
        ? suppliers
        : partnerType === 'VENDOR'
          ? vendors
          : [],
    [partnerType, suppliers, vendors],
  );

  // The selected partner's qualification status, resolved inline so the warning
  // is visible BEFORE submitting (not only in the server response afterward).
  const selectedPartner = useMemo(
    () => partners.find((p) => p.id === partnerId) ?? null,
    [partners, partnerId],
  );
  const unqualified =
    selectedPartner != null && !isQualifiedStatus(selectedPartner.status);

  const itemById = useCallback(
    (id: string) => items.find((it) => it.id === id) ?? null,
    [items],
  );

  const total = useMemo(
    () =>
      lines.reduce((sum, l) => {
        const q = Number(l.orderedQuantity);
        const p = Number(l.unitPrice);
        return sum + (Number.isFinite(q) && Number.isFinite(p) ? q * p : 0);
      }, 0),
    [lines],
  );

  function updateLine(key: number, patch: Partial<LineDraft>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }
  function addLine(source: LineDraft['source']) {
    setLines((prev) => [...prev, emptyLine(source)]);
  }
  function removeLine(key: number) {
    setLines((prev) => (prev.length > 1 ? prev.filter((l) => l.key !== key) : prev));
  }

  const validLines = lines.filter(
    (l) =>
      (l.source === 'CATALOG'
        ? !!l.itemId
        : !!l.adHocItemName.trim() && !!l.unitOfMeasure.trim()) &&
      Number(l.orderedQuantity) > 0 &&
      Number(l.unitPrice) >= 0,
  );
  const hasParty = partnerType === 'AD_HOC' ? !!adHocPartyName.trim() : !!partnerId;
  const canSubmit = hasParty && validLines.length > 0 && !submitting;

  // What still blocks or would drop content — feeds the summary-rail card.
  // Mirrors the actual validation above (unit price is allowed to be blank/0).
  const missing = useMemo(() => {
    const out: string[] = [];
    if (!hasParty)
      out.push(
        partnerType === 'AD_HOC'
          ? 'Party name'
          : partnerType === 'SUPPLIER'
            ? 'Supplier'
            : 'Vendor',
      );
    lines.forEach((l, i) => {
      const n = `Line ${String(i + 1).padStart(2, '0')}`;
      if (l.source === 'CATALOG') {
        if (!l.itemId) out.push(`${n} item`);
      } else {
        if (!l.adHocItemName.trim()) out.push(`${n} product name`);
        if (!l.unitOfMeasure.trim()) out.push(`${n} unit`);
      }
      if (!(Number(l.orderedQuantity) > 0)) out.push(`${n} qty`);
    });
    return out;
  }, [hasParty, partnerType, lines]);

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    const input: CreatePurchaseOrderInput = {
      ...(partnerType === 'SUPPLIER'
        ? { supplierId: partnerId }
        : partnerType === 'VENDOR'
          ? { vendorId: partnerId }
          : {
              adHocPartyName: adHocPartyName.trim(),
              ...(adHocContactInfo.trim()
                ? { adHocContactInfo: adHocContactInfo.trim() }
                : {}),
              ...(adHocPartyAddress.trim()
                ? { adHocPartyAddress: adHocPartyAddress.trim() }
                : {}),
            }),
      ...(expectedDeliveryDate ? { expectedDeliveryDate: new Date(expectedDeliveryDate).toISOString() } : {}),
      ...(notes ? { notes } : {}),
      lines: validLines.map((l) => ({
        ...(l.source === 'CATALOG'
          ? { itemId: l.itemId }
          : {
              adHocItemName: l.adHocItemName.trim(),
              ...(l.adHocDescription.trim()
                ? { adHocDescription: l.adHocDescription.trim() }
                : {}),
              unitOfMeasure: l.unitOfMeasure.trim(),
            }),
        orderedQuantity: Number(l.orderedQuantity),
        unitPrice: Number(l.unitPrice),
      })),
    };
    try {
      const po = await createPurchaseOrder(input);
      if (po.status === 'PENDING_CEO_APPROVAL') {
        toast.success(
          `PO ${po.poNumber} created and sent for CEO/SuperAdmin approval`,
        );
      } else if (po.qualificationWarning) {
        toast.success(
          `PO ${po.poNumber} created — note: ${po.qualificationWarning.message}`,
          'Created with warning',
        );
      } else {
        toast.success(`Purchase order ${po.poNumber} created`);
      }
      router.push(`/stores/purchase-orders/${po.id}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to create PO');
      setSubmitting(false);
    }
  }

  return (
    <div className="-m-4 min-h-[calc(100dvh-3.5rem)] bg-[#F4F4F4] text-[#1B1B1B] md:-m-6 dark:bg-[#1B1B1B] dark:text-[#EDEDED]">
      {/* Header action bar. */}
      <div className="flex flex-wrap items-center gap-3.5 border-b border-black/10 bg-[#ECECEC] px-5 py-3.5 lg:px-7 dark:border-white/[.07] dark:bg-[#1F1F1F]">
        <Link
          href="/stores/purchase-orders"
          className="inline-flex items-center gap-1 text-[12px] font-medium text-black/45 hover:text-black/70 dark:text-white/45 dark:hover:text-white/70"
        >
          <ArrowLeft className="size-3.5" /> Purchase Orders
        </Link>
        <span className="hidden h-4 w-px bg-black/15 sm:inline dark:bg-white/[.12]" />
        <h1 className="text-[19px] font-extrabold tracking-[-.7px]">
          New Purchase Order
        </h1>
        <span className="rounded-[5px] bg-black/10 px-[9px] py-1 text-[11.5px] font-medium text-black/65 dark:bg-white/[.09] dark:text-white/60">
          {partnerType === 'AD_HOC' ? 'Draft · exception' : 'Draft'}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => router.push('/stores/purchase-orders')}
            className="rounded-lg px-3.5 py-2 text-[12.5px] font-semibold text-black/65 hover:bg-black/5 dark:text-white/60 dark:hover:bg-white/5"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="rounded-lg bg-[#3B6FB5] px-4 py-2 text-[12.5px] font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? 'Creating…' : 'Create Purchase Order'}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="px-5 py-[18px] lg:px-7">
          <Skeleton className="h-96 w-full" />
        </div>
      ) : (
        <div className="grid items-start gap-4 px-5 pb-7 pt-[18px] lg:px-7 xl:grid-cols-[1fr_316px]">
          {/* ── Left column ─────────────────────────────────────────── */}
          <div className="flex min-w-0 flex-col gap-3.5">
            {/* Trading Party */}
            <SCard className="px-5 py-[18px]">
              <div className="flex flex-wrap items-baseline gap-2.5">
                <span className="text-[14px] font-bold">Trading Party</span>
                <span className="text-[11.5px] text-black/40 dark:text-white/35">
                  Who you are buying from
                </span>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <Field label="Partner Type" htmlFor="partnerType">
                  <Select
                    id="partnerType"
                    value={partnerType}
                    onChange={(e) => {
                      const nextType = e.target.value as PartnerType;
                      setPartnerType(nextType);
                      setPartnerId('');
                      if (nextType !== 'AD_HOC') {
                        setLines((current) =>
                          current.map((line) =>
                            line.source === 'FREE_TEXT' ? emptyLine() : line,
                          ),
                        );
                      }
                    }}
                  >
                    <option value="SUPPLIER">Supplier (raw materials)</option>
                    <option value="VENDOR">Vendor (finished goods)</option>
                    <option value="AD_HOC">Ad-hoc / Unlisted Party</option>
                  </Select>
                </Field>
                {partnerType !== 'AD_HOC' ? (
                  <Field
                    label={partnerType === 'SUPPLIER' ? 'Supplier' : 'Vendor'}
                    htmlFor="partner"
                    required
                    hint="Qualification status is shown beside each name."
                  >
                    <Select
                      id="partner"
                      value={partnerId}
                      onChange={(e) => setPartnerId(e.target.value)}
                    >
                      <option value="">Select…</option>
                      {partners.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.companyName} — {humanizeEnum(p.status)}
                          {p.statusOverridden ? ' (manually overridden)' : ''}
                          {isQualifiedStatus(p.status) ? '' : ' ⚠'}
                        </option>
                      ))}
                    </Select>
                  </Field>
                ) : (
                  <Field label="Party Name" htmlFor="adHocPartyName" required>
                    <Input
                      id="adHocPartyName"
                      value={adHocPartyName}
                      onChange={(e) => setAdHocPartyName(e.target.value)}
                      placeholder="Legal or trading name"
                    />
                  </Field>
                )}
              </div>

              {partnerType === 'AD_HOC' && (
                <>
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <Field label="Contact Information" htmlFor="adHocContactInfo">
                      <Textarea
                        id="adHocContactInfo"
                        value={adHocContactInfo}
                        onChange={(e) => setAdHocContactInfo(e.target.value)}
                        placeholder="Contact name, phone and email"
                      />
                    </Field>
                    <Field label="Address" htmlFor="adHocPartyAddress">
                      <Textarea
                        id="adHocPartyAddress"
                        value={adHocPartyAddress}
                        onChange={(e) => setAdHocPartyAddress(e.target.value)}
                        placeholder="Billing / delivery party address"
                      />
                    </Field>
                  </div>
                  <Callout>
                    This exception PO will remain blocked until the CEO/SuperAdmin
                    approves the unlisted party. It cannot be issued or used for a GRN
                    before approval.
                  </Callout>
                </>
              )}

              {selectedPartner && (
                <div className="mt-3.5 flex flex-wrap items-center gap-2 text-sm">
                  <span className="text-black/45 dark:text-white/45">
                    Qualification:
                  </span>
                  <Badge
                    variant={
                      isQualifiedStatus(selectedPartner.status)
                        ? 'success'
                        : 'warning'
                    }
                  >
                    {humanizeEnum(selectedPartner.status)}
                  </Badge>
                  {selectedPartner.statusOverridden && <OverrideTag />}
                </div>
              )}

              {unqualified && (
                <Callout>
                  <span className="font-medium">
                    This {partnerType.toLowerCase()} is not qualified.
                  </span>{' '}
                  {selectedPartner?.companyName} is currently{' '}
                  {humanizeEnum(selectedPartner!.status)}. The purchase order is still
                  allowed (emergency purchases are legitimate), but review before
                  issuing.
                </Callout>
              )}
            </SCard>

            {/* Line Items — a real aligned table. */}
            <SCard className="overflow-hidden">
              <div className="flex flex-wrap items-center gap-2.5 px-5 pb-3.5 pt-[18px]">
                <span className="text-[14px] font-bold">Line Items</span>
                <span className="rounded-full bg-black/10 px-2 py-[3px] text-[10.5px] font-semibold text-black/65 dark:bg-white/[.08] dark:text-white/60">
                  {lines.length} {lines.length === 1 ? 'line' : 'lines'}
                </span>
                <span className="ml-auto text-[11.5px] text-black/40 dark:text-white/35">
                  Amounts in ₹
                </span>
              </div>
              <div className="overflow-x-auto">
                <div className="min-w-[860px]">
                  <div
                    className={cn(
                      LINE_GRID,
                      'border-y border-black/10 bg-black/[.035] py-[9px] text-[12px] font-medium text-black/60 dark:border-white/[.08] dark:bg-white/[.035] dark:text-white/[.62]',
                    )}
                  >
                    <span>#</span>
                    <span>
                      Product / service <Req />
                    </span>
                    <span>Description</span>
                    <span className="text-right">Qty</span>
                    <span>Unit</span>
                    <span className="text-right">Unit Price (₹)</span>
                    <span className="text-right">Line Total</span>
                    <span />
                  </div>
                  {lines.map((line, index) => {
                    const item = itemById(line.itemId);
                    const lineTotal =
                      Number(line.orderedQuantity) * Number(line.unitPrice) || 0;
                    return (
                      <div
                        key={line.key}
                        className={cn(
                          index > 0 &&
                            'border-t border-black/[.06] dark:border-white/[.06]',
                        )}
                      >
                        <div className={cn(LINE_GRID, 'pb-1 pt-[11px]')}>
                          <span className="text-[11.5px] font-semibold tabular-nums text-black/40 dark:text-white/35">
                            {String(index + 1).padStart(2, '0')}
                          </span>
                          {line.source === 'CATALOG' ? (
                            <ItemPicker
                              items={items}
                              value={line.itemId}
                              onValueChange={(itemId) =>
                                updateLine(line.key, { itemId })
                              }
                            />
                          ) : (
                            <Input
                              value={line.adHocItemName}
                              onChange={(e) =>
                                updateLine(line.key, {
                                  adHocItemName: e.target.value,
                                })
                              }
                              placeholder="Enter a free-text line item"
                            />
                          )}
                          {line.source === 'CATALOG' ? (
                            <div
                              className="truncate text-[12.5px] text-black/55 dark:text-white/55"
                              title={item?.description ?? undefined}
                            >
                              {item?.description ?? '—'}
                            </div>
                          ) : (
                            <Input
                              value={line.adHocDescription}
                              onChange={(e) =>
                                updateLine(line.key, {
                                  adHocDescription: e.target.value,
                                })
                              }
                              placeholder="Specification or scope"
                            />
                          )}
                          <Input
                            type="number"
                            min="0"
                            step="any"
                            className="text-right tabular-nums"
                            value={line.orderedQuantity}
                            onChange={(e) =>
                              updateLine(line.key, {
                                orderedQuantity: e.target.value,
                              })
                            }
                          />
                          {line.source === 'CATALOG' ? (
                            <div className="truncate text-[12.5px] font-medium text-black/65 dark:text-white/60">
                              {item?.baseUnitOfMeasure ?? '—'}
                            </div>
                          ) : line.customUnit ? (
                            // "Other…" mode: type any unit; clearing it and
                            // leaving the field returns to the dropdown.
                            <Input
                              autoFocus
                              value={line.unitOfMeasure}
                              onChange={(e) =>
                                updateLine(line.key, {
                                  unitOfMeasure: e.target.value,
                                })
                              }
                              onBlur={() => {
                                if (!line.unitOfMeasure.trim())
                                  updateLine(line.key, {
                                    customUnit: false,
                                    unitOfMeasure: '',
                                  });
                              }}
                              placeholder="Unit"
                            />
                          ) : (
                            <Select
                              aria-label="Unit"
                              value={line.unitOfMeasure}
                              onChange={(e) => {
                                const value = e.target.value;
                                if (value === OTHER_UNIT)
                                  updateLine(line.key, {
                                    customUnit: true,
                                    unitOfMeasure: '',
                                  });
                                else
                                  updateLine(line.key, { unitOfMeasure: value });
                              }}
                            >
                              <option value="">Unit…</option>
                              {COMMON_UNITS.map((u) => (
                                <option key={u} value={u}>
                                  {u}
                                </option>
                              ))}
                              <option value={OTHER_UNIT}>Other…</option>
                            </Select>
                          )}
                          <Input
                            type="number"
                            min="0"
                            step="any"
                            className="text-right tabular-nums"
                            value={line.unitPrice}
                            onChange={(e) =>
                              updateLine(line.key, { unitPrice: e.target.value })
                            }
                          />
                          <div className="text-right text-[13px] font-bold tabular-nums">
                            {formatINR(lineTotal, numberFormatStyle)}
                          </div>
                          <button
                            type="button"
                            onClick={() => removeLine(line.key)}
                            disabled={lines.length === 1}
                            aria-label="Remove line"
                            className="grid size-8 place-items-center justify-self-center rounded-md text-black/35 hover:bg-black/5 hover:text-black/70 disabled:cursor-not-allowed disabled:opacity-40 dark:text-white/35 dark:hover:bg-white/5 dark:hover:text-white/70"
                          >
                            <Trash2 className="size-4" />
                          </button>
                        </div>
                        <div className="px-5 pb-3 pl-[56px] text-[11px] text-black/40 dark:text-white/35">
                          {line.source === 'CATALOG'
                            ? 'Item master · will create a stock record and can be received through GRN'
                            : 'Free-text · This line stays on this PO only. It will not create an Item Master or stock record and cannot be received through GRN.'}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2.5 border-t border-black/10 bg-black/[.02] px-5 py-3 dark:border-white/[.08] dark:bg-white/[.02]">
                <AddLineButton onClick={() => addLine('CATALOG')}>
                  Add Item Master line
                </AddLineButton>
                {partnerType === 'AD_HOC' && (
                  <AddLineButton onClick={() => addLine('FREE_TEXT')}>
                    Add free-text line
                  </AddLineButton>
                )}
                <span className="ml-auto text-[12px] text-black/50 dark:text-white/45">
                  Subtotal{' '}
                  <b className="ml-2 text-[14px] font-bold text-[#1B1B1B] dark:text-[#EDEDED]">
                    {formatINR(total, numberFormatStyle)}
                  </b>
                </span>
              </div>
            </SCard>

            {/* Details */}
            <SCard className="px-5 py-[18px]">
              <span className="text-[14px] font-bold">Details</span>
              <div className="mt-4 grid gap-3 md:grid-cols-[200px_1fr]">
                <Field label="Expected Delivery Date" htmlFor="edd">
                  <Input
                    id="edd"
                    type="date"
                    value={expectedDeliveryDate}
                    onChange={(e) => setExpectedDeliveryDate(e.target.value)}
                  />
                </Field>
                <Field
                  label="Notes"
                  htmlFor="notes"
                  hint="Internal note, not printed on the PO."
                >
                  <Textarea
                    id="notes"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                  />
                </Field>
              </div>
            </SCard>
          </div>

          {/* ── Sticky summary rail ─────────────────────────────────── */}
          <div className="flex flex-col gap-3.5 xl:sticky xl:top-[4.5rem]">
            <SCard className="px-5 py-[18px]">
              <div className="text-[14px] font-bold">Order Summary</div>
              <div className="mt-3.5 flex flex-col">
                <SummaryRow label="Lines" value={String(lines.length)} />
                <SummaryRow
                  label="Subtotal"
                  value={formatINR(total, numberFormatStyle)}
                />
                <div className="flex items-baseline justify-between pt-3">
                  <span className="text-[12.5px] font-semibold">Total</span>
                  <span className="text-2xl font-bold tabular-nums tracking-[-1px]">
                    {formatINR(total, numberFormatStyle)}
                  </span>
                </div>
              </div>
            </SCard>

            <SCard className="px-5 py-[18px]">
              <div className="text-[14px] font-bold">Approval Route</div>
              <div className="mt-3.5 flex flex-col">
                <RouteStep state="done" title="Drafted" meta="You · today" />
                {partnerType === 'AD_HOC' && (
                  <RouteStep
                    state="active"
                    title="Unlisted party approval"
                    meta="CEO / SuperAdmin · required"
                  />
                )}
                <RouteStep
                  state="future"
                  title="Issued to party"
                  meta="Unlocks GRN"
                  last
                />
              </div>
            </SCard>

            {missing.length > 0 && (
              <div className="rounded-xl border border-[#E5484D]/30 bg-[#E5484D]/[.07] px-4 py-3.5">
                <div className="text-[11.5px] font-medium text-[#C13438] dark:text-[#FF8A8D]">
                  {missing.length} {missing.length === 1 ? 'field' : 'fields'}{' '}
                  remaining
                </div>
                <div className="mt-2 text-[11.5px] leading-relaxed text-black/60 dark:text-white/60">
                  {missing.join(' · ')}
                </div>
                {canSubmit && (
                  <div className="mt-2 text-[11px] text-black/45 dark:text-white/45">
                    Incomplete lines are not included when you create the PO.
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Building blocks ─────────────────────────────────────────────────────────

function SCard({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'rounded-xl border border-black/10 bg-white dark:border-white/[.08] dark:bg-[#232323]',
        className,
      )}
    >
      {children}
    </div>
  );
}

function Req() {
  return <span className="text-[#D9363E] dark:text-[#FF5257]">*</span>;
}

/** The orange exception/warning callout from the 3a spec. */
function Callout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-3.5 flex gap-2.5 rounded-[9px] border border-[#C9761B] bg-[#E08A2C]/[.09] px-3.5 py-3 dark:border-[#E08A2C]">
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[#C9761B] dark:text-[#E08A2C]" />
      <p className="text-[12px] leading-normal text-black/70 dark:text-white/[.72]">
        {children}
      </p>
    </div>
  );
}

function AddLineButton({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded-lg border border-dashed border-black/25 px-3 py-[7px] text-[12px] font-semibold text-black/70 hover:bg-black/[.03] dark:border-white/[.22] dark:text-white/70 dark:hover:bg-white/[.04]"
    >
      <Plus className="size-3.5" /> {children}
    </button>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-black/[.07] py-2 text-[12px] font-medium text-black/60 dark:border-white/[.07] dark:text-white/55">
      <span>{label}</span>
      <span className="text-[12.5px] font-semibold tabular-nums text-[#1B1B1B] dark:text-[#EDEDED]">
        {value}
      </span>
    </div>
  );
}

function RouteStep({
  state,
  title,
  meta,
  last,
}: {
  state: 'done' | 'active' | 'future';
  title: string;
  meta: string;
  last?: boolean;
}) {
  return (
    <div className="flex gap-[11px]">
      <div className="flex flex-col items-center">
        {state === 'done' ? (
          <span className="grid size-[18px] flex-none place-items-center rounded-full bg-[#1E9E63] dark:bg-[#3DD68C]">
            <Check className="size-3 text-white dark:text-[#1B1B1B]" />
          </span>
        ) : (
          <span
            className={cn(
              'size-[18px] flex-none rounded-full border-2',
              state === 'active'
                ? 'border-[#3B6FB5] dark:border-[#6FA3E0]'
                : 'border-black/15 dark:border-white/[.16]',
            )}
          />
        )}
        {!last && (
          <span className="min-h-[22px] w-[2px] flex-1 bg-black/10 dark:bg-white/[.12]" />
        )}
      </div>
      <div className={cn(!last && 'pb-3.5')}>
        <div
          className={cn(
            'text-[12.5px] font-semibold',
            state === 'active' && 'text-[#3B6FB5] dark:text-[#6FA3E0]',
            state === 'future' && 'text-black/40 dark:text-white/40',
          )}
        >
          {title}
        </div>
        <div className="text-[11px] text-black/45 dark:text-white/40">{meta}</div>
      </div>
    </div>
  );
}
