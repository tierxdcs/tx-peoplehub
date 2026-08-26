'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Trash2 } from 'lucide-react';
import { apiFetch, ApiError } from '../../../../../lib/api';
import { formatINR } from '../../../../../lib/sales';
import { useNumberFormat } from '../../../../../lib/number-format-context';
import { Input } from '../../../../../components/ui/input';
import { Field } from '../../../../../components/ui/field';
import {
  Callout,
  SCard,
  SCardTitle,
  SIGNAL_BTN_OUTLINE,
  SIGNAL_ROW_DIVIDER,
  SIGNAL_TABLE_HEAD,
  SummaryRow,
} from '../../../../../components/ui/signal';
import { cn } from '../../../../../lib/utils';
import { useToast } from '../../../../../components/ui/toaster';
import { VoucherShell } from '../../_components/voucher-shell';
import { PartyPicker } from '../../_components/party-picker';

/** Shared column template for the line-item table header + body rows. */
const LINE_GRID =
  'grid grid-cols-[26px_minmax(240px,1.7fr)_110px_84px_80px_112px_120px_32px] gap-2.5 px-5';

interface Partner {
  id: string;
  companyName: string;
}

interface VoucherLine {
  id: string;
  description: string;
  hsnSacCode: string;
  quantity: string;
  unitOfMeasure: string;
  price: string;
}

function newLine(): VoucherLine {
  return {
    id: crypto.randomUUID(),
    description: '',
    hsnSacCode: '',
    quantity: '1',
    unitOfMeasure: 'NOS',
    price: '',
  };
}

/**
 * Money is computed in whole paise, not floats. The backend refuses an invoice
 * whose CGST + SGST + IGST doesn't EXACTLY equal the sum of its line tax
 * amounts (ap.service.ts), and it compares them as decimals — so summing
 * floats here (0.1 + 0.2 → 0.30000000000000004) would get the voucher
 * rejected. Every component is rounded to paise per line, and the
 * invoice-level totals are integer sums of those same rounded values.
 */
function taxablePaise(line: VoucherLine) {
  return Math.round(
    (Number(line.quantity) || 0) * (Number(line.price) || 0) * 100,
  );
}

function componentPaise(basePaise: number, rate: number) {
  return Math.round((basePaise * rate) / 100);
}

const rupees = (paise: number) => paise / 100;

/**
 * Purchase Voucher entry — a Tally-shaped surface over the SAME
 * AccountsPayableInvoice create path (POST /finance/ap/invoices). Direct-bill
 * mode (no purchaseOrderId/grnLineId) — both are optional on the DTO, so this
 * is a fully supported entry path, not a new one. Vendor and Supplier are
 * separate partner types in this schema; the picker lists both together and
 * we route the id to whichever field matches.
 *
 * Layout mirrors the Sales Voucher (Signal wide form exemplar): aligned
 * line-item table, sticky totals rail, actions in the page header. GST is a
 * single invoice-level selection applied to the combined taxable value rather
 * than per-line rates — a vendor bill carries one tax treatment.
 */
