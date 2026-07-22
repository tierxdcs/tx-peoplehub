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
interface Invoice {
  id: string;
  partyType: string;
  partyId: string;
  internalBillNumber: string;
  outstandingAmount: string;
  status: string;
}

/**
 * Payment Voucher entry — a Tally-shaped surface over the SAME
 * AccountsPayablePayment create path (POST /finance/ap/payments). Allocating
 * to an approved bill or leaving unallocated both use the identical DTO the
 * register page's inline form uses.
 */
export default function NewPaymentVoucherPage() {
  const router = useRouter();
  const toast = useToast();
  const [suppliers, setSuppliers] = useState<Partner[]>([]);
  const [vendors, setVendors] = useState<Partner[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [partyId, setPartyId] = useState('');
  const [invoiceId, setInvoiceId] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState('');
  const [narration, setNarration] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    Promise.all([
      apiFetch<{ suppliers: Partner[]; vendors: Partner[] }>('/finance/ap/reference/partners'),
      apiFetch<{ items: Invoice[] }>('/finance/ap/invoices?limit=100'),
    ])
      .then(([p, i]) => {
        setSuppliers(p.suppliers);
        setVendors(p.vendors);
        setInvoices(i.items);
      })
      .catch(() => toast.error('Failed to load vendors/bills'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isSupplier = suppliers.some((s) => s.id === partyId);
  const partyType = isSupplier ? 'SUPPLIER' : 'VENDOR';
  const openInvoices = invoices.filter(
    (i) => i.partyType === partyType && i.partyId === partyId && ['APPROVED', 'PARTIALLY_PAID'].includes(i.status),
  );
  const balanced = !!partyId && Number(amount) > 0;

  async function create(submit: boolean) {
    if (!balanced) {
      toast.error('Fill in the party and amount before saving.');
      return;
    }
    setSubmitting(true);
    try {
      const payment = await apiFetch<{ id: string }>('/finance/ap/payments', {
        method: 'POST',
        body: JSON.stringify({
          ...(isSupplier ? { supplierId: partyId } : { vendorId: partyId }),
          plannedDate: date,
          currencyCode: 'INR',
          amount: Number(amount),
          paymentMethod: 'BANK_TRANSFER',
          allocations: invoiceId ? [{ invoiceId, amount: Number(amount) }] : undefined,
        }),
      });
      if (submit) {
        await apiFetch(`/finance/ap/payments/${payment.id}/submit`, { method: 'POST' });
      }
      toast.success(submit ? 'Payment voucher submitted for approval' : 'Payment voucher saved as draft');
      router.push('/finance/ap/payments');
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to create payment voucher');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <VoucherShell
      title="Payment Voucher"
      description="Creates a Vendor Payment — allocate to an approved bill or leave unallocated"
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
        <Field label="Party (Vendor/Supplier)" required>
          <PartyPicker
            options={[
              ...suppliers.map((s) => ({ id: s.id, label: s.companyName, sublabel: 'Supplier' })),
              ...vendors.map((v) => ({ id: v.id, label: v.companyName, sublabel: 'Vendor' })),
            ]}
            value={partyId}
            onChange={(id) => {
              setPartyId(id);
              setInvoiceId('');
            }}
            placeholder="Search vendors/suppliers…"
          />
        </Field>
        <Field label="Allocate to Bill" hint="Leave unselected to record as an unallocated payment">
          <select
            className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
            value={invoiceId}
            onChange={(e) => setInvoiceId(e.target.value)}
          >
            <option value="">Unallocated</option>
            {openInvoices.map((i) => (
              <option key={i.id} value={i.id}>
                {i.internalBillNumber} · outstanding ₹{i.outstandingAmount}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Amount" required>
          <Input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
      </div>
    </VoucherShell>
  );
}
