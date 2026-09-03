'use client';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../../components/ui/table';
import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { apiFetch, ApiError } from '../../../../lib/api';
import { useFinanceAccess } from '../../../../lib/use-finance-access';
import { useAuth } from '../../../../lib/auth-context';
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
import { useConfirm } from '../../../../components/ui/confirm';
import { formatINR } from '../../../../lib/sales';
import {
  COMPANY_GST_STATE_CODE,
  DEFAULT_GST_RATE,
  GST_STATES,
  gstStateByCode,
  splitGstRate,
} from '../../../../lib/gst-states';
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
  lines: InvoiceLine[];
}

interface InvoiceLine {
  productId: string | null;
  description: string;
  hsnSacCode: string;
  quantity: string;
  unitOfMeasure: string;
  unitPrice: string;
  discountPercent: string;
  cgstRate: string;
  sgstRate: string;
  igstRate: string;
}

interface EditableInvoice extends Invoice {
  customerId: string;
  orderId: string | null;
  milestoneId: string | null;
  customerPoReference: string | null;
  exchangeRateToInr: string;
  placeOfSupplyState: string;
  placeOfSupplyStateCode: string;
  otherCharges: string;
  roundOff: string;
  paymentTerms: string | null;
}

interface Page<T> {
  items: T[];
  total: number;
}

const PAGE_SIZE = 25;

/**
 * Mirrors ArService.DELETABLE_INVOICE_STATUSES — every status before the invoice
 * is issued. Anything issued owns a posted journal entry (and usually a GST
 * IRN), so it is corrected with a credit note rather than deleted. Keeping the
 * list here means the button hides instead of the server 400ing.
 */
const DELETABLE_STATUSES = [
  'DRAFT',
  'PENDING_APPROVAL',
  'REJECTED',
  'GST_PENDING',
  'CANCELLED',
];

