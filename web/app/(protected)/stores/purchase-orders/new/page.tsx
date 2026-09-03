'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Plus, Trash2 } from 'lucide-react';
import { ApiError } from '../../../../lib/api';
import {
  createPurchaseOrder,
  getPurchaseOrder,
  isQualifiedStatus,
  updatePurchaseOrder,
  type CreatePurchaseOrderInput,
} from '../../../../lib/stores';
import { listSuppliers, type Supplier } from '../../../../lib/scm-supplier';
import { listVendors, type Vendor } from '../../../../lib/scm';
import { listItems, type Item } from '../../../../lib/scm-item-master';
import { formatINR } from '../../../../lib/sales';
import {
  COMPANY_GST_STATE_CODE,
  DEFAULT_GST_RATE,
  GST_STATES,
  gstSplitWarning,
  gstStateByCode,
  gstStateCodeFromGstin,
  isIntraStateSupply,
  splitGstRate,
} from '../../../../lib/gst-states';
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
import {
  Callout,
  RouteStep,
  SCard,
  SCardTitle,
  SIGNAL_BTN_GHOST,
  SIGNAL_BTN_PRIMARY,
  SignalChip,
  SignalHeader,
  SignalPage,
  SummaryRow,
} from '../../../../components/ui/signal';
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

const COMPANY_STATE_NAME = gstStateByCode(COMPANY_GST_STATE_CODE)?.name ?? '';

/**
 * A new order opens at the standard slab, split for our own state until a party
 * with a GSTIN elsewhere is chosen. The server never assumes a slab — an omitted
 * rate stays zero there — so proposing 18% is this form's job, exactly as it is
 * the Sales Voucher's.
 */
