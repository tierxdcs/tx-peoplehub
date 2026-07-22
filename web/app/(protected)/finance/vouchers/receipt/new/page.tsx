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
}
interface Invoice {
  id: string;
  invoiceNumber: string;
  customerId: string;
  outstandingAmount: string;
  status: string;
}

/**
 * Receipt Voucher entry — a Tally-shaped surface over the SAME CustomerReceipt
 * create path (POST /finance/ar/receipts). Allocating to an open invoice or
 * leaving it unapplied (an advance) both go through the identical DTO the
 * register page's inline form uses.
 */
export default function NewReceiptVoucherPage() {
  const router = useRouter();
  const toast = useToast();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [customerId, setCustomerId] = useState('');
  const [invoiceId, setInvoiceId] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState('');
  const [bankReference, setBankReference] = useState('');
  const [narration, setNarration] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    Promise.all([
      apiFetch<Customer[]>('/finance/ar/reference/customers'),
      apiFetch<{ items: Invoice[] }>('/finance/ar/invoices?limit=100'),
    ])
      .then(([c, i]) => {
        setCustomers(c);
        setInvoices(i.items);
      })
      .catch(() => toast.error('Failed to load customers/invoices'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openInvoices = invoices.filter(
    (i) => i.customerId === customerId && ['ISSUED', 'PARTIALLY_PAID', 'OVERDUE'].includes(i.status),
  );
  const balanced = !!customerId && !!bankReference && Number(amount) > 0;

  async function create(submit: boolean) {
    if (!balanced) {
      toast.error('Fill in the party and amount before saving.');
      return;
    }
    setSubmitting(true);
    try {
      const receipt = await apiFetch<{ id: string }>('/finance/ar/receipts', {
        method: 'POST',
        body: JSON.stringify({
          customerId,
          receiptDate: date,
          currencyCode: 'INR',
          amount: Number(amount),
          paymentMethod: 'BANK_TRANSFER',
          bankReference,
          allocations: invoiceId ? [{ invoiceId, amount: Number(amount) }] : [],
        }),
      });
      if (submit) {
        await apiFetch(`/finance/ar/receipts/${receipt.id}/submit`, { method: 'POST' });
      }
      toast.success(submit ? 'Receipt voucher submitted for approval' : 'Receipt voucher saved as draft');
      router.push('/finance/ar/receipts');
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to create receipt voucher');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <VoucherShell
      title="Receipt Voucher"
      description="Creates a Customer Receipt — allocate to an invoice or keep as an unapplied advance"
      date={date}
      onDateChange={setDate}
      narration={narration}
      onNarrationChange={setNarration}
      balanced={balanced}
      balanceLabel={balanced ? `Amount ₹${Number(amount).toFixed(2)}` : 'Fill in party and amount'}
      submitting={submitting}
      onSaveDraft={() => void create(false)}
      onSubmitForApproval={() => void create(true)}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Party (Customer)" required>
          <PartyPicker
            options={customers.map((c) => ({ id: c.id, label: c.name }))}
            value={customerId}
            onChange={(id) => {
              setCustomerId(id);
              setInvoiceId('');
            }}
            placeholder="Search customers…"
          />
        </Field>
        <Field label="Allocate to Invoice" hint="Leave unselected to record as an unapplied advance">
          <select
            className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
            value={invoiceId}
            onChange={(e) => setInvoiceId(e.target.value)}
          >
            <option value="">Unapplied advance</option>
            {openInvoices.map((i) => (
              <option key={i.id} value={i.id}>
                {i.invoiceNumber} · outstanding ₹{i.outstandingAmount}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Amount" required>
          <Input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label="Bank Reference (UTR)" required>
          <Input value={bankReference} onChange={(e) => setBankReference(e.target.value)} />
        </Field>
      </div>
    </VoucherShell>
  );
}
