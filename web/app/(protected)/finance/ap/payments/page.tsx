'use client';

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../../../components/ui/table';
import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { apiFetch, ApiError } from '../../../../lib/api';
import { useFinanceAccess } from '../../../../lib/use-finance-access';
import { formatINR } from '../../../../lib/sales';
import { useNumberFormat } from '../../../../lib/number-format-context';
import { Button } from '../../../../components/ui/button';
import { Card, CardContent } from '../../../../components/ui/card';
import { Input } from '../../../../components/ui/input';
import { Select } from '../../../../components/ui/select';
import { PageContainer } from '../../../../components/ui/page-container';
import { PageHeader } from '../../../../components/ui/page-header';
import { useToast } from '../../../../components/ui/toaster';
import { RegisterPagination } from '../../../../components/ui/register-pagination';
import { serverPageCount } from '../../../../lib/server-pagination';
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
type Page<T> = { items: T[]; total: number };
const PAGE_SIZE = 25;
export default function VendorPaymentsPage() {
  const toast = useToast(),
    { isAccountsHead } = useFinanceAccess();
  const { style: numberFormatStyle } = useNumberFormat();
  const [suppliers, setSuppliers] = useState<Partner[]>([]),
    [vendors, setVendors] = useState<Partner[]>([]),
    [invoices, setInvoices] = useState<Invoice[]>([]),
    [payments, setPayments] = useState<Payment[]>([]);
  const [page, setPage] = useState(1), [total, setTotal] = useState(0);
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
      apiFetch<Page<Payment>>(`/finance/ap/payments?page=${page}&limit=${PAGE_SIZE}`),
    ]).then(([p, i, x]) => {
      setSuppliers(p.suppliers);
      setVendors(p.vendors);
      setInvoices(i.items);
      setPayments(x.items);
      setTotal(x.total);
      if (!partyId && p.suppliers[0]) setPartyId(p.suppliers[0].id);
    });
  useEffect(() => {
    load().catch((e) =>
      toast.error(
        e instanceof ApiError ? e.message : 'Failed to load payments',
      ),
    );
  }, [page]); // eslint-disable-line react-hooks/exhaustive-deps
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
                  {i.internalBillNumber} · {formatINR(i.outstandingAmount, numberFormatStyle)}
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
          <Table className="w-full text-sm">
            <TableHeader>
              <TableRow className="border-b text-left">
                <TableHead className="p-3">Payment</TableHead>
                <TableHead>Party</TableHead>
                <TableHead>Planned</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {payments.map((p) => (
                <TableRow className="border-b" key={p.id}>
                  <TableCell className="p-3 font-mono">{p.paymentNumber}</TableCell>
                  <TableCell>{p.supplier?.companyName || p.vendor?.companyName}</TableCell>
                  <TableCell>{p.plannedDate.slice(0, 10)}</TableCell>
                  <TableCell>{formatINR(p.amount, numberFormatStyle)}</TableCell>
                  <TableCell>{p.status.replaceAll('_', ' ')}</TableCell>
                  <TableCell className="space-x-1">
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
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <RegisterPagination page={page} pageCount={serverPageCount(total, PAGE_SIZE)} onPageChange={setPage} />
    </PageContainer>
  );
}
