'use client';
import { useEffect, useState } from 'react';
import { apiFetch } from '../../../lib/api';
import { Button } from '../../../components/ui/button';
import { Card, CardContent } from '../../../components/ui/card';
import { Input } from '../../../components/ui/input';
import { PageContainer } from '../../../components/ui/page-container';
import { PageHeader } from '../../../components/ui/page-header';
type Entry = {
  date: string;
  type: string;
  party: string;
  amount: string;
  reference: string;
  status?: string;
};
type Data = {
  receivables: Entry[];
  payables: Entry[];
  plannedPayments: Entry[];
};
export default function PaymentCalendarPage() {
  const today = new Date(),
    [from, setFrom] = useState(today.toISOString().slice(0, 10)),
    [to, setTo] = useState(
      new Date(today.getTime() + 30 * 86400000).toISOString().slice(0, 10),
    ),
    [data, setData] = useState<Data>({
      receivables: [],
      payables: [],
      plannedPayments: [],
    });
  const load = () =>
    apiFetch<Data>(`/finance/ap/payment-calendar?from=${from}&to=${to}`).then(
      setData,
    );
  useEffect(() => {
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const rows = [
    ...data.receivables,
    ...data.payables,
    ...data.plannedPayments,
  ].sort((a, b) => a.date.localeCompare(b.date));
  return (
    <PageContainer>
      <PageHeader
        title="Payment Calendar"
        description="One cash-planning view of customer collections, vendor dues and approved payment proposals"
      />
      <Card className="mb-6">
        <CardContent className="flex gap-3 p-5">
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
          <Button onClick={load}>Refresh</Button>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="p-3">Date</th>
                <th>Cash event</th>
                <th>Party</th>
                <th>Reference</th>
                <th>Amount</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, n) => (
                <tr className="border-b" key={`${r.type}:${r.reference}:${n}`}>
                  <td className="p-3">{r.date.slice(0, 10)}</td>
                  <td>{r.type.replaceAll('_', ' ')}</td>
                  <td>{r.party}</td>
                  <td className="font-mono">{r.reference}</td>
                  <td>₹ {r.amount}</td>
                  <td>{r.status || 'DUE'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </PageContainer>
  );
}
