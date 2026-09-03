'use client';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../../components/ui/table';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ApiError, apiFetch } from '../../../../lib/api';
import { useFinanceAccess } from '../../../../lib/use-finance-access';
import { formatINR } from '../../../../lib/sales';
import { useNumberFormat } from '../../../../lib/number-format-context';
import { Button } from '../../../../components/ui/button';
import { Input } from '../../../../components/ui/input';
import { Select } from '../../../../components/ui/select';
import {
  SCard,
  SignalHeader,
  SignalPage,
  SIGNAL_MUTED,
} from '../../../../components/ui/signal';
import { useToast } from '../../../../components/ui/toaster';
import { RegisterPagination } from '../../../../components/ui/register-pagination';
import { serverPageCount } from '../../../../lib/server-pagination';
import { uploadToPresignedUrl } from '../../../../lib/vault-api';

type Partner = { id: string; companyName: string; gstin: string | null };
type PoLine = {
  id: string;
  unitPrice: string;
  item: { name: string; baseUnitOfMeasure: string };
  grnLines: {
    id: string;
    acceptedQuantity: string;
    grn: { grnNumber: string };
  }[];
};
type Po = {
  id: string;
  poNumber: string;
  supplierId?: string;
  vendorId?: string;
  lines: PoLine[];
};
type Invoice = {
  id: string;
  internalBillNumber: string;
  externalInvoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  totalAmount: string;
  outstandingAmount: string;
  currencyCode: string;
  status: string;
  matchStatus: string;
  supplier?: Partner;
  vendor?: Partner;
  invoiceDocumentName?: string | null;
};
type ReadyHandoff = {
  id: string;
  poNumber: string;
  partyName: string;
  status: string;
  grns: {
    id: string;
    grnNumber: string;
    status: string;
    acceptedQuantity: string;
    rejectedQuantity: string;
    inspectedAt?: string;
    hasNcr: boolean;
  }[];
  invoices: (Invoice & { hasDocument: boolean })[];
};
type Page<T> = { items: T[]; total: number };
const PAGE_SIZE = 25;