export default function NewPurchaseVoucherPage() {
  const router = useRouter();
  const toast = useToast();
  const { style: numberFormatStyle } = useNumberFormat();
  const [suppliers, setSuppliers] = useState<Partner[]>([]);
  const [vendors, setVendors] = useState<Partner[]>([]);
  const [partyId, setPartyId] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState(
    new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
  );
  const [externalInvoiceNumber, setExternalInvoiceNumber] = useState('');
  const [lines, setLines] = useState<VoucherLine[]>(() => [newLine()]);
  // Input GST is transcribed from the vendor's bill, so the rates start at zero
  // (as the old per-line fields did) rather than assuming a slab.
  const [igstRate, setIgstRate] = useState('0');
  const [cgstRate, setCgstRate] = useState('0');
  const [sgstRate, setSgstRate] = useState('0');
  const [narration, setNarration] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    apiFetch<{ suppliers: Partner[]; vendors: Partner[] }>(
      '/finance/ap/reference/partners',
    )
      .then((r) => {
        setSuppliers(r.suppliers);
        setVendors(r.vendors);
      })
      .catch(() => toast.error('Failed to load vendors/suppliers'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isSupplier = suppliers.some((s) => s.id === partyId);
  const numericIgstRate = Number(igstRate) || 0;
  const numericCgstRate = Number(cgstRate) || 0;
  const numericSgstRate = Number(sgstRate) || 0;
  const gstRate = numericIgstRate + numericCgstRate + numericSgstRate;

  const linePaise = lines.map((line) => {
    const taxable = taxablePaise(line);
    const cgst = componentPaise(taxable, numericCgstRate);
    const sgst = componentPaise(taxable, numericSgstRate);
    const igst = componentPaise(taxable, numericIgstRate);
    return { taxable, cgst, sgst, igst, tax: cgst + sgst + igst };
  });
  const subtotalPaise = linePaise.reduce((sum, line) => sum + line.taxable, 0);
  const cgstPaise = linePaise.reduce((sum, line) => sum + line.cgst, 0);
  const sgstPaise = linePaise.reduce((sum, line) => sum + line.sgst, 0);
  const igstPaise = linePaise.reduce((sum, line) => sum + line.igst, 0);
  const taxPaise = cgstPaise + sgstPaise + igstPaise;
  const totalPaise = subtotalPaise + taxPaise;

  // GST rule of thumb: IGST is for inter-state supplies, CGST+SGST for
  // intra-state — they are mutually exclusive on a bill. Soft warning only;
  // saving is never blocked (the preparer may know better).
  const mixedGst =
    numericIgstRate > 0 && (numericCgstRate > 0 || numericSgstRate > 0);
  const gstRatesValid = [
    numericIgstRate,
    numericCgstRate,
    numericSgstRate,
  ].every((rate) => rate >= 0 && rate <= 100);
  const linesValid = lines.every(
    (line) =>
      line.description.trim() &&
      line.unitOfMeasure.trim() &&
      Number(line.quantity) > 0 &&
      line.price.trim() !== '' &&
      Number(line.price) >= 0,
  );
  const balanced =
    !!partyId &&
    !!externalInvoiceNumber &&
    lines.length > 0 &&
    linesValid &&
    gstRatesValid &&
    totalPaise > 0;

  function updateLine(
    id: string,
    field: keyof Omit<VoucherLine, 'id'>,
    value: string,
  ) {
    setLines((current) =>
      current.map((line) =>
        line.id === id ? { ...line, [field]: value } : line,
      ),
    );
  }

  function addLine() {
    setLines((current) => [...current, newLine()]);
  }

  function removeLine(id: string) {
    setLines((current) =>
      current.length === 1 ? current : current.filter((line) => line.id !== id),
    );
  }

  async function create(submit: boolean) {
    if (!balanced) {
      toast.error('Fill in the party and line details before saving.');
      return;
    }
    setSubmitting(true);
    try {
      const invoice = await apiFetch<{ id: string }>('/finance/ap/invoices', {
        method: 'POST',
        body: JSON.stringify({
          ...(isSupplier ? { supplierId: partyId } : { vendorId: partyId }),
          externalInvoiceNumber,
          invoiceDate: date,
          receivedDate: date,
          dueDate,
          currencyCode: 'INR',
          lines: lines.map((line, index) => ({
            description: line.description.trim(),
            ...(line.hsnSacCode.trim()
              ? { hsnSacCode: line.hsnSacCode.trim() }
              : {}),
            quantity: Number(line.quantity),
            unitOfMeasure: line.unitOfMeasure.trim(),
            unitPrice: Number(line.price),
            // The invoice-level rate, apportioned to this line's taxable value.
            taxAmount: rupees(linePaise[index].tax),
          })),
          inputCgstAmount: rupees(cgstPaise),
          inputSgstAmount: rupees(sgstPaise),
          inputIgstAmount: rupees(igstPaise),
          notes: narration.trim() || undefined,
        }),
      });
      if (submit) {
        await apiFetch(`/finance/ap/invoices/${invoice.id}/submit`, {
          method: 'POST',
        });
      }
      toast.success(
        submit
          ? 'Purchase voucher submitted for approval'
          : 'Purchase voucher saved as draft',
      );
      router.push('/finance/ap/invoices');
    } catch (e) {
      toast.error(
        e instanceof ApiError ? e.message : 'Failed to create purchase voucher',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <VoucherShell
      title="Purchase Voucher"
      description="Creates a vendor bill (Accounts Payable Invoice) — direct entry, no PO link"
      date={date}
      onDateChange={setDate}
      narration={narration}
      onNarrationChange={setNarration}
      balanced={balanced}
      balanceLabel={
        balanced
          ? `Total ${formatINR(rupees(totalPaise), numberFormatStyle)}`
          : 'Fill in party and line details'
      }
      submitting={submitting}
      onSaveDraft={() => void create(false)}
      onSubmitForApproval={() => void create(true)}
      summary={
        <SCard className="px-5 py-[18px]">
          <SCardTitle title="Voucher summary" />
          <div className="mt-3.5 flex flex-col">
            <SummaryRow
              label="Subtotal"
              value={formatINR(rupees(subtotalPaise), numberFormatStyle)}
            />
            <SummaryRow
              label={`Input GST (${gstRate}%)`}
              value={formatINR(rupees(taxPaise), numberFormatStyle)}
            />
            <div className="flex items-baseline justify-between gap-3 pt-3">
              <span className="text-[12.5px] font-semibold">Total</span>
              <span className="text-2xl font-bold tabular-nums tracking-[-1px]">
                {formatINR(rupees(totalPaise), numberFormatStyle)}
              </span>
            </div>
          </div>
        </SCard>
      }
      sections={
        <>
          {/* Line items — aligned table (Signal form exemplar) */}
          <SCard className="overflow-hidden">
            <div className="px-5 pb-3.5 pt-[18px]">
              <div className="flex flex-wrap items-center gap-2.5">
                <span className="text-[14px] font-bold">Line items</span>
                <span className="rounded-full bg-black/10 px-2 py-[3px] text-[10.5px] font-semibold text-black/65 dark:bg-white/[.08] dark:text-white/60">
                  {lines.length} {lines.length === 1 ? 'line' : 'lines'}
                </span>
                <span className="ml-auto text-[11.5px] text-black/40 dark:text-white/35">
                  Amounts in ₹
                </span>
                <button
                  type="button"
                  onClick={addLine}
                  className={cn(
                    SIGNAL_BTN_OUTLINE,
                    'inline-flex items-center gap-1.5 px-3 py-1.5 text-[11.5px]',
                  )}
                >
                  <Plus className="size-3.5" /> Add line
                </button>
              </div>
              <p className="mt-1.5 text-[11.5px] text-black/40 dark:text-white/35">
                Add every item or service included on the vendor invoice.
              </p>
            </div>
            <div className="overflow-x-auto">
              <div className="min-w-[900px]">
                <div
                  className={cn(
                    LINE_GRID,
                    SIGNAL_TABLE_HEAD,
                    'items-center py-[9px]',
                  )}
                >
                  <span>#</span>
                  <span>Description</span>
                  <span>HSN/SAC</span>
                  <span className="text-right">Qty</span>
                  <span>UOM</span>
                  <span className="text-right">Unit price</span>
                  <span className="text-right">Taxable</span>
                  <span />
                </div>
                {lines.map((line, index) => (
                  <div
                    key={line.id}
                    className={cn(
                      LINE_GRID,
                      'items-start pb-3 pt-[11px]',
                      index > 0 && 'border-t',
                      index > 0 && SIGNAL_ROW_DIVIDER,
                    )}
                  >
                    <span className="pt-2 text-[11.5px] font-semibold tabular-nums text-black/40 dark:text-white/35">
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    <Input
                      aria-label={`Description for item ${index + 1}`}
                      value={line.description}
                      onChange={(event) =>
                        updateLine(line.id, 'description', event.target.value)
                      }
                    />
                    <Input
                      aria-label="HSN/SAC"
                      value={line.hsnSacCode}
                      onChange={(event) =>
                        updateLine(line.id, 'hsnSacCode', event.target.value)
                      }
                    />
                    <Input
                      aria-label="Quantity"
                      type="number"
                      min={0.0001}
                      step="0.0001"
                      className="text-right tabular-nums"
                      value={line.quantity}
                      onChange={(event) =>
                        updateLine(line.id, 'quantity', event.target.value)
                      }
                    />
                    <Input
                      aria-label="UOM"
                      value={line.unitOfMeasure}
                      onChange={(event) =>
                        updateLine(line.id, 'unitOfMeasure', event.target.value)
                      }
                    />
                    <Input
                      aria-label="Unit price"
                      type="number"
                      min={0}
                      step="0.01"
                      className="text-right tabular-nums"
                      value={line.price}
                      onChange={(event) =>
                        updateLine(line.id, 'price', event.target.value)
                      }
                    />
                    <div className="pt-2 text-right text-[13px] font-bold tabular-nums">
                      {formatINR(
                        rupees(linePaise[index].taxable),
                        numberFormatStyle,
                      )}
                    </div>
                    {lines.length > 1 ? (
                      <button
                        type="button"
                        aria-label={`Remove item ${index + 1}`}
                        onClick={() => removeLine(line.id)}
                        className="mt-1 grid size-8 place-items-center justify-self-center rounded-md text-black/35 hover:bg-black/5 hover:text-black/70 dark:text-white/35 dark:hover:bg-white/5 dark:hover:text-white/70"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    ) : (
                      <span />
                    )}
                  </div>
                ))}
              </div>
            </div>
          </SCard>

          {/* GST — invoice-level rates applied to the combined taxable value */}
          <SCard className="px-5 py-[18px]">
            <SCardTitle title="Input GST" />
            <p className="mt-1 text-xs text-muted-foreground">
              These rates are applied once to the combined taxable value of all
              line items.
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <Field label="IGST %">
                <Input
                  type="number"
                  min={0}
                  max={100}
                  step="0.01"
                  className="text-right tabular-nums"
                  value={igstRate}
                  onChange={(event) => setIgstRate(event.target.value)}
                />
              </Field>
              <Field label="CGST %">
                <Input
                  type="number"
                  min={0}
                  max={100}
                  step="0.01"
                  className="text-right tabular-nums"
                  value={cgstRate}
                  onChange={(event) => setCgstRate(event.target.value)}
                />
              </Field>
              <Field label="SGST %">
                <Input
                  type="number"
                  min={0}
                  max={100}
                  step="0.01"
                  className="text-right tabular-nums"
                  value={sgstRate}
                  onChange={(event) => setSgstRate(event.target.value)}
                />
              </Field>
            </div>
            {mixedGst && (
              <Callout>
                IGST is combined with CGST/SGST on this bill. A supply is either
                inter-state (IGST alone) or intra-state (CGST + SGST) — using
                both is usually a GST filing error. You can still save if this
                is intentional.
              </Callout>
            )}
          </SCard>
        </>
      }
    >
      <Field label="Party (Vendor/Supplier)" required>
        <PartyPicker
          options={[
            ...suppliers.map((s) => ({
              id: s.id,
              label: s.companyName,
              sublabel: 'Supplier',
            })),
            ...vendors.map((v) => ({
              id: v.id,
              label: v.companyName,
              sublabel: 'Vendor',
            })),
          ]}
          value={partyId}
          onChange={setPartyId}
          placeholder="Search vendors/suppliers…"
        />
      </Field>
      <Field label="Vendor Invoice No." required>
        <Input
          value={externalInvoiceNumber}
          onChange={(e) => setExternalInvoiceNumber(e.target.value)}
        />
      </Field>
      <Field label="Due Date" required>
        <Input
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
        />
      </Field>
    </VoucherShell>
  );
}
