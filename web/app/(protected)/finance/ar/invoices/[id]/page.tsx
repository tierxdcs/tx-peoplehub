'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { apiFetch, ApiError } from '../../../../../lib/api';
import { useFinanceAccess } from '../../../../../lib/use-finance-access';
import { formatINR } from '../../../../../lib/sales';
import { useNumberFormat } from '../../../../../lib/number-format-context';
import { Button } from '../../../../../components/ui/button';
import {
  SCard,
  SCardTitle,
  SignalHeader,
  SignalPage,
} from '../../../../../components/ui/signal';
import { Spinner } from '../../../../../components/ui/spinner';
import { StatusBadge } from '../../../../../components/ui/status-badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../../../components/ui/table';
import { useToast } from '../../../../../components/ui/toaster';
import { SalesInvoicePrintDocument } from '../_components/sales-invoice-print-document';

interface Person {
  firstName: string;
  lastName: string;
  employeeId: string;
}

interface InvoiceLine {
  id: string;
  sequence: number;
  description: string;
  hsnSacCode: string;
  quantity: string;
  unitOfMeasure: string;
  unitPrice: string;
  discountPercent: string;
  taxableAmount: string;
  cgstRate: string;
  cgstAmount: string;
  sgstRate: string;
  sgstAmount: string;
  igstRate: string;
  igstAmount: string;
  lineTotal: string;
  product: { name: string; sku: string } | null;
}

interface InvoiceDetail {
  id: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  status: string;
  currencyCode: string;
  exchangeRateToInr: string;
  customerPoReference: string | null;
  customerGstinSnapshot: string | null;
  placeOfSupplyState: string;
  placeOfSupplyStateCode: string;
  billingAddressSnapshot: unknown;
  shippingAddressSnapshot: unknown;
  subtotal: string;
  discountAmount: string;
  taxableAmount: string;
  cgstAmount: string;
  sgstAmount: string;
  igstAmount: string;
  otherCharges: string;
  roundOff: string;
  totalAmount: string;
  paidAmount: string;
  outstandingAmount: string;
  paymentTerms: string | null;
  rejectionComment: string | null;
  submittedAt: string | null;
  approvedAt: string | null;
  issuedAt: string | null;
  irn: string | null;
  eWayBillNumber: string | null;
  customer: { name: string };
  order: { orderNumber: string } | null;
  milestone: { name?: string; title?: string } | null;
  createdBy: Person;
  submittedBy: Person | null;
  approvedBy: Person | null;
  lines: InvoiceLine[];
  gstSubmissions: Array<{ id: string; status: string; createdAt: string }>;
}

function personName(person: Person | null): string {
  return person
    ? `${person.firstName} ${person.lastName} · ${person.employeeId}`
    : '—';
}

function dateTime(value: string | null): string {
  return value ? new Date(value).toLocaleString() : '—';
}

function addressText(value: unknown): string {
  if (!value) return '—';
  if (typeof value === 'string') return value;
  if (typeof value !== 'object') return String(value);
  return (
    Object.values(value as Record<string, unknown>)
      .filter((part) => part != null && String(part).trim())
      .map(String)
      .join(', ') || '—'
  );
}

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 text-sm">{value || '—'}</div>
    </div>
  );
}

