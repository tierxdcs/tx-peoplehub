'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, ApiError } from '../../../../../lib/api';
import { Input } from '../../../../../components/ui/input';
import { Field } from '../../../../../components/ui/field';
import { useToast } from '../../../../../components/ui/toaster';
import { VoucherShell } from '../../_components/voucher-shell';
import { PartyPicker } from '../../_components/party-picker';

interface Customer {
  id: string;
  name: string;
  gstin: string | null;
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
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerId, setCustomerId] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState(
    new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
  );
  const [description, setDescription] = useState('');
  const [hsn, setHsn] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [price, setPrice] = useState('');
  const [gstRate, setGstRate] = useState('18');
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

  const lineTotal = (Number(quantity) || 0) * (Number(price) || 0);
  const gstAmount = (lineTotal * (Number(gstRate) || 0)) / 100;
  const total = lineTotal + gstAmount;
  // A single-line tax invoice is inherently balanced once it has a positive
  // total — there is no separate Dr/Cr entry for the preparer to unbalance.
  const balanced = !!customerId && !!description && !!hsn && total > 0;

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
          lines: [
            {
              description,
              hsnSacCode: hsn,
              quantity: Number(quantity),
              unitOfMeasure: 'NOS',
              unitPrice: Number(price),
              igstRate: Number(gstRate),
            },
          ],
        }),
      });
      if (submit) {
        await apiFetch(`/finance/ar/invoices/${invoice.id}/submit`, { method: 'POST' });
      }
      toast.success(submit ? 'Sales voucher submitted for approval' : 'Sales voucher saved as draft');
      router.push('/finance/ar/invoices');
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to create sales voucher');
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
      balanceLabel={balanced ? `Total ₹${total.toFixed(2)}` : 'Fill in party and line details'}
      submitting={submitting}
      onSaveDraft={() => void create(false)}
      onSubmitForApproval={() => void create(true)}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Party (Customer)" required>
          <PartyPicker
            options={customers.map((c) => ({ id: c.id, label: c.name, sublabel: c.gstin ?? undefined }))}
            value={customerId}
            onChange={setCustomerId}
            placeholder="Search customers…"
          />
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
          <Field label="HSN/SAC" required>
            <Input value={hsn} onChange={(e) => setHsn(e.target.value)} />
          </Field>
          <Field label="Quantity">
            <Input type="number" step="0.0001" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
          </Field>
          <Field label="Unit Price" required>
            <Input type="number" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} />
          </Field>
          <Field label="IGST %">
            <Input type="number" step="0.01" value={gstRate} onChange={(e) => setGstRate(e.target.value)} />
          </Field>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label="Place of Supply (State)" required>
            <Input value={state} onChange={(e) => setState(e.target.value)} />
          </Field>
          <Field label="State Code" required>
            <Input maxLength={2} value={stateCode} onChange={(e) => setStateCode(e.target.value)} />
          </Field>
        </div>
        <div className="mt-3 flex justify-end gap-6 border-t pt-3 text-sm">
          <span>
            Subtotal: <strong>₹{lineTotal.toFixed(2)}</strong>
          </span>
          <span>
            GST: <strong>₹{gstAmount.toFixed(2)}</strong>
          </span>
          <span>
            Total: <strong>₹{total.toFixed(2)}</strong>
          </span>
        </div>
      </div>
    </VoucherShell>
  );
}
