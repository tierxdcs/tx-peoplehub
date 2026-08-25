'use client';

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../../../components/ui/table';
import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { apiFetch, ApiError } from '../../../../lib/api';
import { useFinanceAccess } from '../../../../lib/use-finance-access';
import { Button, buttonVariants } from '../../../../components/ui/button';
import { Input } from '../../../../components/ui/input';
import { Select } from '../../../../components/ui/select';
import {
  SCard,
  SIGNAL_LINK,
  SignalHeader,
  SignalPage,
} from '../../../../components/ui/signal';
import { useToast } from '../../../../components/ui/toaster';
import { formatINR } from '../../../../lib/sales';
import { useNumberFormat } from '../../../../lib/number-format-context';
import { cn } from '../../../../lib/utils';
import { RegisterPagination } from '../../../../components/ui/register-pagination';
import { serverPageCount } from '../../../../lib/server-pagination';
import { ManualIrnDialog } from './_components/manual-irn-dialog';

interface Customer {
  id: string;
  name: string;
  gstin: string | null;
}

interface Invoice {
  id: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  status: string;
  currencyCode: string;
  totalAmount: string;
  outstandingAmount: string;
  customer: { name: string };
  gstSubmissions: Array<{ id: string; status: string }>;
}

interface Page<T> {
  items: T[];
  total: number;
}

const PAGE_SIZE = 25;

