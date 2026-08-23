'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Bid, BidStatus, PaginatedResult } from '../../../lib/types';
import { apiFetch } from '../../../lib/api';
import { useAuth } from '../../../lib/auth-context';
import { formatINR, prettyEnum } from '../../../lib/sales';
import { useNumberFormat } from '../../../lib/number-format-context';
import {
  Callout,
  SCard,
  SignalHeader,
  SignalPage,
  StatStrip,
  StatTile,
} from '../../../components/ui/signal';
import { StatusBadge } from '../../../components/ui/status-badge';
import { Button } from '../../../components/ui/button';
import { Select } from '../../../components/ui/select';
import { RegisterToolbar } from '../../../components/ui/register-toolbar';
import { RegisterPagination } from '../../../components/ui/register-pagination';
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

export default function BidsPage() {
  const router = useRouter();
  const { user } = useAuth();
  const { style: numberFormatStyle } = useNumberFormat();
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
  // Cross-bid "awaiting product setup" count, shown to Manager/SuperAdmin.
  const [adHocCount, setAdHocCount] = useState<{
    lineItemCount: number;
    bidCount: number;
  } | null>(null);
  const canSeeAdHocCount =
    user?.role === 'MANAGER' || user?.role === 'SUPER_ADMIN';

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

  // Best-effort cross-bid count; a failure just hides the banner.
  useEffect(() => {
    if (!canSeeAdHocCount) return;
    apiFetch<{ lineItemCount: number; bidCount: number }>('/bids/ad-hoc-count')
      .then(setAdHocCount)
      .catch(() => setAdHocCount(null));
  }, [canSeeAdHocCount]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return bids.filter(
      (bid) =>
        (!statusFilter || bid.status === statusFilter) &&
        (!businessUnitFilter || bid.businessUnitId === businessUnitFilter) &&
        (!q ||
          `${bid.bidNumber} ${bid.ownerName} ${bid.customerName ?? ''}`
            .toLowerCase()
            .includes(q)),
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
        .reduce((sum, bid) => sum + Number(bid.grandTotal), 0),
    }),
    [summaryRows],
  );

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <SignalPage>
      <SignalHeader
        title="Bids"
        description="Commercial proposal register — track drafts, approvals, customer submissions and outcomes."
      />
      <div className="space-y-4 px-5 pb-7 pt-[18px] lg:px-7">

      {canSeeAdHocCount && adHocCount && adHocCount.lineItemCount > 0 && (
        <Callout className="mt-0">
          <span className="font-semibold">
            {adHocCount.lineItemCount} line item
            {adHocCount.lineItemCount === 1 ? '' : 's'} awaiting product setup
          </span>{' '}
          across {adHocCount.bidCount} bid
          {adHocCount.bidCount === 1 ? '' : 's'}. Ad-hoc lines must be resolved
          to real products before those bids can convert to orders.
        </Callout>
      )}

      <StatStrip>
        <StatTile label="Drafts" value={summary.drafts} />
        <StatTile label="Awaiting Approval" value={summary.awaitingApproval} />
        <StatTile label="Sent to Customers" value={summary.sent} />
        <StatTile
          label="Accepted Value"
          value={formatINR(summary.acceptedValue, numberFormatStyle)}
        />
      </StatStrip>

      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

      <RegisterToolbar
        title="Bid Register"
        search={search}
        onSearchChange={(v) => {
          setSearch(v);
          setPage(1);
        }}
        searchPlaceholder="Search bid #, owner or customer"
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

      <SCard className="overflow-hidden">
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
                        className="block text-left hover:text-primary hover:underline"
                        onClick={() => router.push(`/sales/bids/${bid.id}`)}
                      >
                        {bid.bidNumber}
                      </button>
                      {bid.customerName && (
                        <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                          {bid.customerName}
                        </span>
                      )}
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
                    <TableCell>
                      {formatINR(bid.grandTotal, numberFormatStyle)}
                    </TableCell>
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
      </SCard>

      <RegisterPagination
        page={page}
        pageCount={pageCount}
        onPageChange={setPage}
        disabled={loading}
      />
      </div>
    </SignalPage>
  );
}
