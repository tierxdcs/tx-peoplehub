'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Trash2 } from 'lucide-react';
import { apiFetch, ApiError } from '../../../../../lib/api';
import { formatINR } from '../../../../../lib/sales';
import { useNumberFormat } from '../../../../../lib/number-format-context';
import { Input } from '../../../../../components/ui/input';
import { Field } from '../../../../../components/ui/field';
import { Button } from '../../../../../components/ui/button';
import { useToast } from '../../../../../components/ui/toaster';
import { VoucherShell } from '../../_components/voucher-shell';
import { PartyPicker } from '../../_components/party-picker';

interface Customer {
  id: string;
  name: string;
  gstin: string | null;
}

interface VoucherLine {
  id: string;
  description: string;
  hsnSacCode: string;
  quantity: string;
  unitOfMeasure: string;
  unitPrice: string;
  discountPercent: string;
  igstRate: string;
  cgstRate: string;
  sgstRate: string;
}

function newLine(): VoucherLine {
  return {
    id: crypto.randomUUID(),
    description: '',
    hsnSacCode: '',
    quantity: '1',
    unitOfMeasure: 'NOS',
    unitPrice: '',
    discountPercent: '0',
    igstRate: '18',
    cgstRate: '0',
    sgstRate: '0',
  };
}

