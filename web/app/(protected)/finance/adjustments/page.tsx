'use client';
import { FormEvent, useEffect, useState } from 'react';
import { apiFetch, ApiError } from '../../../lib/api';
import { useFinanceAccess } from '../../../lib/use-finance-access';
import { Button } from '../../../components/ui/button';
import { Card, CardContent } from '../../../components/ui/card';
import { Input } from '../../../components/ui/input';
import { Select } from '../../../components/ui/select';
import { PageContainer } from '../../../components/ui/page-container';
import { PageHeader } from '../../../components/ui/page-header';
import { useToast } from '../../../components/ui/toaster';
type Invoice = {
  id: string;
  invoiceNumber?: string;
  internalBillNumber?: string;
  outstandingAmount: string;
  status: string;
  customer?: { name: string };
  supplier?: { companyName: string };
  vendor?: { companyName: string };
};
type Note = {
  id: string;
  noteNumber: string;
  side: string;
  noteType: string;
  noteDate: string;
  totalAmount: string;
  status: string;
  reason: string;
  salesInvoice?: Invoice;
  apInvoice?: Invoice;
};
type Page<T> = { items: T[] };
export default function AdjustmentsPage() {
  const toast = useToast(),
    { isAccountsHead } = useFinanceAccess();
  const [ar, setAr] = useState<Invoice[]>([]),
    [ap, setAp] = useState<Invoice[]>([]),
    [notes, setNotes] = useState<Note[]>([]);
  const [side, setSide] = useState('ACCOUNTS_RECEIVABLE'),
    [type, setType] = useState('CREDIT_NOTE'),
    [invoiceId, setInvoiceId] = useState(''),
    [reason, setReason] = useState(''),
    [taxable, setTaxable] = useState(''),
    [cgst, setCgst] = useState('0'),
    [sgst, setSgst] = useState('0'),
    [igst, setIgst] = useState('0');
  const invoices = (side === 'ACCOUNTS_RECEIVABLE' ? ar : ap).filter(
    (i) => !['DRAFT', 'REJECTED', 'PAID', 'CANCELLED'].includes(i.status),
  );
  const load = () =>
    Promise.all([
      apiFetch<Page<Invoice>>('/finance/ar/invoices?limit=100'),
      apiFetch<Page<Invoice>>('/finance/ap/invoices?limit=100'),
      apiFetch<Page<Note>>('/finance/compliance/notes?limit=100'),
    ]).then(([a, p, n]) => {
      setAr(a.items);
      setAp(p.items);
      setNotes(n.items);
    });
  useEffect(() => {
    load().catch((e) =>
      toast.error(e instanceof ApiError ? e.message : 'Failed to load notes'),
    );
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  async function create(e: FormEvent) {
    e.preventDefault();
    try {
      await apiFetch('/finance/compliance/notes', {
        method: 'POST',
        body: JSON.stringify({
          side,
          noteType: type,
          noteDate: new Date().toISOString().slice(0, 10),
          invoiceId,
          reason,
          taxableAmount: Number(taxable),
          cgstAmount: Number(cgst),
          sgstAmount: Number(sgst),
          igstAmount: Number(igst),
        }),
      });
      setReason('');
      setTaxable('');
      toast.success('Adjustment note created');
      await load();
    } catch (x) {
      toast.error(x instanceof ApiError ? x.message : 'Failed');
    }
  }
  async function action(id: string, a: string, body?: unknown) {
    try {
      await apiFetch(`/finance/compliance/notes/${id}/${a}`, {
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
      <PageHeader
        title="Credit & Debit Notes"
        description="Controlled AR/AP adjustments with GST reversal, Finance Head approval and automatic ledger posting"
      />
      <Card className="mb-6">
        <CardContent className="p-5">
          <form onSubmit={create} className="grid gap-3 md:grid-cols-4">
            <Select
              value={side}
              onChange={(e) => {
                setSide(e.target.value);
                setInvoiceId('');
              }}
            >
              <option>ACCOUNTS_RECEIVABLE</option>
              <option>ACCOUNTS_PAYABLE</option>
            </Select>
            <Select value={type} onChange={(e) => setType(e.target.value)}>
              <option>CREDIT_NOTE</option>
              <option>DEBIT_NOTE</option>
            </Select>
            <Select
              required
              value={invoiceId}
              onChange={(e) => setInvoiceId(e.target.value)}
            >
              <option value="">Select open invoice</option>
              {invoices.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.invoiceNumber || i.internalBillNumber} ·{' '}
                  {i.customer?.name ||
                    i.supplier?.companyName ||
                    i.vendor?.companyName}{' '}
                  · {i.outstandingAmount}
                </option>
              ))}
            </Select>
            <Input
              required
              placeholder="Reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <Input
              required
              type="number"
              step="0.01"
              placeholder="Taxable amount"
              value={taxable}
              onChange={(e) => setTaxable(e.target.value)}
            />
            <Input
              type="number"
              step="0.01"
              placeholder="CGST"
              value={cgst}
              onChange={(e) => setCgst(e.target.value)}
            />
            <Input
              type="number"
              step="0.01"
              placeholder="SGST"
              value={sgst}
              onChange={(e) => setSgst(e.target.value)}
            />
            <Input
              type="number"
              step="0.01"
              placeholder="IGST"
              value={igst}
              onChange={(e) => setIgst(e.target.value)}
            />
            <Button type="submit">Create note</Button>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="p-3">Note</th>
                <th>Side / Type</th>
                <th>Invoice</th>
                <th>Amount</th>
                <th>Reason</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {notes.map((n) => (
                <tr className="border-b" key={n.id}>
                  <td className="p-3 font-mono">{n.noteNumber}</td>
                  <td>
                    {n.side.replace('ACCOUNTS_', '')} /{' '}
                    {n.noteType.replace('_', ' ')}
                  </td>
                  <td>
                    {n.salesInvoice?.invoiceNumber ||
                      n.apInvoice?.internalBillNumber}
                  </td>
                  <td>₹ {n.totalAmount}</td>
                  <td>{n.reason}</td>
                  <td>{n.status}</td>
                  <td className="space-x-1">
                    {['DRAFT', 'REJECTED'].includes(n.status) && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => action(n.id, 'submit')}
                      >
                        Submit
                      </Button>
                    )}
                    {isAccountsHead && n.status === 'PENDING_APPROVAL' && (
                      <>
                        <Button
                          size="sm"
                          onClick={() => action(n.id, 'approve')}
                        >
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() =>
                            action(n.id, 'reject', {
                              comment: window.prompt('Reason') || '',
                            })
                          }
                        >
                          Reject
                        </Button>
                      </>
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
