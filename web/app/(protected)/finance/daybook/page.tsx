'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { apiFetch, ApiError } from '../../../lib/api';
import { formatINR } from '../../../lib/sales';
import { useNumberFormat } from '../../../lib/number-format-context';
import { Input } from '../../../components/ui/input';
import { Select } from '../../../components/ui/select';
import { Button } from '../../../components/ui/button';
import {
  SCard,
  SIGNAL_LINK,
  SIGNAL_ROW_DIVIDER,
  SIGNAL_ROW_HOVER,
  SIGNAL_TABLE_HEAD,
  SignalHeader,
  SignalPage,
} from '../../../components/ui/signal';
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
  total: number;
  page: number;
  limit: number;
}

const today = () => new Date().toISOString().slice(0, 10);
const PAGE_SIZE = 50;

export default function DayBookPage() {
  const toast = useToast();
  const { style: numberFormatStyle } = useNumberFormat();
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState(today());
  const [voucherType, setVoucherType] = useState('');
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<DaybookRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  // Any filter change should snap back to page 1 — a stale page number past
  // the end of a newly-filtered result set would render an empty table.
  useEffect(() => {
    setPage(1);
  }, [from, to, voucherType]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        from,
        to,
        page: String(page),
        limit: String(PAGE_SIZE),
      });
      if (voucherType) params.set('voucherType', voucherType);
      const res = await apiFetch<DaybookResponse>(`/finance/daybook?${params}`);
      setRows(res.rows);
      setTotal(res.total);
    } catch (e) {
      toast.error(
        e instanceof ApiError ? e.message : 'Failed to load Day Book',
      );
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, voucherType, page]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <SignalPage>
      <SignalHeader
        title={FINANCE_LABELS.dayBook}
        description="Every voucher, newest first · sales, purchase, receipt, payment, journal"
      />
      <div className="space-y-4 px-5 pb-7 pt-[18px] lg:px-7">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm">
            From
            <Input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label className="text-sm">
            To
            <Input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
          <label className="text-sm">
            Voucher type
            <Select
              value={voucherType}
              onChange={(e) => setVoucherType(e.target.value)}
            >
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

        <SCard className="overflow-hidden">
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
                  {/* Every cell carries its own padding — without it the
                      right-aligned Amount butts straight into the Status
                      badge. */}
                  <tr className={`${SIGNAL_TABLE_HEAD} text-left`}>
                    <th className="p-3">Date</th>
                    <th className="p-3">Type</th>
                    <th className="p-3">Voucher No.</th>
                    <th className="p-3">Party / Ledger</th>
                    <th className="p-3 text-right">Amount</th>
                    <th className="p-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr
                      key={`${r.voucherType}-${r.id}`}
                      className={`border-b ${SIGNAL_ROW_DIVIDER} ${SIGNAL_ROW_HOVER}`}
                    >
                      <td className="whitespace-nowrap p-3">
                        {r.date.slice(0, 10)}
                      </td>
                      <td className="p-3">{voucherTypeLabel(r.voucherType)}</td>
                      <td className="p-3 tabular-nums">
                        <Link href={r.detailHref} className={SIGNAL_LINK}>
                          {r.voucherNumber}
                        </Link>
                      </td>
                      <td
                        className="max-w-xs truncate p-3"
                        title={r.party ?? ''}
                      >
                        {r.party ?? '—'}
                      </td>
                      <td className="whitespace-nowrap p-3 text-right tabular-nums">
                        {formatINR(r.amount, numberFormatStyle)}
                      </td>
                      <td className="p-3">
                        <StatusBadge value={r.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SCard>

        {total > 0 && (
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>
              Showing {(page - 1) * PAGE_SIZE + 1}–
              {Math.min(page * PAGE_SIZE, total)} of {total}
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </Button>
              <span className="px-2 py-1">
                Page {page} of {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </div>
    </SignalPage>
  );
}