const INITIAL_GST = splitGstRate(DEFAULT_GST_RATE, COMPANY_GST_STATE_CODE);

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
  const searchParams = useSearchParams();
  const editId = searchParams.get('edit');
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
  // Kept as the raw string so a half-typed "3" doesn't get coerced mid-edit.
  const [advancePercent, setAdvancePercent] = useState('');
  // GST is order-level: these rates apply once to the summed line total. Kept as
  // strings for the same reason as the advance — a half-typed rate must survive.
  const [gstStateCode, setGstStateCode] = useState(COMPANY_GST_STATE_CODE);
  const [igstRate, setIgstRate] = useState(String(INITIAL_GST.igstRate));
  const [cgstRate, setCgstRate] = useState(String(INITIAL_GST.cgstRate));
  const [sgstRate, setSgstRate] = useState(String(INITIAL_GST.sgstRate));
  /**
   * The party the tax was last seeded from. Seeding once per party change lets
   * the split follow the supplier's registration automatically without ever
   * overwriting a state the buyer picked by hand afterwards.
   */
  const [gstSeededFor, setGstSeededFor] = useState<string | null>(null);
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()]);
  const [submitting, setSubmitting] = useState(false);
  const [editingNumber, setEditingNumber] = useState<string | null>(null);

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

  useEffect(() => {
    if (!editId) return;
    getPurchaseOrder(editId)
      .then((po) => {
        if (po.status !== 'DRAFT') {
          toast.error('Only draft purchase orders can be edited.');
          router.replace(`/stores/purchase-orders/${po.id}`);
          return;
        }
        setEditingNumber(po.poNumber);
        if (po.supplierId) {
          setPartnerType('SUPPLIER');
          setPartnerId(po.supplierId);
        } else if (po.vendorId) {
          setPartnerType('VENDOR');
          setPartnerId(po.vendorId);
        } else {
          setPartnerType('AD_HOC');
          setPartnerId('');
        }
        setAdHocPartyName(po.adHocPartyName ?? '');
        setAdHocContactInfo(po.adHocContactInfo ?? '');
        setAdHocPartyAddress(po.adHocPartyAddress ?? '');
        setExpectedDeliveryDate(po.expectedDeliveryDate?.slice(0, 10) ?? '');
        setNotes(po.notes ?? '');
        setAdvancePercent(po.advance?.percent ?? '');
        setGstStateCode(po.gst.stateCode);
        setIgstRate(po.gst.igstRate);
        setCgstRate(po.gst.cgstRate);
        setSgstRate(po.gst.sgstRate);
        // Treat the saved tax as already seeded from this party: it may be a
        // deliberate override (an SEZ or import supply), and re-deriving it from
        // the GSTIN on load would quietly discard that.
        setGstSeededFor(po.supplierId ?? po.vendorId ?? 'AD_HOC');
        setLines(
          po.lines.map((line) => {
            const catalog = !!line.itemId;
            return {
              key: lineKeySeq++,
              source: catalog ? 'CATALOG' : 'FREE_TEXT',
              itemId: line.itemId ?? '',
              adHocItemName: catalog ? '' : line.itemName,
              adHocDescription: line.adHocDescription ?? '',
              unitOfMeasure: line.unitOfMeasure,
              customUnit:
                !catalog && !COMMON_UNITS.includes(line.unitOfMeasure),
              orderedQuantity: line.orderedQuantity,
              unitPrice: line.unitPrice,
            };
          }),
        );
      })
      .catch((error) =>
        toast.error(
          error instanceof ApiError ? error.message : 'Failed to load PO.',
        ),
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editId]);

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

  // ── GST ───────────────────────────────────────────────────────────────
  // On a purchase the SUPPLIER's registration decides the split, not ours: a
  // Karnataka supplier is an intra-state supply (CGST + SGST), one anywhere else
  // is inter-state (IGST). Mirror image of the Sales Voucher, where the
  // customer's place of supply decides it.
  const numericIgstRate = Number(igstRate) || 0;
  const numericCgstRate = Number(cgstRate) || 0;
  const numericSgstRate = Number(sgstRate) || 0;
  const totalGstRate = numericIgstRate + numericCgstRate + numericSgstRate;
  const gstAmount = (total * totalGstRate) / 100;
  const grandTotal = total + gstAmount;
  const gstStateName = gstStateByCode(gstStateCode)?.name ?? '';
  const intraState = isIntraStateSupply(gstStateCode);
  const gstWarning = gstSplitWarning(gstStateCode, {
    igstRate: numericIgstRate,
    cgstRate: numericCgstRate,
    sgstRate: numericSgstRate,
  });
  const gstRatesValid = [
    numericIgstRate,
    numericCgstRate,
    numericSgstRate,
  ].every((rate) => Number.isFinite(rate) && rate >= 0 && rate <= 100);

  /**
   * Re-split the SAME total rate for a new state. Taking the total rather than a
   * fixed 18 means a buyer who has chosen a 5%, 12% or 28% slab keeps that slab
   * when the state changes — only the split moves.
   */
  const applyGstState = useCallback((code: string, totalRate: number) => {
    const split = splitGstRate(totalRate, code);
    setGstStateCode(code);
    setIgstRate(String(split.igstRate));
    setCgstRate(String(split.cgstRate));
    setSgstRate(String(split.sgstRate));
  }, []);

  // Seed the state from the chosen party's own GSTIN, so picking a Tamil Nadu
  // vendor moves 9 + 9 onto IGST 18 without the buyer having to know that. A
  // party with no GSTIN on record leaves the state alone rather than guessing.
  const partnerKey = partnerType === 'AD_HOC' ? 'AD_HOC' : partnerId;
  useEffect(() => {
    if (!partnerKey || gstSeededFor === partnerKey) return;
    setGstSeededFor(partnerKey);
    const code = gstStateCodeFromGstin(selectedPartner?.gstin);
    if (code && code !== gstStateCode) applyGstState(code, totalGstRate);
  }, [
    partnerKey,
    gstSeededFor,
    selectedPartner,
    gstStateCode,
    totalGstRate,
    applyGstState,
  ]);

  // An advance needs a registered party — an ad-hoc PO has no payables account
  // for Accounts to pay it from, so the server rejects one outright.
  const advanceAllowed = partnerType !== 'AD_HOC';
  const advanceEntered = advanceAllowed && advancePercent.trim() !== '';
  const advanceNumber = Number(advancePercent);
  const advanceValid =
    advanceEntered &&
    Number.isFinite(advanceNumber) &&
    advanceNumber > 0 &&
    advanceNumber <= 100;
  /**
   * Preview only — the server recomputes this with Decimal arithmetic and
   * freezes the result on the PO when it is issued. Shown so the buyer sees the
   * rupee commitment before agreeing to a percentage.
   */
  const advanceAmount = advanceValid
    ? Math.round(total * advanceNumber) / 100
    : null;

  function updateLine(key: number, patch: Partial<LineDraft>) {
    setLines((prev) =>
      prev.map((l) => (l.key === key ? { ...l, ...patch } : l)),
    );
  }
  function addLine(source: LineDraft['source']) {
    setLines((prev) => [...prev, emptyLine(source)]);
  }
  function removeLine(key: number) {
    setLines((prev) =>
      prev.length > 1 ? prev.filter((l) => l.key !== key) : prev,
    );
  }

  const validLines = lines.filter(
    (l) =>
      (l.source === 'CATALOG'
        ? !!l.itemId
        : !!l.adHocItemName.trim() && !!l.unitOfMeasure.trim()) &&
      Number(l.orderedQuantity) > 0 &&
      Number(l.unitPrice) >= 0,
  );
  const hasParty =
    partnerType === 'AD_HOC' ? !!adHocPartyName.trim() : !!partnerId;
  const canSubmit =
    hasParty &&
    validLines.length > 0 &&
    !(advanceEntered && !advanceValid) &&
    gstRatesValid &&
    !submitting;

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
    if (advanceEntered && !advanceValid) {
      out.push('Advance % must be between 0.01 and 100');
    }
    if (!gstRatesValid) out.push('GST rates must each be between 0 and 100');
    return out;
  }, [
    hasParty,
    partnerType,
    lines,
    advanceEntered,
    advanceValid,
    gstRatesValid,
  ]);

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
      ...(expectedDeliveryDate
        ? { expectedDeliveryDate: new Date(expectedDeliveryDate).toISOString() }
        : {}),
      ...(notes ? { notes } : {}),
      ...(advanceValid ? { advancePercent: advanceNumber } : {}),
      // Always sent, including zeroes: a buyer who clears the tax is asserting
      // the order carries none, which is different from not saying.
      gstStateCode,
      igstRate: numericIgstRate,
      cgstRate: numericCgstRate,
      sgstRate: numericSgstRate,
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
      const po = editId
        ? await updatePurchaseOrder(editId, {
            ...input,
            supplierId: partnerType === 'SUPPLIER' ? partnerId : null,
            vendorId: partnerType === 'VENDOR' ? partnerId : null,
            adHocPartyName:
              partnerType === 'AD_HOC' ? adHocPartyName.trim() : null,
            adHocContactInfo:
              partnerType === 'AD_HOC' ? adHocContactInfo.trim() || null : null,
            adHocPartyAddress:
              partnerType === 'AD_HOC'
                ? adHocPartyAddress.trim() || null
                : null,
            advancePercent: advanceValid ? advanceNumber : null,
            expectedDeliveryDate: expectedDeliveryDate
              ? new Date(expectedDeliveryDate).toISOString()
              : null,
            notes,
          })
        : await createPurchaseOrder(input);
      if (po.qualificationWarning) {
        toast.success(
          `PO ${po.poNumber} created — note: ${po.qualificationWarning.message}`,
          'Created with warning',
        );
      } else {
        toast.success(
          editId
            ? `Purchase order ${po.poNumber} updated`
            : `Purchase order ${po.poNumber} saved as draft`,
        );
      }
      router.push(`/stores/purchase-orders/${po.id}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to save PO');
      setSubmitting(false);
    }
  }

  return (
    <SignalPage>
      <SignalHeader
        backHref="/stores/purchase-orders"
        backLabel="Purchase Orders"
        title={editingNumber ? `Edit ${editingNumber}` : 'New Purchase Order'}
        chip={
          <SignalChip>
            {partnerType === 'AD_HOC' ? 'Draft · exception' : 'Draft'}
          </SignalChip>
        }
        actions={
          <>
            <button
              type="button"
              onClick={() => router.push('/stores/purchase-orders')}
              className={SIGNAL_BTN_GHOST}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!canSubmit}
              className={SIGNAL_BTN_PRIMARY}
            >
              {submitting
                ? 'Saving…'
                : editId
                  ? 'Save Changes'
                  : 'Create Purchase Order'}
            </button>
          </>
        }
      />

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
              <SCardTitle
                title="Trading Party"
                subtitle="Who you are buying from"
              />
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
                    <Field
                      label="Contact Information"
                      htmlFor="adHocContactInfo"
                    >
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
                    This exception PO will remain blocked until the
                    CEO/SuperAdmin approves the unlisted party. It cannot be
                    issued or used for a GRN before approval.
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
                  {humanizeEnum(selectedPartner!.status)}. The purchase order is
                  still allowed (emergency purchases are legitimate), but review
                  before issuing.
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
                      Number(line.orderedQuantity) * Number(line.unitPrice) ||
                      0;
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
                                  updateLine(line.key, {
                                    unitOfMeasure: value,
                                  });
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
                              updateLine(line.key, {
                                unitPrice: e.target.value,
                              })
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

            {/* GST — order-level rates applied once to the summed line total */}
            <SCard className="px-5 py-[18px]">
              <SCardTitle
                title="GST"
                subtitle="Printed on the purchase order and matched against the supplier's invoice"
              />
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <Field
                  label="Supplier's GST State (Place of Supply)"
                  htmlFor="gstStateCode"
                  hint={
                    intraState
                      ? `${COMPANY_STATE_NAME} is our own state — intra-state purchase, taxed CGST + SGST.`
                      : `Outside ${COMPANY_STATE_NAME} — inter-state purchase, taxed IGST.`
                  }
                >
                  <Select
                    id="gstStateCode"
                    value={gstStateCode}
                    onChange={(e) =>
                      applyGstState(e.target.value, totalGstRate)
                    }
                  >
                    {GST_STATES.map((s) => (
                      <option key={s.code} value={s.code}>
                        {s.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field
                  label="State Code"
                  hint="Taken from the supplier's GSTIN when they have one on record."
                >
                  <Input
                    readOnly
                    className="tabular-nums"
                    value={gstStateCode}
                  />
                </Field>
              </div>
              <p className="mt-3 text-[12px] text-black/50 dark:text-white/45">
                These rates apply once to the combined line total of{' '}
                {formatINR(total, numberFormatStyle)}. Changing the state
                re-splits the same total rate — edit a rate below to use a
                different slab, or clear all three for an order that carries no
                tax.
              </p>
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <Field label="IGST %" htmlFor="igstRate">
                  <Input
                    id="igstRate"
                    type="number"
                    inputMode="decimal"
                    min="0"
                    max="100"
                    step="0.01"
                    className="text-right tabular-nums"
                    value={igstRate}
                    onChange={(e) => setIgstRate(e.target.value)}
                  />
                </Field>
                <Field label="CGST %" htmlFor="cgstRate">
                  <Input
                    id="cgstRate"
                    type="number"
                    inputMode="decimal"
                    min="0"
                    max="100"
                    step="0.01"
                    className="text-right tabular-nums"
                    value={cgstRate}
                    onChange={(e) => setCgstRate(e.target.value)}
                  />
                </Field>
                <Field label="SGST %" htmlFor="sgstRate">
                  <Input
                    id="sgstRate"
                    type="number"
                    inputMode="decimal"
                    min="0"
                    max="100"
                    step="0.01"
                    className="text-right tabular-nums"
                    value={sgstRate}
                    onChange={(e) => setSgstRate(e.target.value)}
                  />
                </Field>
              </div>
              {!gstRatesValid && (
                <p className="mt-2 text-[12px] text-destructive">
                  Each rate must be between 0 and 100.
                </p>
              )}
              {gstWarning && (
                <Callout>
                  {gstWarning} You can still save if this is intentional.
                </Callout>
              )}
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
                <Field
                  label="Advance %"
                  htmlFor="advancePercent"
                  hint={
                    advanceAllowed
                      ? 'Optional. Printed on the PO as a payment term, and sent to Accounts as a payment request when the PO is issued.'
                      : 'Not available for an unlisted party — an advance needs a registered supplier or vendor.'
                  }
                >
                  <Input
                    id="advancePercent"
                    type="number"
                    inputMode="decimal"
                    min="0.01"
                    max="100"
                    step="0.01"
                    placeholder="e.g. 30"
                    disabled={!advanceAllowed}
                    value={advanceAllowed ? advancePercent : ''}
                    onChange={(e) => setAdvancePercent(e.target.value)}
                  />
                  {advanceEntered &&
                    (advanceValid ? (
                      <p className="mt-1.5 text-[12px] text-black/50 dark:text-white/45">
                        Advance {formatINR(advanceAmount, numberFormatStyle)} of{' '}
                        {formatINR(total, numberFormatStyle)} — exclusive of
                        taxes.
                      </p>
                    ) : (
                      <p className="mt-1.5 text-[12px] text-destructive">
                        Enter a percentage between 0.01 and 100.
                      </p>
                    ))}
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
                  label="Taxable value"
                  value={formatINR(total, numberFormatStyle)}
                />
                <SummaryRow
                  label={`GST (${totalGstRate}%)`}
                  value={formatINR(gstAmount, numberFormatStyle)}
                />
                {advanceAmount !== null && (
                  <SummaryRow
                    label={`Advance (${advanceNumber}% of taxable)`}
                    value={formatINR(advanceAmount, numberFormatStyle)}
                  />
                )}
                <div className="flex items-baseline justify-between pt-3">
                  <span className="text-[12.5px] font-semibold">Total</span>
                  <span className="text-2xl font-bold tabular-nums tracking-[-1px]">
                    {formatINR(grandTotal, numberFormatStyle)}
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
    </SignalPage>
  );
}

// ── Building blocks ─────────────────────────────────────────────────────────

function Req() {
  return <span className="text-[#D9363E] dark:text-[#FF5257]">*</span>;
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
