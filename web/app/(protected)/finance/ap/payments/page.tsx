'use client';
import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { apiFetch, ApiError } from '../../../../lib/api';
import { useFinanceAccess } from '../../../../lib/use-finance-access';
import { Button } from '../../../../components/ui/button';
import { Card, CardContent } from '../../../../components/ui/card';
import { Input } from '../../../../components/ui/input';
import { Select } from '../../../../components/ui/select';
import { PageContainer } from '../../../../components/ui/page-container';
import { PageHeader } from '../../../../components/ui/page-header';
import { useToast } from '../../../../components/ui/toaster';
type Partner = { id: string; companyName: string };
type Invoice = {
  id: string;
  partyType: string;
  partyId: string;
  internalBillNumber: string;
  outstandingAmount: string;
  status: string;
};
type Payment = {
  id: string;
  paymentNumber: string;
  plannedDate: string;
  amount: string;
  status: string;
  supplier?: Partner;
  vendor?: Partner;
};
type Page<T> = { items: T[] };
export default function VendorPaymentsPage() {
  const toast = useToast(),
    { isAccountsHead } = useFinanceAccess();
  const [suppliers, setSuppliers] = useState<Partner[]>([]),
    [vendors, setVendors] = useState<Partner[]>([]),
    [invoices, setInvoices] = useState<Invoice[]>([]),
    [payments, setPayments] = useState<Payment[]>([]);
  const [type, setType] = useState('SUPPLIER'),
    [partyId, setPartyId] = useState(''),
    [invoiceId, setInvoiceId] = useState(''),
    [amount, setAmount] = useState(''),
    [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const partners = type === 'SUPPLIER' ? suppliers : vendors,
    open = invoices.filter(
      (i) =>
        i.partyType === type &&
        i.partyId === partyId &&
        ['APPROVED', 'PARTIALLY_PAID'].includes(i.status),
    );
  const load = () =>
    Promise.all([
      apiFetch<{ suppliers: Partner[]; vendors: Partner[] }>(
        '/finance/ap/reference/partners',
      ),
      apiFetch<Page<Invoice>>('/finance/ap/invoices?limit=100'),
      apiFetch<Page<Payment>>('/finance/ap/payments?limit=100'),
    ]).then(([p, i, x]) => {
      setSuppliers(p.suppliers);
      setVendors(p.vendors);
      setInvoices(i.items);
      setPayments(x.items);
      if (!partyId && p.suppliers[0]) setPartyId(p.suppliers[0].id);
    });
  useEffect(() => {
    load().catch((e) =>
      toast.error(
        e instanceof ApiError ? e.message : 'Failed to load payments',
      ),
    );
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  async function create(e: FormEvent) {
    e.preventDefault();
    try {
      await apiFetch('/finance/ap/payments', {
        method: 'POST',
        body: JSON.stringify({
          [type === 'SUPPLIER' ? 'supplierId' : 'vendorId']: partyId,
          plannedDate: date,
          currencyCode: 'INR',
          amount: Number(amount),
          paymentMethod: 'BANK_TRANSFER',
          allocations: invoiceId ? [{ invoiceId, amount: Number(amount) }] : [],
        }),
      });
      setAmount('');
      toast.success('Payment proposal created');
      await load();
    } catch (x) {
      toast.error(x instanceof ApiError ? x.message : 'Failed');
    }
  }
  async function action(id: string, a: string, body?: unknown) {
    try {
      await apiFetch(`/finance/ap/payments/${id}/${a}`, {
        method: 'POST',
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      await load();
    } catch (x) {
      toast.error(x instanceof ApiError ? x.message : 'Failed');
    }
  }
  return (
    <PageContainer>
      <div className="mb-1 flex items-center justify-between">
        <PageHeader
          title="Vendor Payments"
          description="Plan, approve and record vendor payments; unallocated amounts remain supplier advances"
        />
        <Link href="/finance/vouchers/payment/new">
          <Button variant="outline">New Payment Voucher</Button>
        </Link>
      </div>
      <Card className="mb-6">
        <CardContent className="p-5">
          <form onSubmit={create} className="grid gap-3 md:grid-cols-6">
            <Select
              value={type}
              onChange={(e) => {
                setType(e.target.value);
                setPartyId('');
                setInvoiceId('');
              }}
            >
              <option>SUPPLIER</option>
              <option>VENDOR</option>
            </Select>
            <Select
              required
              value={partyId}
              onChange={(e) => {
                setPartyId(e.target.value);
                setInvoiceId('');
              }}
            >
              {partners.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.companyName}
                </option>
              ))}
            </Select>
            <Select
              value={invoiceId}
              onChange={(e) => {
                setInvoiceId(e.target.value);
                const i = open.find((x) => x.id === e.target.value);
                if (i) setAmount(i.outstandingAmount);
              }}
            >
              <option value="">Unallocated advance</option>
              {open.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.internalBillNumber} · {i.outstandingAmount}
                </option>
              ))}
            </Select>
            <Input
              required
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
            <Input
              required
              type="number"
              step="0.01"
              placeholder="Amount"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            <Button type="submit">Plan payment</Button>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="p-3">Payment</th>
                <th>Party</th>
                <th>Planned</th>
                <th>Amount</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr className="border-b" key={p.id}>
                  <td className="p-3 font-mono">{p.paymentNumber}</td>
                  <td>{p.supplier?.companyName || p.vendor?.companyName}</td>
                  <td>{p.plannedDate.slice(0, 10)}</td>
                  <td>INR {p.amount}</td>
                  <td>{p.status.replaceAll('_', ' ')}</td>
                  <td className="space-x-1">
                    {['DRAFT', 'REJECTED'].includes(p.status) && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => action(p.id, 'submit')}
                      >
                        Submit
                      </Button>
                    )}
                    {isAccountsHead && p.status === 'PENDING_APPROVAL' && (
                      <>
                        <Button
                          size="sm"
                          onClick={() => action(p.id, 'approve')}
                        >
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() =>
                            action(p.id, 'reject', {
                              comment: window.prompt('Reason') || '',
                            })
                          }
                        >
                          Reject
                        </Button>
                      </>
                    )}
                    {p.status === 'APPROVED' && (
                      <Button
                        size="sm"
                        onClick={() =>
                          action(p.id, 'execute', {
                            executedDate: new Date().toISOString().slice(0, 10),
                            bankReference:
                              window.prompt('UTR / bank reference') || '',
                          })
                        }
                      >
                        Record paid
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </PageContainer>
  );
}
