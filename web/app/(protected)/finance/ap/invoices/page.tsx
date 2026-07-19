'use client';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { ApiError, apiFetch } from '../../../../lib/api';
import { useFinanceAccess } from '../../../../lib/use-finance-access';
import { Button } from '../../../../components/ui/button';
import { Card, CardContent } from '../../../../components/ui/card';
import { Input } from '../../../../components/ui/input';
import { Select } from '../../../../components/ui/select';
import { PageContainer } from '../../../../components/ui/page-container';
import { PageHeader } from '../../../../components/ui/page-header';
import { useToast } from '../../../../components/ui/toaster';

type Partner = { id: string; companyName: string };
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
};
type Page<T> = { items: T[] };

export default function VendorInvoicesPage() {
  const toast = useToast();
  const { isAccountsHead } = useFinanceAccess();
  const [suppliers, setSuppliers] = useState<Partner[]>([]),
    [vendors, setVendors] = useState<Partner[]>([]),
    [pos, setPos] = useState<Po[]>([]),
    [invoices, setInvoices] = useState<Invoice[]>([]);
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
  const selectedPo = pos.find((p) => p.id === poId),
    selectedLine = selectedPo?.lines.find((l) => l.id === poLineId),
    partners = partyType === 'SUPPLIER' ? suppliers : vendors;
  const load = () =>
    Promise.all([
      apiFetch<{ suppliers: Partner[]; vendors: Partner[] }>(
        '/finance/ap/reference/partners',
      ),
      apiFetch<Po[]>('/finance/ap/reference/purchase-orders'),
      apiFetch<Page<Invoice>>('/finance/ap/invoices?limit=100'),
    ]).then(([p, o, i]) => {
      setSuppliers(p.suppliers);
      setVendors(p.vendors);
      setPos(o);
      setInvoices(i.items);
      if (!partyId && (p.suppliers[0] || p.vendors[0])) {
        setPartyType(p.suppliers[0] ? 'SUPPLIER' : 'VENDOR');
        setPartyId((p.suppliers[0] || p.vendors[0]).id);
      }
    });
  useEffect(() => {
    load().catch((e) =>
      toast.error(e instanceof ApiError ? e.message : 'Failed to load AP'),
    );
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
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
      await apiFetch('/finance/ap/invoices', {
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
      setInvoiceNo('');
      setDescription('');
      setPrice('');
      toast.success('Vendor invoice captured and matched');
      await load();
    } catch (x) {
      toast.error(
        x instanceof ApiError ? x.message : 'Failed to create invoice',
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
    <PageContainer>
      <PageHeader
        title="Vendor Invoice Register (AP)"
        description="Capture supplier bills, compare PO–accepted GRN–invoice, and route exceptions to the Finance Head"
      />
      <Card className="mb-6">
        <CardContent className="p-5">
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
                      {l.item.name} · ₹{l.unitPrice}
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
            <Button type="submit">Capture invoice</Button>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="p-3">Bill / Supplier ref</th>
                <th>Party</th>
                <th>Due</th>
                <th>Total / Outstanding</th>
                <th>Match</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((i) => (
                <tr className="border-b" key={i.id}>
                  <td className="p-3 font-mono">
                    {i.internalBillNumber}
                    <br />
                    <span className="text-xs">{i.externalInvoiceNumber}</span>
                  </td>
                  <td>{i.supplier?.companyName || i.vendor?.companyName}</td>
                  <td>{i.dueDate.slice(0, 10)}</td>
                  <td>
                    {i.currencyCode} {i.totalAmount}
                    <br />
                    {i.outstandingAmount} open
                  </td>
                  <td>{i.matchStatus.replaceAll('_', ' ')}</td>
                  <td>{i.status.replaceAll('_', ' ')}</td>
                  <td className="space-x-1">
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
