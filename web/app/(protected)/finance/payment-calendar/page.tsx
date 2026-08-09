'use client';

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../../components/ui/table';
import { useEffect, useState } from 'react';
import { apiFetch } from '../../../lib/api';
import { formatINR } from '../../../lib/sales';
import { useNumberFormat } from '../../../lib/number-format-context';
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
  const { style: numberFormatStyle } = useNumberFormat();
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
          <Table className="w-full text-sm">
            <TableHeader>
              <TableRow className="border-b text-left">
                <TableHead className="p-3">Date</TableHead>
                <TableHead>Cash event</TableHead>
                <TableHead>Party</TableHead>
                <TableHead>Reference</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r, n) => (
                <TableRow className="border-b" key={`${r.type}:${r.reference}:${n}`}>
                  <TableCell className="p-3">{r.date.slice(0, 10)}</TableCell>
                  <TableCell>{r.type.replaceAll('_', ' ')}</TableCell>
                  <TableCell>{r.party}</TableCell>
                  <TableCell className="font-mono">{r.reference}</TableCell>
                  <TableCell>{formatINR(r.amount, numberFormatStyle)}</TableCell>
                  <TableCell>{r.status || 'DUE'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </PageContainer>
  );
}
