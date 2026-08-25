'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2 } from 'lucide-react';
import { apiFetch, ApiError } from '../../../../../lib/api';
import { formatINR } from '../../../../../lib/sales';
import { useNumberFormat } from '../../../../../lib/number-format-context';
import { Input } from '../../../../../components/ui/input';
import { Field } from '../../../../../components/ui/field';
import {
  Callout,
  SCard,
  SCardTitle,
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
  'grid grid-cols-[26px_minmax(240px,1.7fr)_110px_84px_80px_112px_78px_120px_32px] gap-2.5 px-5';

interface OrderCustomer {
  id: string;
  name: string;
  gstin: string | null;
}

interface OrderReference {
  id: string;
  orderNumber: string;
  orderType: 'CUSTOMER' | 'INTERNAL';
  status: string;
  customerId: string | null;
  customer: OrderCustomer | null;
  lineItems: Array<{
    productId: string | null;
    adHocProductName: string | null;
    adHocDescription: string | null;
    /** Customer's own PO wording for this line, when Sales set one — the
     * invoice must carry this, not the internal Product Master name. */
    customerFacingProductName: string | null;
    customerFacingDescription: string | null;
    quantity: string;
    unitPrice: string;
    product: {
      name: string;
      description: string | null;
      sku: string;
      hsnCode: string | null;
      unitOfMeasure: string;
    } | null;
  }>;
}

interface VoucherLine {
  id: string;
  productId: string | null;
  /** Read-only: what the order says this line is called. */
  productName: string;
  /** Read-only: the line's description, printed under the name. */
  productDescription: string;
  hsnSacCode: string;
  quantity: string;
  unitOfMeasure: string;
  unitPrice: string;
  discountPercent: string;
}

/**
 * The name and description an invoice line must carry, taken from the order
 * line: Sales' customer-facing override wins over the internal master wording,
 * because the customer's own PO names the item their way.
 */
function orderLineWording(line: OrderReference['lineItems'][number]) {
  const name =
    line.customerFacingProductName ??
    line.product?.name ??
    line.adHocProductName ??
    '';
  const description =
    line.customerFacingDescription ??
    line.product?.description ??
    line.adHocDescription ??
    '';
  // An ad-hoc line may carry a description and no name at all; promote it so
  // the invoice line is never nameless.
  return name ? { name, description } : { name: description, description: '' };
}

function lineAmounts(line: VoucherLine) {
  const gross = (Number(line.quantity) || 0) * (Number(line.unitPrice) || 0);
  const discount = (gross * (Number(line.discountPercent) || 0)) / 100;
  const taxable = gross - discount;
  return { gross, discount, taxable };
}

/**
 * Sales Voucher entry — a Tally-shaped alternative surface over the SAME
 * SalesInvoice create path the register page uses (POST /finance/ar/invoices,
 * identical DTO). No new data path: this creates a normal DRAFT SalesInvoice
 * that flows through submit/approve/issue exactly like one created the old
 * way, including posting through postJournalTx on approval.
 */
export default function NewSalesVoucherPage() {
  const router = useRouter();
  const toast = useToast();
  const { style: numberFormatStyle } = useNumberFormat();
  const [orders, setOrders] = useState<OrderReference[]>([]);
  const [orderId, setOrderId] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState(
    new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
  );
  // Empty until an order is picked: every line's name and description come
  // from the order, so there is nothing to show (or invoice) before that.
  const [lines, setLines] = useState<VoucherLine[]>([]);
  const [igstRate, setIgstRate] = useState('18');
  const [cgstRate, setCgstRate] = useState('0');
  const [sgstRate, setSgstRate] = useState('0');
  const [state, setState] = useState('Karnataka');
  const [stateCode, setStateCode] = useState('29');
  const [narration, setNarration] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    apiFetch<OrderReference[]>('/finance/ar/reference/orders')
      .then((rows) =>
        setOrders(
          rows.filter(
            (order) =>
              order.orderType === 'CUSTOMER' &&
              order.status !== 'CANCELLED' &&
              !!order.customerId,
          ),
        ),
      )
      .catch(() => toast.error('Failed to load customer orders'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const amounts = lines.map(lineAmounts);
  const subtotal = amounts.reduce((sum, line) => sum + line.gross, 0);
  const discountAmount = amounts.reduce((sum, line) => sum + line.discount, 0);
  const taxableAmount = amounts.reduce((sum, line) => sum + line.taxable, 0);
  const numericIgstRate = Number(igstRate) || 0;
  const numericCgstRate = Number(cgstRate) || 0;
  const numericSgstRate = Number(sgstRate) || 0;
  const gstAmount =
    (taxableAmount * (numericIgstRate + numericCgstRate + numericSgstRate)) /
    100;
  const total = taxableAmount + gstAmount;
  // GST rule of thumb: IGST is for inter-state supplies, CGST+SGST for
  // intra-state — they are mutually exclusive on an invoice. Soft warning only;
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
      line.productName.trim() &&
      line.hsnSacCode.trim() &&
      line.unitOfMeasure.trim() &&
      Number(line.quantity) > 0 &&
      Number(line.unitPrice) >= 0 &&
      Number(line.discountPercent) >= 0 &&
      Number(line.discountPercent) <= 100,
  );
  const balanced =
    !!orderId &&
    !!customerId &&
    lines.length > 0 &&
    linesValid &&
    gstRatesValid &&
    total > 0;

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

  function selectOrder(id: string) {
    const order = orders.find((candidate) => candidate.id === id);
    if (!order || !order.customerId) return;

    setOrderId(order.id);
    setCustomerId(order.customerId);
    setLines(
      order.lineItems.map((line) => {
        const wording = orderLineWording(line);
        return {
          id: crypto.randomUUID(),
          productId: line.productId,
          productName: wording.name,
          productDescription: wording.description,
          hsnSacCode: line.product?.hsnCode ?? '',
          quantity: String(line.quantity),
          unitOfMeasure: line.product?.unitOfMeasure ?? 'NOS',
          unitPrice: String(line.unitPrice),
          discountPercent: '0',
        };
      }),
    );

    if (order.lineItems.length === 0) {
      toast.error('This order has no line items to invoice.');
    }
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
      const invoice = await apiFetch<{ id: string }>('/finance/ar/invoices', {
        method: 'POST',
        body: JSON.stringify({
          customerId,
          orderId,
          invoiceDate: date,
          dueDate,
          currencyCode: 'INR',
          placeOfSupplyState: state,
          placeOfSupplyStateCode: stateCode,
          lines: lines.map((line) => ({
            productId: line.productId ?? undefined,
            // One `description` column holds both: the name first, the
            // description on the next line. Every renderer (voucher, invoice
            // detail, printed tax invoice) preserves that newline.
            description: [
              line.productName.trim(),
              line.productDescription.trim(),
            ]
              .filter(Boolean)
              .join('\n'),
            hsnSacCode: line.hsnSacCode.trim(),
            quantity: Number(line.quantity),
            unitOfMeasure: line.unitOfMeasure.trim(),
            unitPrice: Number(line.unitPrice),
            discountPercent: Number(line.discountPercent) || 0,
            // The current invoice API stores rates on its line records. The
            // voucher exposes one invoice-level selection and applies that
            // same selection uniformly to every persisted line.
            igstRate: numericIgstRate,
            cgstRate: numericCgstRate,
            sgstRate: numericSgstRate,
          })),
        }),
      });
      if (submit) {
        await apiFetch(`/finance/ar/invoices/${invoice.id}/submit`, {
          method: 'POST',
        });
      }
      toast.success(
        submit
          ? 'Sales voucher submitted for approval'
          : 'Sales voucher saved as draft',
      );
      router.push('/finance/ar/invoices');
    } catch (e) {
      toast.error(
        e instanceof ApiError ? e.message : 'Failed to create sales voucher',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <VoucherShell
      title="Sales Voucher"
      description="Creates a Sales Invoice — the same document the register page creates"
      date={date}
      onDateChange={setDate}
      narration={narration}
      onNarrationChange={setNarration}
      balanced={balanced}
      balanceLabel={
        balanced
          ? `Total ${formatINR(total, numberFormatStyle)}`
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
              value={formatINR(subtotal, numberFormatStyle)}
            />
            <SummaryRow
              label="Discount"
              value={`−${formatINR(discountAmount, numberFormatStyle)}`}
            />
            <SummaryRow
              label="Taxable"
              value={formatINR(taxableAmount, numberFormatStyle)}
            />
            <SummaryRow
              label={`GST (${numericIgstRate + numericCgstRate + numericSgstRate}%)`}
              value={formatINR(gstAmount, numberFormatStyle)}
            />
            <div className="flex items-baseline justify-between gap-3 pt-3">
              <span className="text-[12.5px] font-semibold">Total</span>
              <span className="text-2xl font-bold tabular-nums tracking-[-1px]">
                {formatINR(total, numberFormatStyle)}
              </span>
            </div>
          </div>
        </SCard>
      }
      sections={
        <>
          {/* Line items — aligned table (Signal form exemplar) */}
          <SCard className="overflow-hidden">
            <div className="flex flex-wrap items-center gap-2.5 px-5 pb-3.5 pt-[18px]">
              <span className="text-[14px] font-bold">Line items</span>
              <span className="rounded-full bg-black/10 px-2 py-[3px] text-[10.5px] font-semibold text-black/65 dark:bg-white/[.08] dark:text-white/60">
                {lines.length} {lines.length === 1 ? 'line' : 'lines'}
              </span>
              <span className="ml-auto text-[11.5px] text-black/40 dark:text-white/35">
                Amounts in ₹
              </span>
            </div>
            <div className="overflow-x-auto">
              <div className="min-w-[1000px]">
                <div
                  className={cn(
                    LINE_GRID,
                    SIGNAL_TABLE_HEAD,
                    'items-center py-[9px]',
                  )}
                >
                  <span>#</span>
                  <span>Product &amp; description</span>
                  <span>HSN/SAC</span>
                  <span className="text-right">Qty</span>
                  <span>UOM</span>
                  <span className="text-right">Unit price</span>
                  <span className="text-right">Disc %</span>
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
                    {/* Read-only: the name and description are the order's
                        wording (Sales' customer-facing override when set), not
                        something Accounts retypes per invoice. */}
                    <div className="min-w-0 py-1.5">
                      <div className="text-[13px] font-semibold leading-snug">
                        {line.productName}
                      </div>
                      {line.productDescription && (
                        <div className="mt-1 whitespace-pre-line text-[12px] leading-normal text-black/55 dark:text-white/50">
                          {line.productDescription}
                        </div>
                      )}
                    </div>
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
                      value={line.unitPrice}
                      onChange={(event) =>
                        updateLine(line.id, 'unitPrice', event.target.value)
                      }
                    />
                    <Input
                      aria-label="Discount %"
                      type="number"
                      min={0}
                      max={100}
                      step="0.01"
                      className="text-right tabular-nums"
                      value={line.discountPercent}
                      onChange={(event) =>
                        updateLine(
                          line.id,
                          'discountPercent',
                          event.target.value,
                        )
                      }
                    />
                    <div className="pt-2 text-right text-[13px] font-bold tabular-nums">
                      {formatINR(amounts[index].taxable, numberFormatStyle)}
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
                {lines.length === 0 && (
                  <div className="px-5 py-7 text-center text-[12.5px] text-black/45 dark:text-white/40">
                    Pick an Order ID above — its lines load here with the
                    product name and description as the order states them.
                  </div>
                )}
              </div>
            </div>
          </SCard>

          {/* GST — invoice-level rates applied to the combined taxable value */}
          <SCard className="px-5 py-[18px]">
            <SCardTitle title="GST" />
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
                IGST is combined with CGST/SGST on this invoice. A supply is
                either inter-state (IGST alone) or intra-state (CGST + SGST) —
                using both is usually a GST filing error. You can still save if
                this is intentional.
              </Callout>
            )}
          </SCard>
        </>
      }
    >
      <Field label="Order ID" required>
        <PartyPicker
          options={orders.map((order) => ({
            id: order.id,
            label: order.orderNumber,
            sublabel: order.customer?.name ?? undefined,
          }))}
          value={orderId}
          onChange={selectOrder}
          placeholder="Search order ID or customer…"
        />
      </Field>
      <Field label="Due Date" required>
        <Input
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
        />
      </Field>
      <Field label="Party (Customer)">
        <Input
          readOnly
          value={
            orders.find((order) => order.id === orderId)?.customer?.name ?? ''
          }
          placeholder="Selected automatically from the order"
        />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Place of Supply (State)" required>
          <Input value={state} onChange={(e) => setState(e.target.value)} />
        </Field>
        <Field label="State Code" required>
          <Input
            maxLength={2}
            className="tabular-nums"
            value={stateCode}
            onChange={(e) => setStateCode(e.target.value)}
          />
        </Field>
      </div>
    </VoucherShell>
  );
}
