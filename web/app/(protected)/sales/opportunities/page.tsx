'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Opportunity,
  OpportunityStage,
  PaginatedResult,
} from '../../../lib/types';
import { apiFetch } from '../../../lib/api';
import { formatINR, prettyEnum } from '../../../lib/sales';
import { PageContainer } from '../../../components/ui/page-container';
import { PageHeader } from '../../../components/ui/page-header';
import { Card, CardContent } from '../../../components/ui/card';
import { StatusBadge } from '../../../components/ui/status-badge';
import { Button } from '../../../components/ui/button';
import { Select } from '../../../components/ui/select';
import { Skeleton } from '../../../components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../components/ui/table';

const STAGES: OpportunityStage[] = [
  'PROSPECTING',
  'QUALIFICATION',
  'PROPOSAL',
  'NEGOTIATION',
  'CLOSED_WON',
  'CLOSED_LOST',
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

export default function OpportunitiesPage() {
  const router = useRouter();
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [summaryRows, setSummaryRows] = useState<Opportunity[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [stageFilter, setStageFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await apiFetch<PaginatedResult<Opportunity>>(
        `/opportunities?page=${page}&limit=${PAGE_SIZE}`,
      );
      setOpportunities(result.items);
      setTotal(result.total);

      // Summary cards cover the complete normal-sized register rather than
      // changing as the user pages through it. The API caps a page at 100.
      if (page === 1 && result.total <= result.items.length) {
        setSummaryRows(result.items);
      } else {
        const summary = await apiFetch<PaginatedResult<Opportunity>>(
          '/opportunities?page=1&limit=100',
        );
        setSummaryRows(summary.items);
      }
    } catch {
      setError('Failed to load opportunities');
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(
    () =>
      opportunities.filter(
        (opportunity) => !stageFilter || opportunity.stage === stageFilter,
      ),
    [opportunities, stageFilter],
  );

  const summary = useMemo(() => {
    const active = summaryRows.filter(
      (opportunity) =>
        opportunity.stage !== 'CLOSED_WON' &&
        opportunity.stage !== 'CLOSED_LOST',
    );
    const now = new Date();
    const closingThisMonth = active.filter((opportunity) => {
      const close = new Date(opportunity.expectedCloseDate);
      return (
        close.getUTCFullYear() === now.getUTCFullYear() &&
        close.getUTCMonth() === now.getUTCMonth()
      );
    }).length;
    return {
      active: active.length,
      pipelineValue: active.reduce(
        (sum, opportunity) => sum + Number(opportunity.estimatedValue),
        0,
      ),
      proposals: active.filter(
        (opportunity) =>
          opportunity.stage === 'PROPOSAL' ||
          opportunity.stage === 'NEGOTIATION',
      ).length,
      closingThisMonth,
    };
  }, [summaryRows]);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <PageContainer>
      <PageHeader
        title="Opportunities"
        description="Qualified sales pipeline — from prospecting through proposal, negotiation and closure."
      />

      <div className="mb-6 flex flex-wrap gap-3">
        <StatCard label="Active Opportunities" value={summary.active} />
        <StatCard
          label="Pipeline Value"
          value={formatINR(summary.pipelineValue)}
        />
        <StatCard label="Proposals" value={summary.proposals} />
        <StatCard label="Closing This Month" value={summary.closingThisMonth} />
      </div>

      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

      <div className="mb-2 flex flex-wrap items-end justify-between gap-3">
        <h2 className="text-lg font-semibold">Opportunity Register</h2>
        <div className="w-full sm:w-48">
          <label
            htmlFor="opportunity-stage-filter"
            className="mb-1 block text-xs font-medium text-muted-foreground"
          >
            Stage
          </label>
          <Select
            id="opportunity-stage-filter"
            value={stageFilter}
            onChange={(event) => {
              setStageFilter(event.target.value);
              setPage(1);
            }}
          >
            <option value="">All stages</option>
            {STAGES.map((stage) => (
              <option key={stage} value={stage}>
                {prettyEnum(stage)}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Opportunity</TableHead>
                <TableHead>Stage</TableHead>
                <TableHead>Estimated Value</TableHead>
                <TableHead>Expected Close</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 5 }).map((_, row) => (
                  <TableRow key={row}>
                    {Array.from({ length: 5 }).map((__, column) => (
                      <TableCell key={column}>
                        <Skeleton className="h-4 w-24" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="py-8 text-center text-muted-foreground"
                  >
                    {stageFilter
                      ? `No ${prettyEnum(stageFilter).toLowerCase()} opportunities on this page.`
                      : 'No opportunities yet.'}
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((opportunity) => (
                  <TableRow key={opportunity.id}>
                    <TableCell className="max-w-sm font-medium">
                      <button
                        type="button"
                        className="truncate text-left hover:text-primary hover:underline"
                        onClick={() =>
                          router.push(`/sales/opportunities/${opportunity.id}`)
                        }
                      >
                        {opportunity.name}
                      </button>
                    </TableCell>
                    <TableCell>
                      <StatusBadge value={opportunity.stage} />
                    </TableCell>
                    <TableCell>
                      {formatINR(opportunity.estimatedValue)}
                    </TableCell>
                    <TableCell>
                      {new Date(
                        opportunity.expectedCloseDate,
                      ).toLocaleDateString('en-IN')}
                    </TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          router.push(`/sales/opportunities/${opportunity.id}`)
                        }
                      >
                        View Opportunity
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
