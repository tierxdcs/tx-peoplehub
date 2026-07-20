'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Bid, BidStatus, PaginatedResult } from '../../../lib/types';
import { apiFetch } from '../../../lib/api';
import { formatINR, prettyEnum } from '../../../lib/sales';
import { PageContainer } from '../../../components/ui/page-container';
import { PageHeader } from '../../../components/ui/page-header';
import { Card, CardContent } from '../../../components/ui/card';
import { StatusBadge } from '../../../components/ui/status-badge';
import { Button } from '../../../components/ui/button';
import { Select } from '../../../components/ui/select';
import { RegisterToolbar } from '../_components/register-toolbar';
import { Skeleton } from '../../../components/ui/skeleton';
import { BusinessUnitLabel } from '../../../components/ui/business-unit-label';
import { useBusinessUnitOptions } from '../../../lib/business-units';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../components/ui/table';

const STATUSES: BidStatus[] = [
  'DRAFT',
  'PENDING_APPROVAL',
  'APPROVED',
  'REJECTED',
  'SENT',
  'ACCEPTED',
  'EXPIRED',
];
const PAGE_SIZE = 20;

function StatCard({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <Card className="min-w-[160px] flex-1">
      <CardContent className="p-4">
        <div className="text-sm font-medium text-muted-foreground">{label}</div>
        <div className="mt-1 text-2xl font-semibold">{value}</div>
      </CardContent>
    </Card>
  );
}

export default function BidsPage() {
  const router = useRouter();
  const [bids, setBids] = useState<Bid[]>([]);
  const [summaryRows, setSummaryRows] = useState<Bid[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [businessUnitFilter, setBusinessUnitFilter] = useState('');
  const { businessUnits } = useBusinessUnitOptions();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await apiFetch<PaginatedResult<Bid>>(
        `/bids?page=${page}&limit=${PAGE_SIZE}`,
      );
      setBids(result.items);
      setTotal(result.total);

      // Keep KPI cards stable while paging through the register. The list API
      // allows 100 rows, which covers the normal operational dashboard view.
      if (page === 1 && result.total <= result.items.length) {
        setSummaryRows(result.items);
      } else {
        const summary = await apiFetch<PaginatedResult<Bid>>(
          '/bids?page=1&limit=100',
        );
        setSummaryRows(summary.items);
      }
    } catch {
      setError('Failed to load bids');
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return bids.filter(
      (bid) =>
        (!statusFilter || bid.status === statusFilter) &&
        (!businessUnitFilter || bid.businessUnitId === businessUnitFilter) &&
        (!q ||
          `${bid.bidNumber} ${bid.ownerName}`.toLowerCase().includes(q)),
    );
  }, [bids, search, statusFilter, businessUnitFilter]);

  const summary = useMemo(
    () => ({
      drafts: summaryRows.filter((bid) => bid.status === 'DRAFT').length,
      awaitingApproval: summaryRows.filter(
        (bid) => bid.status === 'PENDING_APPROVAL',
      ).length,
      sent: summaryRows.filter((bid) => bid.status === 'SENT').length,
      acceptedValue: summaryRows
        .filter((bid) => bid.status === 'ACCEPTED')
        .reduce((sum, bid) => sum + Number(bid.totalAmount), 0),
    }),
    [summaryRows],
  );

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <PageContainer>
      <PageHeader
        title="Bids"
        description="Commercial proposal register — track drafts, approvals, customer submissions and outcomes."
      />

      <div className="mb-6 flex flex-wrap gap-3">
        <StatCard label="Drafts" value={summary.drafts} />
        <StatCard label="Awaiting Approval" value={summary.awaitingApproval} />
        <StatCard label="Sent to Customers" value={summary.sent} />
        <StatCard
          label="Accepted Value"
          value={formatINR(summary.acceptedValue)}
        />
      </div>

      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

      <RegisterToolbar
        title="Bid Register"
        search={search}
        onSearchChange={(v) => {
          setSearch(v);
          setPage(1);
        }}
        searchPlaceholder="Search bid # or owner"
      >
        <Select
          aria-label="Status"
          className="w-full sm:w-44"
          value={statusFilter}
          onChange={(event) => {
            setStatusFilter(event.target.value);
            setPage(1);
          }}
        >
          <option value="">All statuses</option>
          {STATUSES.map((status) => (
            <option key={status} value={status}>
              {prettyEnum(status)}
            </option>
          ))}
        </Select>
        <Select
          aria-label="Business unit"
          className="w-full sm:w-52"
          value={businessUnitFilter}
          onChange={(event) => setBusinessUnitFilter(event.target.value)}
        >
          <option value="">All business units</option>
          {businessUnits.map((unit) => (
            <option key={unit.id} value={unit.id}>
              {unit.name}
            </option>
          ))}
        </Select>
      </RegisterToolbar>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Bid #</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Business Unit</TableHead>
                <TableHead>Discount</TableHead>
                <TableHead>Total</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead>Valid Until</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 5 }).map((_, row) => (
                  <TableRow key={row}>
                    {Array.from({ length: 8 }).map((__, column) => (
                      <TableCell key={column}>
                        <Skeleton className="h-4 w-24" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={8}
                    className="py-8 text-center text-muted-foreground"
                  >
                    {statusFilter
                      ? `No ${prettyEnum(statusFilter).toLowerCase()} bids on this page.`
                      : 'No bids yet.'}
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((bid) => (
                  <TableRow key={bid.id}>
                    <TableCell className="font-medium">
                      <button
                        type="button"
                        className="hover:text-primary hover:underline"
                        onClick={() => router.push(`/sales/bids/${bid.id}`)}
                      >
                        {bid.bidNumber}
                      </button>
                    </TableCell>
                    <TableCell>
                      <StatusBadge value={bid.status} />
                    </TableCell>
                    <TableCell>
                      <BusinessUnitLabel
                        name={bid.businessUnitName}
                        colorHex={bid.businessUnitColorHex}
                      />
                    </TableCell>
                    <TableCell>{Number(bid.discountPercent)}%</TableCell>
                    <TableCell>{formatINR(bid.totalAmount)}</TableCell>
                    <TableCell>{bid.ownerName}</TableCell>
                    <TableCell>
                      {new Date(bid.validUntil).toLocaleDateString('en-IN')}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => router.push(`/sales/bids/${bid.id}`)}
                      >
                        View Bid
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="mt-4 flex items-center gap-2 text-sm">
        <Button
          variant="outline"
          size="sm"
          disabled={page <= 1 || loading}
          onClick={() => setPage((current) => current - 1)}
        >
          Prev
        </Button>
        <span className="text-muted-foreground">
          Page {page} of {pageCount}
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={page >= pageCount || loading}
          onClick={() => setPage((current) => current + 1)}
        >
          Next
        </Button>
      </div>
    </PageContainer>
  );
}