function lineAmounts(line: VoucherLine) {
  const gross = (Number(line.quantity) || 0) * (Number(line.unitPrice) || 0);
  const discount = (gross * (Number(line.discountPercent) || 0)) / 100;
  const taxable = gross - discount;
  const gst =
    (taxable *
      ((Number(line.igstRate) || 0) +
        (Number(line.cgstRate) || 0) +
        (Number(line.sgstRate) || 0))) /
    100;
  return { gross, discount, taxable, gst, total: taxable + gst };
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
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerId, setCustomerId] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState(
    new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
  );
  const [lines, setLines] = useState<VoucherLine[]>(() => [newLine()]);
  const [state, setState] = useState('Karnataka');
  const [stateCode, setStateCode] = useState('29');
  const [narration, setNarration] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    apiFetch<Customer[]>('/finance/ar/reference/customers')
      .then(setCustomers)
      .catch(() => toast.error('Failed to load customers'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const amounts = lines.map(lineAmounts);
  const subtotal = amounts.reduce((sum, line) => sum + line.gross, 0);
  const discountAmount = amounts.reduce((sum, line) => sum + line.discount, 0);
  const taxableAmount = amounts.reduce((sum, line) => sum + line.taxable, 0);
  const gstAmount = amounts.reduce((sum, line) => sum + line.gst, 0);
  const total = amounts.reduce((sum, line) => sum + line.total, 0);
  // GST rule of thumb: IGST is for inter-state supplies, CGST+SGST for
  // intra-state — they are mutually exclusive on a line. Soft warning only;
  // saving is never blocked (the preparer may know better).
  const mixedGst = lines.some(
    (line) =>
      Number(line.igstRate) > 0 &&
      (Number(line.cgstRate) > 0 || Number(line.sgstRate) > 0),
  );
  const linesValid = lines.every(
    (line) =>
      line.description.trim() &&
      line.hsnSacCode.trim() &&
      line.unitOfMeasure.trim() &&
      Number(line.quantity) > 0 &&
      Number(line.unitPrice) >= 0 &&
      Number(line.discountPercent) >= 0 &&
      Number(line.discountPercent) <= 100,
  );
  const balanced = !!customerId && lines.length > 0 && linesValid && total > 0;

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
          invoiceDate: date,
          dueDate,
          currencyCode: 'INR',
          placeOfSupplyState: state,
          placeOfSupplyStateCode: stateCode,
          lines: lines.map((line) => ({
            description: line.description.trim(),
            hsnSacCode: line.hsnSacCode.trim(),
            quantity: Number(line.quantity),
            unitOfMeasure: line.unitOfMeasure.trim(),
            unitPrice: Number(line.unitPrice),
            discountPercent: Number(line.discountPercent) || 0,
            igstRate: Number(line.igstRate) || 0,
            cgstRate: Number(line.cgstRate) || 0,
            sgstRate: Number(line.sgstRate) || 0,
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
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Party (Customer)" required>
          <PartyPicker
            options={customers.map((c) => ({
              id: c.id,
              label: c.name,
              sublabel: c.gstin ?? undefined,
            }))}
            value={customerId}
            onChange={setCustomerId}
            placeholder="Search customers…"
          />
        </Field>
        <Field label="Due Date" required>
          <Input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
          />
        </Field>
      </div>

      <div className="rounded-md border p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className="text-sm font-medium text-muted-foreground">
            Line items
          </h3>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setLines((current) => [...current, newLine()])}
          >
            <Plus className="mr-1 size-4" /> Add line
          </Button>
        </div>
        <div className="space-y-4">
          {lines.map((line, index) => {
            const amount = amounts[index];
            return (
              <div key={line.id} className="rounded-md border bg-muted/20 p-3">
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-sm font-semibold">
                    Item {index + 1}
                  </span>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    disabled={lines.length === 1}
                    aria-label={`Remove item ${index + 1}`}
                    onClick={() => removeLine(line.id)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <Field label="Description" required>
                    <Input
                      value={line.description}
                      onChange={(event) =>
                        updateLine(line.id, 'description', event.target.value)
                      }
                    />
                  </Field>
                  <Field label="HSN/SAC" required>
                    <Input
                      value={line.hsnSacCode}
                      onChange={(event) =>
                        updateLine(line.id, 'hsnSacCode', event.target.value)
                      }
                    />
                  </Field>
                  <Field label="Quantity" required>
                    <Input
                      type="number"
                      min={0.0001}
                      step="0.0001"
                      value={line.quantity}
                      onChange={(event) =>
                        updateLine(line.id, 'quantity', event.target.value)
                      }
                    />
                  </Field>
                  <Field label="UOM" required>
                    <Input
                      value={line.unitOfMeasure}
                      onChange={(event) =>
                        updateLine(line.id, 'unitOfMeasure', event.target.value)
                      }
                    />
                  </Field>
                  <Field label="Unit Price" required>
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      value={line.unitPrice}
                      onChange={(event) =>
                        updateLine(line.id, 'unitPrice', event.target.value)
                      }
                    />
                  </Field>
                  <Field label="Discount %">
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      step="0.01"
                      value={line.discountPercent}
                      onChange={(event) =>
                        updateLine(
                          line.id,
                          'discountPercent',
                          event.target.value,
                        )
                      }
                    />
                  </Field>
                  <Field label="IGST %">
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      value={line.igstRate}
                      onChange={(event) =>
                        updateLine(line.id, 'igstRate', event.target.value)
                      }
                    />
                  </Field>
                  <Field label="CGST %">
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      value={line.cgstRate}
                      onChange={(event) =>
                        updateLine(line.id, 'cgstRate', event.target.value)
                      }
                    />
                  </Field>
                  <Field label="SGST %">
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      value={line.sgstRate}
                      onChange={(event) =>
                        updateLine(line.id, 'sgstRate', event.target.value)
                      }
                    />
                  </Field>
                </div>
                <div className="mt-3 flex flex-wrap justify-end gap-x-5 gap-y-1 border-t pt-3 text-xs text-muted-foreground">
                  <span>
                    Taxable: {formatINR(amount.taxable, numberFormatStyle)}
                  </span>
                  <span>GST: {formatINR(amount.gst, numberFormatStyle)}</span>
                  <strong className="text-foreground">
                    Line total: {formatINR(amount.total, numberFormatStyle)}
                  </strong>
                </div>
              </div>
            );
          })}
        </div>
        {mixedGst && (
          <div className="mt-3 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
            IGST is combined with CGST/SGST on this line. A supply is either
            inter-state (IGST alone) or intra-state (CGST + SGST) — using both
            is usually a GST filing error. You can still save if this is
            intentional.
          </div>
        )}
        <div className="mt-4 flex flex-wrap justify-end gap-6 border-t pt-3 text-sm">
          <span>
            Subtotal: <strong>{formatINR(subtotal, numberFormatStyle)}</strong>
          </span>
          <span>
            Discount:{' '}
            <strong>{formatINR(discountAmount, numberFormatStyle)}</strong>
          </span>
          <span>
            Taxable:{' '}
            <strong>{formatINR(taxableAmount, numberFormatStyle)}</strong>
          </span>
          <span>
            GST: <strong>{formatINR(gstAmount, numberFormatStyle)}</strong>
          </span>
          <span>
            Total: <strong>{formatINR(total, numberFormatStyle)}</strong>
          </span>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Place of Supply (State)" required>
          <Input value={state} onChange={(e) => setState(e.target.value)} />
        </Field>
        <Field label="State Code" required>
          <Input
            maxLength={2}
            value={stateCode}
            onChange={(e) => setStateCode(e.target.value)}
          />
        </Field>
      </div>
    </VoucherShell>
  );
}
