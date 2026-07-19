'use client';

import { useCallback, useEffect, useState } from 'react';
import { Timer } from 'lucide-react';
import { otdReport, type OtdReport } from '../../../lib/logistics';
import { dateOnlyStr } from '../../../lib/date';
import { PageContainer } from '../../../components/ui/page-container';
import { PageHeader } from '../../../components/ui/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { Input } from '../../../components/ui/input';
import { Field } from '../../../components/ui/field';
import { Badge } from '../../../components/ui/badge';
import { EmptyState } from '../../../components/ui/empty-state';
import { Skeleton } from '../../../components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../components/ui/table';

/** On-Time Delivery analytics — computed from delivered DCs (promised vs actual). */
export default function OtdPage() {
  const [report, setReport] = useState<OtdReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setReport(await otdReport({ from: from || undefined, to: to || undefined }));
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <PageContainer className="max-w-6xl">
      <PageHeader
        title="On-Time Delivery"
        description="Delivered dispatches within a date range — on-time vs late, computed from promised/actual dates."
      />

      <Card className="mb-6">
        <CardContent className="flex flex-wrap items-end gap-4 p-4">
          <Field label="From" htmlFor="from">
            <Input id="from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="To" htmlFor="to">
            <Input id="to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
        </CardContent>
      </Card>

      {loading ? (
        <Skeleton className="h-64 w-full" />
      ) : !report || report.summary.totalDelivered === 0 ? (
        <EmptyState
          icon={Timer}
          title="No delivered dispatches in range"
          description="OTD is computed once dispatches are delivered with a promised and actual date."
        />
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <Metric label="Delivered" value={String(report.summary.totalDelivered)} />
            <Metric label="On Time" value={String(report.summary.onTime)} tone="success" />
            <Metric label="Late" value={String(report.summary.late)} tone="destructive" />
            <Metric
              label="On-Time %"
              value={report.summary.onTimePercentage != null ? `${report.summary.onTimePercentage}%` : '—'}
            />
          </div>
          <p className="text-sm text-muted-foreground">
            Average delay on late deliveries: <span className="font-medium">{report.summary.averageDelayDays}</span> day(s).
          </p>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">By Customer</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Customer</TableHead>
                    <TableHead className="text-right">Delivered</TableHead>
                    <TableHead className="text-right">On Time</TableHead>
                    <TableHead className="text-right">Late</TableHead>
                    <TableHead className="text-right">On-Time %</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.byCustomer.map((c) => (
                    <TableRow key={c.customerId}>
                      <TableCell>{c.customerName}</TableCell>
                      <TableCell className="text-right">{c.total}</TableCell>
                      <TableCell className="text-right">{c.onTime}</TableCell>
                      <TableCell className="text-right">{c.late}</TableCell>
                      <TableCell className="text-right">
                        {c.onTimePercentage != null ? `${c.onTimePercentage}%` : '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Dispatches</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>DC No.</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Promised</TableHead>
                    <TableHead>Actual</TableHead>
                    <TableHead className="text-right">Delay (days)</TableHead>
                    <TableHead>Result</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.dispatches.map((d) => (
                    <TableRow key={d.id}>
                      <TableCell className="font-medium">{d.dcNumber}</TableCell>
                      <TableCell>{d.customerName}</TableCell>
                      <TableCell>{dateOnlyStr(d.promisedDeliveryDate)}</TableCell>
                      <TableCell>{dateOnlyStr(d.actualDeliveryDate)}</TableCell>
                      <TableCell className="text-right">{d.delayDays > 0 ? d.delayDays : '—'}</TableCell>
                      <TableCell>
                        <Badge variant={d.onTime ? 'success' : 'destructive'}>
                          {d.onTime ? 'On Time' : 'Late'}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      )}
    </PageContainer>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'success' | 'destructive';
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
        <div
          className={`mt-1 text-2xl font-semibold ${
            tone === 'success' ? 'text-success' : tone === 'destructive' ? 'text-destructive' : ''
          }`}
        >
          {value}
        </div>
      </CardContent>
    </Card>
  );
}