export default function SalesInvoiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const { isAccountsHead } = useFinanceAccess();
  const { style } = useNumberFormat();
  const [invoice, setInvoice] = useState<InvoiceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);

  const load = async () => {
    try {
      setInvoice(await apiFetch<InvoiceDetail>(`/finance/ar/invoices/${id}`));
    } catch (error) {
      toast.error(
        error instanceof ApiError
          ? error.message
          : 'Failed to load sales invoice',
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function action(name: 'approve' | 'reject') {
    if (!invoice || acting) return;
    const comment =
      name === 'reject' ? window.prompt('Reason for rejection') : null;
    if (name === 'reject' && !comment?.trim()) return;
    setActing(true);
    try {
      await apiFetch(`/finance/ar/invoices/${invoice.id}/${name}`, {
        method: 'POST',
        ...(comment ? { body: JSON.stringify({ comment }) } : {}),
      });
      toast.success(`Invoice ${name} complete`);
      await load();
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof ApiError ? error.message : `Failed to ${name} invoice`,
      );
    } finally {
      setActing(false);
    }
  }

  function downloadPdf() {
    const previousTitle = document.title;
    document.title = `Sales Invoice ${invoice?.invoiceNumber ?? ''}`;
    const restoreTitle = () => {
      document.title = previousTitle;
      window.removeEventListener('afterprint', restoreTitle);
    };
    window.addEventListener('afterprint', restoreTitle);
    window.print();
    setTimeout(restoreTitle, 1000);
  }

  if (loading)
    return (
      <SignalPage>
        <div className="flex min-h-64 items-center justify-center">
          <Spinner />
        </div>
      </SignalPage>
    );
  if (!invoice)
    return (
      <SignalPage>
        <div className="px-5 pb-7 pt-[18px] lg:px-7">
          <p>Sales invoice could not be loaded.</p>
        </div>
      </SignalPage>
    );

  return (
    <>
      <SalesInvoicePrintDocument
        generatedOn={new Date().toISOString().slice(0, 10)}
        invoice={invoice}
      />
      <SignalPage>
        <SignalHeader
          backHref="/finance/ar/invoices"
          backLabel="Sales Invoices"
          title={invoice.invoiceNumber}
          description={`Sales invoice for ${invoice.customer.name}`}
          chip={<StatusBadge value={invoice.status} />}
          actions={
            <>
              <Button variant="outline" onClick={downloadPdf}>
                <Download /> Download PDF
              </Button>
              {isAccountsHead && invoice.status === 'PENDING_APPROVAL' && (
                <>
                  <Button disabled={acting} onClick={() => action('approve')}>
                    Approve
                  </Button>
                  <Button
                    disabled={acting}
                    variant="destructive"
                    onClick={() => action('reject')}
                  >
                    Reject
                  </Button>
                </>
              )}
            </>
          }
        />
        <div className="space-y-4 px-5 pb-7 pt-[18px] lg:px-7">
          <SCard className="px-5 py-[18px]">
            <SCardTitle title="Invoice details" />
            <div className="mt-4 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              <Detail label="Customer" value={invoice.customer.name} />
              <Detail
                label="Customer GSTIN"
                value={invoice.customerGstinSnapshot}
              />
              <Detail
                label="Invoice date"
                value={invoice.invoiceDate.slice(0, 10)}
              />
              <Detail label="Due date" value={invoice.dueDate.slice(0, 10)} />
              <Detail label="Order" value={invoice.order?.orderNumber} />
              <Detail
                label="Customer PO reference"
                value={invoice.customerPoReference}
              />
              <Detail
                label="Place of supply"
                value={`${invoice.placeOfSupplyState} (${invoice.placeOfSupplyStateCode})`}
              />
              <Detail
                label="Currency"
                value={`${invoice.currencyCode} · rate ${invoice.exchangeRateToInr}`}
              />
              <Detail label="Payment terms" value={invoice.paymentTerms} />
              <Detail
                label="Billing address"
                value={addressText(invoice.billingAddressSnapshot)}
              />
              <Detail
                label="Shipping address"
                value={addressText(invoice.shippingAddressSnapshot)}
              />
              {invoice.rejectionComment && (
                <Detail
                  label="Rejection reason"
                  value={invoice.rejectionComment}
                />
              )}
            </div>
          </SCard>

          <SCard className="overflow-hidden">
            <div className="px-5 pb-3.5 pt-[18px]">
              <SCardTitle title="Line items" />
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-6">Item</TableHead>
                  <TableHead>HSN/SAC</TableHead>
                  <TableHead>Qty</TableHead>
                  <TableHead>Unit price</TableHead>
                  <TableHead>Taxable</TableHead>
                  <TableHead>GST</TableHead>
                  <TableHead className="pr-6 text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoice.lines.map((line) => (
                  <TableRow key={line.id}>
                    <TableCell className="pl-6">
                      <div className="font-medium">{line.description}</div>
                      {line.product && (
                        <div className="text-xs text-muted-foreground">
                          {line.product.sku} · {line.product.name}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>{line.hsnSacCode}</TableCell>
                    <TableCell className="tabular-nums">
                      {line.quantity} {line.unitOfMeasure}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {formatINR(line.unitPrice, style)}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {formatINR(line.taxableAmount, style)}
                    </TableCell>
                    <TableCell className="text-xs">
                      CGST {line.cgstRate}% · SGST {line.sgstRate}% · IGST{' '}
                      {line.igstRate}%
                    </TableCell>
                    <TableCell className="pr-6 text-right font-medium tabular-nums">
                      {formatINR(line.lineTotal, style)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </SCard>

          <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
            <SCard className="px-5 py-[18px]">
              <SCardTitle title="Approval and GST trail" />
              <div className="mt-4 grid gap-5 sm:grid-cols-2">
                <Detail
                  label="Created by"
                  value={personName(invoice.createdBy)}
                />
                <Detail
                  label="Submitted by"
                  value={personName(invoice.submittedBy)}
                />
                <Detail
                  label="Submitted at"
                  value={dateTime(invoice.submittedAt)}
                />
                <Detail
                  label="Approved by"
                  value={personName(invoice.approvedBy)}
                />
                <Detail
                  label="Approved at"
                  value={dateTime(invoice.approvedAt)}
                />
                <Detail label="Issued at" value={dateTime(invoice.issuedAt)} />
                <Detail label="IRN" value={invoice.irn} />
                <Detail label="E-way bill" value={invoice.eWayBillNumber} />
                <Detail
                  label="Latest GST submission"
                  value={invoice.gstSubmissions[0]?.status}
                />
              </div>
            </SCard>
            <SCard className="px-5 py-[18px]">
              <SCardTitle title="Amount summary" />
              <div className="mt-4 space-y-3 text-sm">
                {[
                  ['Subtotal', invoice.subtotal],
                  ['Discount', invoice.discountAmount],
                  ['Taxable amount', invoice.taxableAmount],
                  ['CGST', invoice.cgstAmount],
                  ['SGST', invoice.sgstAmount],
                  ['IGST', invoice.igstAmount],
                  ['Other charges', invoice.otherCharges],
                  ['Round off', invoice.roundOff],
                ].map(([label, value]) => (
                  <div className="flex justify-between" key={label}>
                    <span className="text-muted-foreground">{label}</span>
                    <span className="tabular-nums">
                      {formatINR(value, style)}
                    </span>
                  </div>
                ))}
                <div className="flex justify-between border-t pt-3 text-base font-semibold">
                  <span>Total</span>
                  <span className="tabular-nums">
                    {formatINR(invoice.totalAmount, style)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Paid</span>
                  <span className="tabular-nums">
                    {formatINR(invoice.paidAmount, style)}
                  </span>
                </div>
                <div className="flex justify-between text-base font-semibold">
                  <span>Outstanding</span>
                  <span className="tabular-nums">
                    {formatINR(invoice.outstandingAmount, style)}
                  </span>
                </div>
              </div>
            </SCard>
          </div>
        </div>
      </SignalPage>
    </>
  );
}
