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
type Gst = {
  invoiceId: string;
  internalBillNumber: string;
  supplierInvoiceNumber: string;
  invoiceDate: string;
  partyName: string;
  gstin?: string;
  taxableAmount: string;
  cgst: string;
  sgst: string;
  igst: string;
  total: string;
  itcStatus: string;
};
type Aging = {
  invoiceId: string;
  billNumber: string;
  partyName: string;
  dueDate: string;
  daysOverdue: number;
  outstanding: string;
  bucket: string;
  onHold: boolean;
};
type Forecast = {
  weekStarting: string;
  expectedCollections: string;
  duePayables: string;
  plannedPayments: string;
  netCash: string;
};
type Tds = {
  id: string;
  sectionCode: string;
  description: string;
  ratePercent: string;
  thresholdInr: string;
  isActive: boolean;
};
export default function CompliancePage() {
  const toast = useToast(),
    { isAccountsHead } = useFinanceAccess();
  const now = new Date(),
    fy = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  const [from, setFrom] = useState(`${fy}-04-01`),
    [to, setTo] = useState(now.toISOString().slice(0, 10)),
    [gst, setGst] = useState<Gst[]>([]),
    [aging, setAging] = useState<Aging[]>([]),
    [forecast, setForecast] = useState<Forecast[]>([]),
    [tds, setTds] = useState<Tds[]>([]);
  const [section, setSection] = useState('194C'),
    [description, setDescription] = useState('Payment to contractor'),
    [rate, setRate] = useState('2'),
    [threshold, setThreshold] = useState('30000');
  const load = () =>
    Promise.all([
      apiFetch<Gst[]>(
        `/finance/compliance/gst-purchase-register?from=${from}&to=${to}`,
      ),
      apiFetch<Aging[]>(`/finance/compliance/ap-aging?asOf=${to}`),
      apiFetch<Forecast[]>(
        `/finance/compliance/cash-forecast?from=${from}&to=${to}`,
      ),
      apiFetch<Tds[]>('/finance/compliance/tds-sections'),
    ]).then(([g, a, f, t]) => {
      setGst(g);
      setAging(a);
      setForecast(f);
      setTds(t);
    });
  useEffect(() => {
    load().catch((e) =>
      toast.error(
        e instanceof ApiError ? e.message : 'Failed to load compliance reports',
      ),
    );
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  async function itc(id: string, status: string) {
    const note =
      status === 'MISMATCHED' ? window.prompt('Mismatch reason') || '' : '';
    try {
      await apiFetch(`/finance/compliance/ap-invoices/${id}/itc`, {
        method: 'PATCH',
        body: JSON.stringify({ status, note }),
      });
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed');
    }
  }
  async function hold(row: Aging) {
    try {
      await apiFetch(
        `/finance/compliance/ap-invoices/${row.invoiceId}/payment-hold`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            hold: !row.onHold,
            reason: row.onHold ? undefined : window.prompt('Hold reason') || '',
          }),
        },
      );
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed');
    }
  }
  async function addTds(e: FormEvent) {
    e.preventDefault();
    try {
      await apiFetch('/finance/compliance/tds-sections', {
        method: 'POST',
        body: JSON.stringify({
          sectionCode: section,
          description,
          ratePercent: Number(rate),
          thresholdInr: Number(threshold),
          effectiveFrom: new Date().toISOString().slice(0, 10),
        }),
      });
      await load();
    } catch (x) {
      toast.error(x instanceof ApiError ? x.message : 'Failed');
    }
  }
  return (
    <PageContainer>
      <PageHeader
        title="GST, TDS & Cash Forecast"
        description="GSTR-2B ITC review, AP aging and holds, TDS masters, and weekly INR cash outlook"
      />
      <Card className="mb-6">
        <CardContent className="flex flex-wrap gap-3 p-5">
          <Input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
          <Input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
          <Button onClick={load}>Refresh reports</Button>
        </CardContent>
      </Card>
      <Card className="mb-6">
        <CardContent className="p-0 overflow-x-auto">
          <h2 className="p-4 font-semibold">GST Purchase Register & ITC</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="p-3">Bill</th>
                <th>Party / GSTIN</th>
                <th>Taxable</th>
                <th>CGST / SGST / IGST</th>
                <th>Total</th>
                <th>ITC status</th>
                <th>Reconcile</th>
              </tr>
            </thead>
            <tbody>
              {gst.map((g) => (
                <tr className="border-b" key={g.invoiceId}>
                  <td className="p-3 font-mono">
                    {g.internalBillNumber}
                    <br />
                    {g.supplierInvoiceNumber}
                  </td>
                  <td>
                    {g.partyName}
                    <br />
                    {g.gstin || 'No GSTIN'}
                  </td>
                  <td>{g.taxableAmount}</td>
                  <td>
                    {g.cgst} / {g.sgst} / {g.igst}
                  </td>
                  <td>{g.total}</td>
                  <td>{g.itcStatus.replaceAll('_', ' ')}</td>
                  <td>
                    <Select
                      value={g.itcStatus}
                      onChange={(e) => itc(g.invoiceId, e.target.value)}
                    >
                      <option>PENDING_RECONCILIATION</option>
                      <option>MATCHED_GSTR2B</option>
                      <option>MISMATCHED</option>
                      <option>INELIGIBLE</option>
                      <option>DEFERRED</option>
                    </Select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
      <Card className="mb-6">
        <CardContent className="p-0 overflow-x-auto">
          <h2 className="p-4 font-semibold">AP Aging & Disputes</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="p-3">Bill</th>
                <th>Party</th>
                <th>Due</th>
                <th>Days</th>
                <th>Bucket</th>
                <th>Outstanding</th>
                <th>Payment</th>
              </tr>
            </thead>
            <tbody>
              {aging.map((a) => (
                <tr className="border-b" key={a.invoiceId}>
                  <td className="p-3 font-mono">{a.billNumber}</td>
                  <td>{a.partyName}</td>
                  <td>{a.dueDate.slice(0, 10)}</td>
                  <td>{a.daysOverdue}</td>
                  <td>{a.bucket.replaceAll('_', '–')}</td>
                  <td>₹ {a.outstanding}</td>
                  <td>
                    {isAccountsHead ? (
                      <Button
                        size="sm"
                        variant={a.onHold ? 'outline' : 'destructive'}
                        onClick={() => hold(a)}
                      >
                        {a.onHold ? 'Release hold' : 'Place hold'}
                      </Button>
                    ) : a.onHold ? (
                      'ON HOLD'
                    ) : (
                      'Available'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
      <Card className="mb-6">
        <CardContent className="p-0 overflow-x-auto">
          <h2 className="p-4 font-semibold">Weekly Cash Forecast</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="p-3">Week</th>
                <th>Collections</th>
                <th>Payables due</th>
                <th>Planned payments</th>
                <th>Net planned cash</th>
              </tr>
            </thead>
            <tbody>
              {forecast.map((f) => (
                <tr className="border-b" key={f.weekStarting}>
                  <td className="p-3">{f.weekStarting}</td>
                  <td>₹ {f.expectedCollections}</td>
                  <td>₹ {f.duePayables}</td>
                  <td>₹ {f.plannedPayments}</td>
                  <td>₹ {f.netCash}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-5">
          <h2 className="mb-3 font-semibold">TDS Sections</h2>
          {isAccountsHead && (
            <form onSubmit={addTds} className="grid gap-3 md:grid-cols-5">
              <Input
                required
                value={section}
                onChange={(e) => setSection(e.target.value)}
                placeholder="Section"
              />
              <Input
                required
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Description"
              />
              <Input
                required
                type="number"
                step="0.01"
                value={rate}
                onChange={(e) => setRate(e.target.value)}
                placeholder="Rate %"
              />
              <Input
                required
                type="number"
                step="0.01"
                value={threshold}
                onChange={(e) => setThreshold(e.target.value)}
                placeholder="Threshold INR"
              />
              <Button type="submit">Add TDS section</Button>
            </form>
          )}
          <div className="mt-4 text-sm">
            {tds.map((t) => (
              <div className="border-b py-2" key={t.id}>
                <b>{t.sectionCode}</b> · {t.description} · {t.ratePercent}%
                above ₹{t.thresholdInr} · {t.isActive ? 'Active' : 'Inactive'}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </PageContainer>
  );
}
