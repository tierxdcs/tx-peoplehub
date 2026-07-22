'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, ApiError } from '../../../../../lib/api';
import { Input } from '../../../../../components/ui/input';
import { Field } from '../../../../../components/ui/field';
import { useToast } from '../../../../../components/ui/toaster';
import { VoucherShell } from '../../_components/voucher-shell';
import { PartyPicker } from '../../_components/party-picker';

interface Partner {
  id: string;
  companyName: string;
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
  const [suppliers, setSuppliers] = useState<Partner[]>([]);
  const [vendors, setVendors] = useState<Partner[]>([]);
  const [partyId, setPartyId] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState(
    new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
  );
  const [externalInvoiceNumber, setExternalInvoiceNumber] = useState('');
  const [description, setDescription] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [price, setPrice] = useState('');
  const [cgst, setCgst] = useState('0');
  const [sgst, setSgst] = useState('0');
  const [igst, setIgst] = useState('0');
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
  const lineTotal = (Number(quantity) || 0) * (Number(price) || 0);
  const taxAmount = (lineTotal * ((Number(cgst) || 0) + (Number(sgst) || 0) + (Number(igst) || 0))) / 100;
  const total = lineTotal + taxAmount;
  const balanced = !!partyId && !!externalInvoiceNumber && !!description && total > 0;

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
          lines: [
            {
              description,
              quantity: Number(quantity),
              unitOfMeasure: 'NOS',
              unitPrice: Number(price),
              taxAmount,
            },
          ],
          inputCgstAmount: (lineTotal * (Number(cgst) || 0)) / 100,
          inputSgstAmount: (lineTotal * (Number(sgst) || 0)) / 100,
          inputIgstAmount: (lineTotal * (Number(igst) || 0)) / 100,
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
      balanceLabel={balanced ? `Total ₹${total.toFixed(2)}` : 'Fill in party and line details'}
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
        <h3 className="mb-3 text-sm font-medium text-muted-foreground">Line item</h3>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Description" required>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
          <Field label="Quantity">
            <Input type="number" step="0.0001" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
          </Field>
          <Field label="Unit Price" required>
            <Input type="number" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} />
          </Field>
          <Field label="CGST %">
            <Input type="number" step="0.01" value={cgst} onChange={(e) => setCgst(e.target.value)} />
          </Field>
          <Field label="SGST %">
            <Input type="number" step="0.01" value={sgst} onChange={(e) => setSgst(e.target.value)} />
          </Field>
          <Field label="IGST %">
            <Input type="number" step="0.01" value={igst} onChange={(e) => setIgst(e.target.value)} />
          </Field>
        </div>
        <div className="mt-3 flex justify-end gap-6 border-t pt-3 text-sm">
          <span>
            Subtotal: <strong>₹{lineTotal.toFixed(2)}</strong>
          </span>
          <span>
            Tax: <strong>₹{taxAmount.toFixed(2)}</strong>
          </span>
          <span>
            Total: <strong>₹{total.toFixed(2)}</strong>
          </span>
        </div>
      </div>
    </VoucherShell>
  );
}
