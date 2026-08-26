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

interface Partner {
  id: string;
  companyName: string;
}

interface VoucherLine {
  id: string;
  description: string;
  quantity: string;
  price: string;
  cgst: string;
  sgst: string;
  igst: string;
}

function newLine(): VoucherLine {
  return {
    id: crypto.randomUUID(),
    description: '',
    quantity: '1',
    price: '',
    cgst: '0',
    sgst: '0',
    igst: '0',
  };
}

function lineAmounts(line: VoucherLine) {
  const subtotal = (Number(line.quantity) || 0) * (Number(line.price) || 0);
  const cgstAmount = (subtotal * (Number(line.cgst) || 0)) / 100;
  const sgstAmount = (subtotal * (Number(line.sgst) || 0)) / 100;
  const igstAmount = (subtotal * (Number(line.igst) || 0)) / 100;
  const taxAmount = cgstAmount + sgstAmount + igstAmount;
  return {
    subtotal,
    cgstAmount,
    sgstAmount,
    igstAmount,
    taxAmount,
    total: subtotal + taxAmount,
  };
}

/**
 * Purchase Voucher entry — a Tally-shaped surface over the SAME
 * AccountsPayableInvoice create path (POST /finance/ap/invoices). Direct-bill
 * mode (no purchaseOrderId/grnLineId) — both are optional on the DTO, so this
 * is a fully supported entry path, not a new one. Vendor and Supplier are
 * separate partner types in this schema; the picker lists both together and
 * we route the id to whichever field matches.
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
  const [narration, setNarration] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    apiFetch<{ suppliers: Partner[]; vendors: Partner[] }>('/finance/ap/reference/partners')
      .then((r) => {
        setSuppliers(r.suppliers);
        setVendors(r.vendors);
      })
      .catch(() => toast.error('Failed to load vendors/suppliers'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isSupplier = suppliers.some((s) => s.id === partyId);
  const amounts = lines.map(lineAmounts);
  const subtotal = amounts.reduce((sum, line) => sum + line.subtotal, 0);
  const cgstAmount = amounts.reduce((sum, line) => sum + line.cgstAmount, 0);
  const sgstAmount = amounts.reduce((sum, line) => sum + line.sgstAmount, 0);
  const igstAmount = amounts.reduce((sum, line) => sum + line.igstAmount, 0);
  const taxAmount = cgstAmount + sgstAmount + igstAmount;
  const total = subtotal + taxAmount;
  const linesValid = lines.every(
    (line) =>
      line.description.trim() &&
      Number(line.quantity) > 0 &&
      line.price.trim() !== '' &&
      Number(line.price) >= 0 &&
      [line.cgst, line.sgst, line.igst].every((rate) => {
        const value = Number(rate);
        return Number.isFinite(value) && value >= 0 && value <= 100;
      }),
  );
  const balanced =
    !!partyId &&
    !!externalInvoiceNumber &&
    lines.length > 0 &&
    linesValid &&
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

  function addLine() {
    setLines((current) => [...current, newLine()]);
  }

  function removeLine(id: string) {
    setLines((current) =>
      current.length === 1
        ? current
        : current.filter((line) => line.id !== id),
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
            quantity: Number(line.quantity),
            unitOfMeasure: 'NOS',
            unitPrice: Number(line.price),
            taxAmount: amounts[index].taxAmount,
          })),
          inputCgstAmount: cgstAmount,
          inputSgstAmount: sgstAmount,
          inputIgstAmount: igstAmount,
        }),
      });
      if (submit) {
        await apiFetch(`/finance/ap/invoices/${invoice.id}/submit`, { method: 'POST' });
      }
      toast.success(submit ? 'Purchase voucher submitted for approval' : 'Purchase voucher saved as draft');
      router.push('/finance/ap/invoices');
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to create purchase voucher');
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
      balanceLabel={balanced ? `Total ${formatINR(total, numberFormatStyle)}` : 'Fill in party and line details'}
      submitting={submitting}
      onSaveDraft={() => void create(false)}
      onSubmitForApproval={() => void create(true)}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Party (Vendor/Supplier)" required>
          <PartyPicker
            options={[
              ...suppliers.map((s) => ({ id: s.id, label: s.companyName, sublabel: 'Supplier' })),
              ...vendors.map((v) => ({ id: v.id, label: v.companyName, sublabel: 'Vendor' })),
            ]}
            value={partyId}
            onChange={setPartyId}
            placeholder="Search vendors/suppliers…"
          />
        </Field>
        <Field label="Vendor Invoice No." required>
          <Input value={externalInvoiceNumber} onChange={(e) => setExternalInvoiceNumber(e.target.value)} />
        </Field>
        <Field label="Due Date" required>
          <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </Field>
      </div>

      <div className="rounded-md border p-4">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-medium">Line items</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Add every item or service included on the vendor invoice.
            </p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={addLine}>
            <Plus className="size-4" />
            Add line
          </Button>
        </div>

        <div className="space-y-4">
          {lines.map((line, index) => (
            <div key={line.id} className="rounded-md border p-4">
              <div className="mb-3 flex items-center justify-between">
                <h4 className="text-sm font-medium">Item {index + 1}</h4>
                {lines.length > 1 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove item ${index + 1}`}
                    onClick={() => removeLine(line.id)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                )}
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Description" required>
                  <Input
                    value={line.description}
                    onChange={(event) =>
                      updateLine(line.id, 'description', event.target.value)
                    }
                  />
                </Field>
                <Field label="Quantity" required>
                  <Input
                    type="number"
                    min={0}
                    step="0.0001"
                    value={line.quantity}
                    onChange={(event) =>
                      updateLine(line.id, 'quantity', event.target.value)
                    }
                  />
                </Field>
                <Field label="Unit Price" required>
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    value={line.price}
                    onChange={(event) =>
                      updateLine(line.id, 'price', event.target.value)
                    }
                  />
                </Field>
                <Field label="CGST %">
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    step="0.01"
                    value={line.cgst}
                    onChange={(event) =>
                      updateLine(line.id, 'cgst', event.target.value)
                    }
                  />
                </Field>
                <Field label="SGST %">
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    step="0.01"
                    value={line.sgst}
                    onChange={(event) =>
                      updateLine(line.id, 'sgst', event.target.value)
                    }
                  />
                </Field>
                <Field label="IGST %">
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    step="0.01"
                    value={line.igst}
                    onChange={(event) =>
                      updateLine(line.id, 'igst', event.target.value)
                    }
                  />
                </Field>
              </div>
              <div className="mt-3 flex justify-end gap-5 border-t pt-3 text-xs text-muted-foreground">
                <span>
                  Subtotal: <strong className="text-foreground">{formatINR(amounts[index].subtotal, numberFormatStyle)}</strong>
                </span>
                <span>
                  Tax: <strong className="text-foreground">{formatINR(amounts[index].taxAmount, numberFormatStyle)}</strong>
                </span>
                <span>
                  Line total: <strong className="text-foreground">{formatINR(amounts[index].total, numberFormatStyle)}</strong>
                </span>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-4 flex flex-wrap justify-end gap-6 border-t pt-4 text-sm">
          <span>
            Subtotal: <strong>{formatINR(subtotal, numberFormatStyle)}</strong>
          </span>
          <span>
            Tax: <strong>{formatINR(taxAmount, numberFormatStyle)}</strong>
          </span>
          <span>
            Total: <strong>{formatINR(total, numberFormatStyle)}</strong>
          </span>
        </div>
      </div>
    </VoucherShell>
  );
}