export default function SalesInvoicesPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const { isAccountsHead } = useFinanceAccess();
  const { user } = useAuth();
  const { style: numberFormatStyle } = useNumberFormat();
  const [customers, setCustomers] = useState<Customer[]>([]),
    [invoices, setInvoices] = useState<Invoice[]>([]);
  const [page, setPage] = useState(1),
    [total, setTotal] = useState(0);
  const [manualIrnInvoiceId, setManualIrnInvoiceId] = useState<string | null>(
    null,
  );
  const [editing, setEditing] = useState<EditableInvoice | null>(null);
  const [customerId, setCustomerId] = useState(''),
    [invoiceDate, setInvoiceDate] = useState(
      new Date().toISOString().slice(0, 10),
    ),
    [dueDate, setDueDate] = useState(
      new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
    );
  const [description, setDescription] = useState(''),
    [hsn, setHsn] = useState(''),
    [quantity, setQuantity] = useState('1'),
    [price, setPrice] = useState(''),
    // One total GST rate; the place of supply decides whether it lands on IGST
    // (inter-state) or is halved into CGST + SGST (intra-state).
    [gstRate, setGstRate] = useState(String(DEFAULT_GST_RATE)),
    [stateCode, setStateCode] = useState(COMPANY_GST_STATE_CODE);
  const state = gstStateByCode(stateCode)?.name ?? '';

  const load = () =>
    Promise.all([
      apiFetch<Customer[]>('/finance/ar/reference/customers'),
      apiFetch<Page<Invoice>>(
        `/finance/ar/invoices?page=${page}&limit=${PAGE_SIZE}`,
      ),
    ]).then(([c, i]) => {
      setCustomers(c);
      setInvoices(i.items);
      setTotal(i.total);
      if (!customerId && c[0]) setCustomerId(c[0].id);
    });
  useEffect(() => {
    load().catch((e) =>
      toast.error(
        e instanceof ApiError ? e.message : 'Failed to load invoices',
      ),
    );
  }, [page]); // eslint-disable-line react-hooks/exhaustive-deps

  function resetEditor() {
    setEditing(null);
    setDescription('');
    setHsn('');
    setQuantity('1');
    setPrice('');
    setGstRate(String(DEFAULT_GST_RATE));
    setStateCode(COMPANY_GST_STATE_CODE);
  }

  async function startEditing(invoice: Invoice) {
    try {
      const detail = await apiFetch<EditableInvoice>(
        `/finance/ar/invoices/${invoice.id}`,
      );
      const line = detail.lines[0];
      if (!line) throw new Error('Voucher has no line items');
      setEditing(detail);
      setCustomerId(detail.customerId);
      setInvoiceDate(detail.invoiceDate.slice(0, 10));
      setDueDate(detail.dueDate.slice(0, 10));
      setDescription(line.description);
      setHsn(line.hsnSacCode);
      setQuantity(String(line.quantity));
      setPrice(String(line.unitPrice));
      setGstRate(
        String(
          Number(line.igstRate) + Number(line.cgstRate) + Number(line.sgstRate),
        ),
      );
      setStateCode(detail.placeOfSupplyStateCode);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (x) {
      toast.error(x instanceof ApiError ? x.message : 'Failed to open voucher');
    }
  }

  async function create(e: FormEvent) {
    e.preventDefault();
    try {
      const gst = splitGstRate(Number(gstRate), stateCode);
      const editableLine = (line: InvoiceLine) => ({
        productId: line.productId ?? undefined,
        description: line.description,
        hsnSacCode: line.hsnSacCode,
        quantity: Number(line.quantity),
        unitOfMeasure: line.unitOfMeasure,
        unitPrice: Number(line.unitPrice),
        discountPercent: Number(line.discountPercent),
        cgstRate: Number(line.cgstRate),
        sgstRate: Number(line.sgstRate),
        igstRate: Number(line.igstRate),
      });
      const primaryLine = {
        ...(editing?.lines[0] ? editableLine(editing.lines[0]) : {}),
        description,
        hsnSacCode: hsn,
        quantity: Number(quantity),
        unitOfMeasure: editing?.lines[0]?.unitOfMeasure ?? 'NOS',
        unitPrice: Number(price),
        ...gst,
      };
      await apiFetch(
        editing ? `/finance/ar/invoices/${editing.id}` : '/finance/ar/invoices',
        {
          method: editing ? 'PUT' : 'POST',
          body: JSON.stringify({
            customerId,
            orderId: editing?.orderId ?? undefined,
            milestoneId: editing?.milestoneId ?? undefined,
            invoiceDate,
            dueDate,
            customerPoReference: editing?.customerPoReference ?? undefined,
            currencyCode: editing?.currencyCode ?? 'INR',
            exchangeRateToInr: editing
              ? Number(editing.exchangeRateToInr)
              : undefined,
            placeOfSupplyState: state,
            placeOfSupplyStateCode: stateCode,
            otherCharges: editing ? Number(editing.otherCharges) : undefined,
            roundOff: editing ? Number(editing.roundOff) : undefined,
            paymentTerms: editing?.paymentTerms ?? undefined,
            lines: editing
              ? [primaryLine, ...editing.lines.slice(1).map(editableLine)]
              : [primaryLine],
          }),
        },
      );
      toast.success(
        editing ? 'Draft sales voucher updated' : 'Draft invoice created',
      );
      resetEditor();
      await load();
    } catch (x) {
      toast.error(x instanceof ApiError ? x.message : 'Failed to save invoice');
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

  async function remove(i: Invoice) {
    const issued = i.status === 'ISSUED';
    const ok = await confirm({
      title: `Delete ${i.invoiceNumber}?`,
      description: issued
        ? `CEO override: this permanently deletes the issued voucher and its posted General Ledger journal. It is allowed only when no GST document, receipt, adjustment note, or closed period depends on it. ${i.invoiceNumber} will not be reissued. This cannot be undone.`
        : `This permanently deletes the voucher and its lines. It was never issued, so there is nothing to reverse in the ledger — but ${i.invoiceNumber} will not be reissued, leaving a gap in the number series. This cannot be undone.`,
      confirmLabel: 'Delete voucher',
      destructive: true,
    });
    if (!ok) return;
    try {
      const result = await apiFetch<{
        unlinkedChallanNumber: string | null;
        removedJournalNumber: string | null;
      }>(`/finance/ar/invoices/${i.id}`, { method: 'DELETE' });
      toast.success(
        result.unlinkedChallanNumber
          ? `${i.invoiceNumber} deleted — delivery challan ${result.unlinkedChallanNumber} no longer has a linked invoice`
          : `${i.invoiceNumber} deleted`,
      );
      // Deleting the last row on a page would otherwise leave the register on an
      // empty page, so step back instead of reloading into nothing.
      if (invoices.length === 1 && page > 1) setPage(page - 1);
      else await load();
    } catch (x) {
      toast.error(
        x instanceof ApiError ? x.message : 'Failed to delete invoice',
      );
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
          {editing && (
            <div className="mb-4 flex items-center justify-between gap-3 rounded-md border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-sm">
              <span>
                Editing <strong>{editing.invoiceNumber}</strong>. Only draft
                vouchers can be changed.
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={resetEditor}
              >
                Cancel edit
              </Button>
            </div>
          )}
          <form onSubmit={create} className="grid gap-3 md:grid-cols-4">
            <Select
              required
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
            >
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.gstin ? ' · GST' : ''}
                </option>
              ))}
            </Select>
            <Input
              required
              type="date"
              value={invoiceDate}
              onChange={(e) => setInvoiceDate(e.target.value)}
            />
            <Input
              required
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
            <Input
              required
              placeholder="Description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
            <Input
              required
              placeholder="HSN/SAC"
              value={hsn}
              onChange={(e) => setHsn(e.target.value)}
            />
            <Input
              required
              type="number"
              step="0.0001"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
            <Input
              required
              type="number"
              step="0.01"
              placeholder="Unit price"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
            />
            <Input
              required
              type="number"
              step="0.01"
              placeholder="GST %"
              title="Total GST — split into CGST+SGST or IGST by the place of supply"
              value={gstRate}
              onChange={(e) => setGstRate(e.target.value)}
            />
            <Select
              required
              aria-label="Place of supply state"
              value={stateCode}
              onChange={(e) => setStateCode(e.target.value)}
            >
              {GST_STATES.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.name}
                </option>
              ))}
            </Select>
            <Input
              readOnly
              aria-label="State code"
              title={`GST state code for ${state}`}
              className="tabular-nums"
              value={stateCode}
            />
            <Button type="submit">
              {editing ? 'Save changes' : 'Create draft'}
            </Button>
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
                    <Link
                      className={SIGNAL_LINK}
                      href={`/finance/ar/invoices/${i.id}`}
                    >
                      {i.invoiceNumber}
                    </Link>
                  </TableCell>
                  <TableCell>{i.customer.name}</TableCell>
                  <TableCell>
                    {i.invoiceDate.slice(0, 10)} / {i.dueDate.slice(0, 10)}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {formatINR(i.totalAmount, numberFormatStyle)}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {formatINR(i.outstandingAmount, numberFormatStyle)}
                  </TableCell>
                  <TableCell>{i.status.replaceAll('_', ' ')}</TableCell>
                  <TableCell className="min-w-[18rem]">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Link
                        className={cn(
                          buttonVariants({ size: 'sm', variant: 'outline' }),
                        )}
                        href={`/finance/ar/invoices/${i.id}`}
                      >
                        View
                      </Link>
                      {i.status === 'DRAFT' && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => startEditing(i)}
                        >
                          Edit
                        </Button>
                      )}
                      {(i.status === 'DRAFT' || i.status === 'REJECTED') && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => action(i.id, 'submit')}
                        >
                          Submit
                        </Button>
                      )}
                      {isAccountsHead && i.status === 'PENDING_APPROVAL' && (
                        <>
                          <Button
                            size="sm"
                            onClick={() => action(i.id, 'approve')}
                          >
                            Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() =>
                              action(i.id, 'reject', {
                                comment: window.prompt('Reason') || '',
                              })
                            }
                          >
                            Reject
                          </Button>
                        </>
                      )}
                      {isAccountsHead &&
                        i.status === 'GST_PENDING' &&
                        i.gstSubmissions[0] && (
                          <>
                            <Button
                              className="whitespace-nowrap"
                              size="sm"
                              onClick={() =>
                                apiFetch(
                                  `/finance/ar/gst-submissions/${i.gstSubmissions[0].id}/process`,
                                  { method: 'POST' },
                                )
                                  .then(load)
                                  .catch((e) => toast.error(e.message))
                              }
                            >
                              Generate GST e-Invoice / IRN
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setManualIrnInvoiceId(i.id)}
                            >
                              Enter IRN manually
                            </Button>
                          </>
                        )}
                      {(DELETABLE_STATUSES.includes(i.status) ||
                        (user?.role === 'SUPER_ADMIN' &&
                          i.status === 'ISSUED')) && (
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => remove(i)}
                        >
                          Delete
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </SCard>
        <RegisterPagination
          page={page}
          pageCount={serverPageCount(total, PAGE_SIZE)}
          onPageChange={setPage}
        />
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
