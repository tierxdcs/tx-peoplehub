'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { apiFetch, ApiError } from '../../../lib/api';
import { Card, CardContent } from '../../../components/ui/card';
import { Input } from '../../../components/ui/input';
import { Select } from '../../../components/ui/select';
import { Button } from '../../../components/ui/button';
import { PageContainer } from '../../../components/ui/page-container';
import { PageHeader } from '../../../components/ui/page-header';
import { StatusBadge } from '../../../components/ui/status-badge';
import { EmptyState } from '../../../components/ui/empty-state';
import { Skeleton } from '../../../components/ui/skeleton';
import { useToast } from '../../../components/ui/toaster';
import {
  DAYBOOK_VOUCHER_TYPES,
  FINANCE_LABELS,
  voucherTypeLabel,
} from '../../../lib/finance-labels';
import { ScrollText } from 'lucide-react';

interface DaybookRow {
  id: string;
  date: string;
  voucherType: string;
  voucherNumber: string;
  party: string | null;
  amount: string;
  status: string;
  detailHref: string;
}
interface DaybookResponse {
  from: string;
  to: string;
  rows: DaybookRow[];
}

const today = () => new Date().toISOString().slice(0, 10);

export default function DayBookPage() {
  const toast = useToast();
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState(today());
  const [voucherType, setVoucherType] = useState('');
  const [rows, setRows] = useState<DaybookRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ from, to });
      if (voucherType) params.set('voucherType', voucherType);
      const res = await apiFetch<DaybookResponse>(`/finance/daybook?${params}`);
      setRows(res.rows);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to load Day Book');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, voucherType]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <PageContainer>
      <PageHeader
        title={FINANCE_LABELS.dayBook}
        description="Every voucher, newest first · sales, purchase, receipt, payment, journal"
      />

      <div className="mb-5 flex flex-wrap items-end gap-3">
        <label className="text-sm">
          From
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="text-sm">
          To
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <label className="text-sm">
          Voucher type
          <Select value={voucherType} onChange={(e) => setVoucherType(e.target.value)}>
            <option value="">All</option>
            {DAYBOOK_VOUCHER_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </Select>
        </label>
        <Button variant="outline" onClick={() => void load()}>
          Refresh
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="space-y-2 p-4">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : rows.length === 0 ? (
            <EmptyState
              icon={ScrollText}
              title="No vouchers"
              description="No vouchers were recorded in this date range."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left">
                    <th className="p-3">Date</th>
                    <th>Type</th>
                    <th>Voucher No.</th>
                    <th>Party / Ledger</th>
                    <th className="text-right">Amount</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={`${r.voucherType}-${r.id}`} className="border-b hover:bg-accent/50">
                      <td className="p-3 whitespace-nowrap">{r.date.slice(0, 10)}</td>
                      <td>{voucherTypeLabel(r.voucherType)}</td>
                      <td className="font-mono">
                        <Link href={r.detailHref} className="text-primary hover:underline">
                          {r.voucherNumber}
                        </Link>
                      </td>
                      <td className="max-w-xs truncate" title={r.party ?? ''}>
                        {r.party ?? '—'}
                      </td>
                      <td className="text-right tabular-nums">
                        ₹{Number(r.amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </td>
                      <td>
                        <StatusBadge value={r.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </PageContainer>
  );
}
