'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { FileWarning } from 'lucide-react';
import {
  listNcrs,
  NCR_DISPOSITION_LABEL,
  type NonConformanceReport,
  type NonConformanceReportStatus,
} from '../../../lib/stores';
import { dateOnlyStr } from '../../../lib/date';
import { PageContainer } from '../../../components/ui/page-container';
import { PageHeader } from '../../../components/ui/page-header';
import { Card, CardContent } from '../../../components/ui/card';
import { Select } from '../../../components/ui/select';
import { StatusBadge } from '../../../components/ui/status-badge';
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

const STATUSES: NonConformanceReportStatus[] = ['OPEN', 'DISPOSITIONED', 'CLOSED'];

/** Non-Conformance Report register. Read is company-wide; disposition happens on detail. */
export default function NcrRegisterPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const grnId = searchParams.get('grnId') ?? undefined;

  const [ncrs, setNcrs] = useState<NonConformanceReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<NonConformanceReportStatus | ''>('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setNcrs(await listNcrs(grnId ? { grnId } : {}));
    } catch {
      setError('Failed to load NCRs.');
    } finally {
      setLoading(false);
    }
  }, [grnId]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(
    () => (statusFilter ? ncrs.filter((n) => n.status === statusFilter) : ncrs),
    [ncrs, statusFilter],
  );

  return (
    <PageContainer>
      <PageHeader
        title="Non-Conformance Reports"
        description={
          grnId
            ? 'NCRs raised from this goods receipt.'
            : 'Quality rejections raised at the QC gate, with their disposition.'
        }
      />

      <div className="mb-4 flex items-center gap-2">
        <Select
          className="w-56"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as NonConformanceReportStatus | '')}
        >
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s.replace(/_/g, ' ')}
            </option>
          ))}
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : error ? (
            <div className="p-6 text-sm text-destructive">{error}</div>
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={FileWarning}
              title="No non-conformance reports"
              description="NCRs are raised automatically when QC rejects incoming material."
              tone="positive"
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>NCR No.</TableHead>
                  <TableHead>Raised</TableHead>
                  <TableHead>GRN</TableHead>
                  <TableHead>Item</TableHead>
                  <TableHead className="text-right">Rejected Qty</TableHead>
                  <TableHead>Disposition</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((ncr) => (
                  <TableRow
                    key={ncr.id}
                    className="cursor-pointer"
                    onClick={() => router.push(`/stores/ncr/${ncr.id}`)}
                  >
                    <TableCell className="font-medium">
                      <Link
                        href={`/stores/ncr/${ncr.id}`}
                        className="text-primary hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {ncr.ncrNumber}
                      </Link>
                    </TableCell>
                    <TableCell>{dateOnlyStr(ncr.createdAt)}</TableCell>
                    <TableCell>{ncr.grnNumber ?? '—'}</TableCell>
                    <TableCell>{ncr.itemName ?? ncr.itemCode ?? '—'}</TableCell>
                    <TableCell className="text-right font-medium text-destructive">
                      {ncr.rejectedQuantity}
                    </TableCell>
                    <TableCell>
                      {ncr.disposition ? NCR_DISPOSITION_LABEL[ncr.disposition] : '—'}
                    </TableCell>
                    <TableCell>
                      <StatusBadge value={ncr.status} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </PageContainer>
  );
}