export default function SalesInvoicesPage() {
  const toast = useToast();
  const { isAccountsHead } = useFinanceAccess();
  const { style: numberFormatStyle } = useNumberFormat();
  const [customers, setCustomers] = useState<Customer[]>([]),
    [invoices, setInvoices] = useState<Invoice[]>([]);
  const [page, setPage] = useState(1),
    [total, setTotal] = useState(0);
  const [manualIrnInvoiceId, setManualIrnInvoiceId] = useState<string | null>(null);
  const [customerId, setCustomerId] = useState(''),
    [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().slice(0, 10)),
    [dueDate, setDueDate] = useState(new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10));
  const [description, setDescription] = useState(''),
    [hsn, setHsn] = useState(''),
    [quantity, setQuantity] = useState('1'),
    [price, setPrice] = useState(''),
    [gstRate, setGstRate] = useState('18'),
    [state, setState] = useState('Karnataka'),
    [stateCode, setStateCode] = useState('29');

  const load = () =>
    Promise.all([
      apiFetch<Customer[]>('/finance/ar/reference/customers'),
      apiFetch<Page<Invoice>>(`/finance/ar/invoices?page=${page}&limit=${PAGE_SIZE}`),
    ]).then(([c, i]) => {
      setCustomers(c);
      setInvoices(i.items);
      setTotal(i.total);
      if (!customerId && c[0]) setCustomerId(c[0].id);
    });
  useEffect(() => {
    load().catch((e) => toast.error(e instanceof ApiError ? e.message : 'Failed to load invoices'));
  }, [page]); // eslint-disable-line react-hooks/exhaustive-deps

  async function create(e: FormEvent) {
    e.preventDefault();
    try {
      await apiFetch('/finance/ar/invoices', {
        method: 'POST',
        body: JSON.stringify({
          customerId,
          invoiceDate,
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
      setDescription('');
      setPrice('');
      toast.success('Draft invoice created');
      await load();
    } catch (x) {
      toast.error(x instanceof ApiError ? x.message : 'Failed to create invoice');
    }
  }

  async function action(id: string, a: string, body?: unknown) {
    try {
      await apiFetch(`/finance/ar/invoices/${id}/${a}`, {
        method: 'POST',
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      toast.success(`Invoice ${a} complete`);
      await load();
    } catch (x) {
      toast.error(x instanceof ApiError ? x.message : `Failed to ${a}`);
    }
  }

  return (
    <SignalPage>
      <SignalHeader
        title="Sales Vouchers"
        description="Sales invoices — order/milestone-ready, Finance Head approval, GST outbox and receivables"
        actions={
          <Link href="/finance/vouchers/sales/new">
            <Button variant="outline">New Sales Voucher</Button>
          </Link>
        }
      />
      <div className="space-y-4 px-5 pb-7 pt-[18px] lg:px-7">
        <SCard className="px-5 py-[18px]">
          <form onSubmit={create} className="grid gap-3 md:grid-cols-4">
            <Select required value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.gstin ? ' · GST' : ''}
                </option>
              ))}
            </Select>
            <Input required type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
            <Input required type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            <Input required placeholder="Description" value={description} onChange={(e) => setDescription(e.target.value)} />
            <Input required placeholder="HSN/SAC" value={hsn} onChange={(e) => setHsn(e.target.value)} />
            <Input required type="number" step="0.0001" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
            <Input required type="number" step="0.01" placeholder="Unit price" value={price} onChange={(e) => setPrice(e.target.value)} />
            <Input required type="number" step="0.01" placeholder="IGST %" value={gstRate} onChange={(e) => setGstRate(e.target.value)} />
            <Input required placeholder="Place of supply state" value={state} onChange={(e) => setState(e.target.value)} />
            <Input required maxLength={2} placeholder="State code" value={stateCode} onChange={(e) => setStateCode(e.target.value)} />
            <Button type="submit">Create draft</Button>
          </form>
        </SCard>
        <SCard className="overflow-hidden">
          <Table className="w-full text-sm">
            <TableHeader>
              <TableRow className="border-b text-left">
                <TableHead className="p-3">Invoice</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Date / Due</TableHead>
                <TableHead>Total</TableHead>
                <TableHead>Outstanding</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="min-w-[18rem]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoices.map((i) => (
                <TableRow className="border-b" key={i.id}>
                  <TableCell className="p-3 font-medium tabular-nums">
                    <Link className={SIGNAL_LINK} href={`/finance/ar/invoices/${i.id}`}>
                      {i.invoiceNumber}
                    </Link>
                  </TableCell>
                  <TableCell>{i.customer.name}</TableCell>
                  <TableCell>
                    {i.invoiceDate.slice(0, 10)} / {i.dueDate.slice(0, 10)}
                  </TableCell>
                  <TableCell className="tabular-nums">{formatINR(i.totalAmount, numberFormatStyle)}</TableCell>
                  <TableCell className="tabular-nums">{formatINR(i.outstandingAmount, numberFormatStyle)}</TableCell>
                  <TableCell>{i.status.replaceAll('_', ' ')}</TableCell>
                  <TableCell className="min-w-[18rem]">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Link className={cn(buttonVariants({ size: 'sm', variant: 'outline' }))} href={`/finance/ar/invoices/${i.id}`}>
                        View
                      </Link>
                      {(i.status === 'DRAFT' || i.status === 'REJECTED') && (
                        <Button size="sm" variant="outline" onClick={() => action(i.id, 'submit')}>
                          Submit
                        </Button>
                      )}
                      {isAccountsHead && i.status === 'PENDING_APPROVAL' && (
                        <>
                          <Button size="sm" onClick={() => action(i.id, 'approve')}>
                            Approve
                          </Button>
                          <Button size="sm" variant="destructive" onClick={() => action(i.id, 'reject', { comment: window.prompt('Reason') || '' })}>
                            Reject
                          </Button>
                        </>
                      )}
                      {isAccountsHead && i.status === 'GST_PENDING' && i.gstSubmissions[0] && (
                        <>
                          <Button
                            className="whitespace-nowrap"
                            size="sm"
                            onClick={() =>
                              apiFetch(`/finance/ar/gst-submissions/${i.gstSubmissions[0].id}/process`, { method: 'POST' })
                                .then(load)
                                .catch((e) => toast.error(e.message))
                            }
                          >
                            Generate GST e-Invoice / IRN
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => setManualIrnInvoiceId(i.id)}>
                            Enter IRN manually
                          </Button>
                        </>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </SCard>
        <RegisterPagination page={page} pageCount={serverPageCount(total, PAGE_SIZE)} onPageChange={setPage} />
        {manualIrnInvoiceId && (
          <ManualIrnDialog
            invoiceId={manualIrnInvoiceId}
            open
            onOpenChange={(next) => !next && setManualIrnInvoiceId(null)}
            onSaved={load}
          />
        )}
      </div>
    </SignalPage>
  );
}