export default function VendorInvoicesPage() {
  const toast = useToast();
  const { isAccountsHead } = useFinanceAccess();
  const { style: numberFormatStyle } = useNumberFormat();
  const [suppliers, setSuppliers] = useState<Partner[]>([]),
    [vendors, setVendors] = useState<Partner[]>([]),
    [pos, setPos] = useState<Po[]>([]),
    [invoices, setInvoices] = useState<Invoice[]>([]),
    [ready, setReady] = useState<ReadyHandoff[]>([]);
  const [page, setPage] = useState(1),
    [total, setTotal] = useState(0);
  const [partyType, setPartyType] = useState('SUPPLIER'),
    [partyId, setPartyId] = useState(''),
    [poId, setPoId] = useState(''),
    [poLineId, setPoLineId] = useState(''),
    [grnLineId, setGrnLineId] = useState('');
  const today = new Date().toISOString().slice(0, 10);
  const [invoiceNo, setInvoiceNo] = useState(''),
    [invoiceDate, setInvoiceDate] = useState(today),
    [dueDate, setDueDate] = useState(today),
    [description, setDescription] = useState(''),
    [quantity, setQuantity] = useState('1'),
    [price, setPrice] = useState(''),
    [cgst, setCgst] = useState('0'),
    [sgst, setSgst] = useState('0'),
    [igst, setIgst] = useState('0');
  const [invoicePdf, setInvoicePdf] = useState<File | null>(null);
  const selectedPo = pos.find((p) => p.id === poId),
    selectedLine = selectedPo?.lines.find((l) => l.id === poLineId),
    partners = partyType === 'SUPPLIER' ? suppliers : vendors,
    selectedPartner = partners.find((partner) => partner.id === partyId);
  const load = () =>
    Promise.all([
      apiFetch<{ suppliers: Partner[]; vendors: Partner[] }>(
        '/finance/ap/reference/partners',
      ),
      apiFetch<Po[]>('/finance/ap/reference/purchase-orders'),
      apiFetch<Page<Invoice>>(
        `/finance/ap/invoices?page=${page}&limit=${PAGE_SIZE}`,
      ),
      apiFetch<ReadyHandoff[]>('/finance/ap/ready-for-accounts'),
    ]).then(([p, o, i, handoffs]) => {
      setSuppliers(p.suppliers);
      setVendors(p.vendors);
      setPos(o);
      setInvoices(i.items);
      setTotal(i.total);
      setReady(handoffs);
      if (!partyId && (p.suppliers[0] || p.vendors[0])) {
        setPartyType(p.suppliers[0] ? 'SUPPLIER' : 'VENDOR');
        setPartyId((p.suppliers[0] || p.vendors[0]).id);
      }
    });
  useEffect(() => {
    load().catch((e) =>
      toast.error(e instanceof ApiError ? e.message : 'Failed to load AP'),
    );
  }, [page]); // eslint-disable-line react-hooks/exhaustive-deps
  const tax = useMemo(
    () => Number(cgst) + Number(sgst) + Number(igst),
    [cgst, sgst, igst],
  );
  function choosePo(id: string) {
    setPoId(id);
    setPoLineId('');
    setGrnLineId('');
    const po = pos.find((p) => p.id === id);
    if (po) {
      setPartyType(po.supplierId ? 'SUPPLIER' : 'VENDOR');
      setPartyId((po.supplierId || po.vendorId)!);
    }
  }
  function chooseLine(id: string) {
    setPoLineId(id);
    setGrnLineId('');
    const line = selectedPo?.lines.find((l) => l.id === id);
    if (line) {
      setDescription(line.item.name);
      setPrice(line.unitPrice);
    }
  }
  async function create(e: FormEvent) {
    e.preventDefault();
    try {
      const captured = await apiFetch<Invoice>('/finance/ap/invoices', {
        method: 'POST',
        body: JSON.stringify({
          [partyType === 'SUPPLIER' ? 'supplierId' : 'vendorId']: partyId,
          externalInvoiceNumber: invoiceNo,
          invoiceDate,
          receivedDate: today,
          dueDate,
          purchaseOrderId: poId || undefined,
          currencyCode: 'INR',
          inputCgstAmount: Number(cgst),
          inputSgstAmount: Number(sgst),
          inputIgstAmount: Number(igst),
          lines: [
            {
              description,
              quantity: Number(quantity),
              unitOfMeasure: selectedLine?.item.baseUnitOfMeasure || 'NOS',
              unitPrice: Number(price),
              taxAmount: tax,
              purchaseOrderLineId: poLineId || undefined,
              grnLineId: grnLineId || undefined,
            },
          ],
        }),
      });
      if (invoicePdf) {
        const ticket = await apiFetch<{
          storageKey: string;
          uploadUrl: string;
        }>(`/finance/ap/invoices/${captured.id}/document-upload-url`, {
          method: 'POST',
          body: JSON.stringify({
            fileName: invoicePdf.name,
            mimeType: invoicePdf.type,
            sizeBytes: invoicePdf.size,
          }),
        });
        await uploadToPresignedUrl(ticket.uploadUrl, invoicePdf);
        await apiFetch(`/finance/ap/invoices/${captured.id}/document-confirm`, {
          method: 'POST',
          body: JSON.stringify({
            storageKey: ticket.storageKey,
            fileName: invoicePdf.name,
          }),
        });
      }
      setInvoiceNo('');
      setDescription('');
      setPrice('');
      setInvoicePdf(null);
      toast.success('Vendor invoice captured and matched');
      await load();
    } catch (x) {
      toast.error(
        x instanceof ApiError ? x.message : 'Failed to create invoice',
      );
    }
  }
  async function openDocument(url: string) {
    try {
      const result = await apiFetch<{ downloadUrl: string }>(url);
      window.open(result.downloadUrl, '_blank', 'noopener,noreferrer');
    } catch (error) {
      toast.error(
        error instanceof ApiError ? error.message : 'Unable to open document',
      );
    }
  }
  async function action(id: string, a: string, body?: unknown) {
    try {
      await apiFetch(`/finance/ap/invoices/${id}/${a}`, {
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
        title="Vendor Invoice Register (AP)"
        description="Capture supplier bills, compare PO–accepted GRN–invoice, and route exceptions to the Finance Head"
        actions={
          <Link href="/finance/vouchers/purchase/new">
            <Button variant="outline">New Purchase Voucher</Button>
          </Link>
        }
      />
      <div className="space-y-4 px-5 pb-7 pt-[18px] lg:px-7">
        <SCard className="overflow-hidden">
          <div className="border-b p-5">
            <h2 className="font-semibold">Ready for Accounts</h2>
            <p className={`mt-1 text-sm ${SIGNAL_MUTED}`}>
              QC-accepted receipts with the PO, GRN, inspection report and
              vendor invoice in one payment-support view.
            </p>
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>PO / Party</TableHead>
                  <TableHead>Accepted GRNs</TableHead>
                  <TableHead>Vendor invoice</TableHead>
                  <TableHead>Documents</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ready.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">
                      {row.poNumber}
                      <br />
                      <span className={`text-xs ${SIGNAL_MUTED}`}>
                        {row.partyName}
                      </span>
                    </TableCell>
                    <TableCell>
                      {row.grns.map((g) => (
                        <div key={g.id}>
                          {g.grnNumber} · {g.acceptedQuantity} accepted
                          {Number(g.rejectedQuantity) > 0
                            ? ` · ${g.rejectedQuantity} rejected`
                            : ''}
                        </div>
                      ))}
                    </TableCell>
                    <TableCell>
                      {row.invoices.length ? (
                        row.invoices.map((i) => (
                          <div key={i.id}>
                            {i.internalBillNumber} ·{' '}
                            {i.matchStatus.replaceAll('_', ' ')}
                          </div>
                        ))
                      ) : (
                        <span className={SIGNAL_MUTED}>Not captured</span>
                      )}
                    </TableCell>
                    <TableCell className="space-x-1 whitespace-nowrap">
                      {(['po', 'grn', 'qc'] as const).map((kind) => (
                        <Button
                          key={kind}
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            openDocument(
                              `/finance/ap/ready-for-accounts/${row.id}/document/${kind}`,
                            )
                          }
                        >
                          View {kind.toUpperCase()} PDF
                        </Button>
                      ))}
                      {row.invoices.map(
                        (i) =>
                          i.hasDocument && (
                            <Button
                              key={i.id}
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                openDocument(
                                  `/finance/ap/invoices/${i.id}/document-download-url`,
                                )
                              }
                            >
                              View Invoice PDF
                            </Button>
                          ),
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {!ready.length && (
                  <TableRow>
                    <TableCell
                      colSpan={4}
                      className={`py-8 text-center ${SIGNAL_MUTED}`}
                    >
                      No QC-accepted receipts are ready for Accounts.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </SCard>
        <SCard className="p-5">
          <form onSubmit={create} className="grid gap-3 md:grid-cols-4">
            <Select value={poId} onChange={(e) => choosePo(e.target.value)}>
              <option value="">Non-PO invoice</option>
              {pos.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.poNumber}
                </option>
              ))}
            </Select>
            <Select
              value={partyType}
              disabled={!!poId}
              onChange={(e) => {
                setPartyType(e.target.value);
                setPartyId('');
              }}
            >
              <option>SUPPLIER</option>
              <option>VENDOR</option>
            </Select>
            <Select
              required
              value={partyId}
              disabled={!!poId}
              onChange={(e) => setPartyId(e.target.value)}
            >
              {partners.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.companyName}
                </option>
              ))}
            </Select>
            <Input
              readOnly
              aria-label="GSTIN from partner master"
              value={selectedPartner?.gstin ?? ''}
              placeholder="GSTIN not recorded on partner master"
              title="Automatically populated from Vendor/Supplier onboarding"
            />
            <Input
              required
              placeholder="Supplier invoice number"
              value={invoiceNo}
              onChange={(e) => setInvoiceNo(e.target.value)}
            />
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
            {selectedPo && (
              <>
                <Select
                  required
                  value={poLineId}
                  onChange={(e) => chooseLine(e.target.value)}
                >
                  <option value="">PO line</option>
                  {selectedPo.lines.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.item.name} ·{' '}
                      {formatINR(l.unitPrice, numberFormatStyle)}
                    </option>
                  ))}
                </Select>
                <Select
                  required
                  value={grnLineId}
                  onChange={(e) => setGrnLineId(e.target.value)}
                >
                  <option value="">Accepted GRN line</option>
                  {selectedLine?.grnLines.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.grn.grnNumber} · accepted {g.acceptedQuantity}
                    </option>
                  ))}
                </Select>
              </>
            )}
            <Input
              required
              placeholder="Description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
            <Input
              required
              type="number"
              step="0.0001"
              placeholder="Quantity"
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
              type="number"
              step="0.01"
              placeholder="CGST amount"
              value={cgst}
              onChange={(e) => setCgst(e.target.value)}
            />
            <Input
              type="number"
              step="0.01"
              placeholder="SGST amount"
              value={sgst}
              onChange={(e) => setSgst(e.target.value)}
            />
            <Input
              type="number"
              step="0.01"
              placeholder="IGST amount"
              value={igst}
              onChange={(e) => setIgst(e.target.value)}
            />
            <label className="text-sm">
              <span className="mb-1 block font-medium">
                Vendor invoice PDF{poId ? ' *' : ''}
              </span>
              <Input
                required={!!poId}
                type="file"
                accept="application/pdf,.pdf"
                onChange={(e) => setInvoicePdf(e.target.files?.[0] ?? null)}
              />
            </label>
            <Button type="submit">Capture invoice</Button>
          </form>
        </SCard>
        <SCard className="overflow-hidden">
          <div className="overflow-x-auto">
            <Table className="w-full text-sm">
              <TableHeader>
                <TableRow className="border-b text-left">
                  <TableHead className="p-3">Bill / Supplier ref</TableHead>
                  <TableHead>Party</TableHead>
                  <TableHead>Due</TableHead>
                  <TableHead>Total / Outstanding</TableHead>
                  <TableHead>Match</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices.map((i) => (
                  <TableRow className="border-b" key={i.id}>
                    <TableCell className="p-3 font-medium tabular-nums">
                      {i.internalBillNumber}
                      <br />
                      <span className={`text-xs ${SIGNAL_MUTED}`}>
                        {i.externalInvoiceNumber}
                      </span>
                    </TableCell>
                    <TableCell>
                      {i.supplier?.companyName || i.vendor?.companyName}
                    </TableCell>
                    <TableCell>{i.dueDate.slice(0, 10)}</TableCell>
                    <TableCell className="tabular-nums">
                      {formatINR(i.totalAmount, numberFormatStyle)}
                      <br />
                      {formatINR(i.outstandingAmount, numberFormatStyle)} open
                    </TableCell>
                    <TableCell>{i.matchStatus.replaceAll('_', ' ')}</TableCell>
                    <TableCell>{i.status.replaceAll('_', ' ')}</TableCell>
                    <TableCell className="space-x-1">
                      {i.invoiceDocumentName && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            openDocument(
                              `/finance/ap/invoices/${i.id}/document-download-url`,
                            )
                          }
                        >
                          View invoice PDF
                        </Button>
                      )}
                      {[
                        'DRAFT',
                        'PENDING_MATCH',
                        'REJECTED',
                        'MATCH_EXCEPTION',
                      ].includes(i.status) && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => action(i.id, 'submit')}
                        >
                          Submit
                        </Button>
                      )}
                      {isAccountsHead &&
                        ['PENDING_APPROVAL', 'MATCH_EXCEPTION'].includes(
                          i.status,
                        ) && (
                          <>
                            <Button
                              size="sm"
                              onClick={() =>
                                action(
                                  i.id,
                                  'approve',
                                  i.status === 'MATCH_EXCEPTION'
                                    ? {
                                        overrideReason:
                                          window.prompt(
                                            'Mandatory exception override reason',
                                          ) || '',
                                      }
                                    : {},
                                )
                              }
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
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </SCard>
        <RegisterPagination
          page={page}
          pageCount={serverPageCount(total, PAGE_SIZE)}
          onPageChange={setPage}
        />
      </div>
    </SignalPage>
  );
}
