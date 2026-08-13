'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ArrowUpDown, BarChart3 } from 'lucide-react';
import { ApiError } from '../../../../lib/api';
import {
  crossProjectSummary,
  varianceToneClass,
  signedVariance,
  type CrossProjectSummaryRow,
} from '../../../../lib/scm-resource-plan';
import { formatINR } from '../../../../lib/sales';
import { useNumberFormat } from '../../../../lib/number-format-context';
import { PageContainer } from '../../../../components/ui/page-container';
import { PageHeader } from '../../../../components/ui/page-header';
import { Card, CardContent } from '../../../../components/ui/card';
import { Button } from '../../../../components/ui/button';
import { EmptyState } from '../../../../components/ui/empty-state';
import { Skeleton } from '../../../../components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../../components/ui/table';
import { RegisterToolbar } from '../../../../components/ui/register-toolbar';
import { RegisterPagination } from '../../../../components/ui/register-pagination';
import { useRegisterList } from '../../../../lib/use-register-list';

type SortKey =
  | 'projectName'
  | 'totalBenchmarkCost'
  | 'totalNegotiatedCost'
  | 'varianceAmount'
  | 'variancePercent';

/**
 * SCM Resource Planning — cross-project summary (§5). Every project WITH a plan,
 * with total benchmark, total negotiated, and variance. Sortable client-side.
 */
export default function ResourcePlanSummaryPage() {
  const router = useRouter();
  const { style: numberFormatStyle } = useNumberFormat();
  const [rows, setRows] = useState<CrossProjectSummaryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('varianceAmount');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const money = useCallback(
    (v: string | number | null | undefined) => formatINR(v, numberFormatStyle),
    [numberFormatStyle],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await crossProjectSummary());
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Failed to load summary.',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'projectName' ? 'asc' : 'desc');
    }
  }

  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      let cmp: number;
      if (sortKey === 'projectName') {
        cmp = a.projectName.localeCompare(b.projectName);
      } else {
        // Numeric columns; nulls (unset variance %) sort last.
        const av = a[sortKey];
        const bv = b[sortKey];
        const an = av === null ? Number.NEGATIVE_INFINITY : Number(av);
        const bn = bv === null ? Number.NEGATIVE_INFINITY : Number(bv);
        cmp = an - bn;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return copy;
  }, [rows, sortKey, sortDir]);
  const register = useRegisterList(
    sorted,
    (row) => `${row.projectName} ${row.orderNumber} ${row.customerName}`,
  );

  const SortHead = ({
    label,
    k,
    right,
  }: {
    label: string;
    k: SortKey;
    right?: boolean;
  }) => (
    <TableHead className={right ? 'text-right' : undefined}>
      <button
        type="button"
        onClick={() => toggleSort(k)}
        className={`inline-flex items-center gap-1 hover:text-foreground ${
          sortKey === k ? 'text-foreground' : ''
        }`}
      >
        {label}
        <ArrowUpDown className="h-3 w-3" />
      </button>
    </TableHead>
  );

  return (
    <PageContainer>
      <PageHeader
        title="Resource Planning — cross-project summary"
        description="Benchmark vs. negotiated total cost and variance for every project with a plan. Click a column to sort."
        action={
          <Button
            variant="outline"
            onClick={() => router.push('/scm/resource-plans')}
          >
            <ArrowLeft className="mr-1 h-4 w-4" /> Projects
          </Button>
        }
      />
      <RegisterToolbar
        title="Resource Plan Summary"
        search={register.search}
        onSearchChange={register.setSearch}
        searchPlaceholder="Search project, order or customer"
      />

      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : register.visibleItems.length === 0 ? (
        <EmptyState
          icon={BarChart3}
          title="No resource plans yet"
          description="Generate a plan for a completed project to see it compared here."
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <SortHead label="Project" k="projectName" />
                  <TableHead>Order</TableHead>
                  <TableHead>Customer</TableHead>
                  <SortHead label="Benchmark" k="totalBenchmarkCost" right />
                  <SortHead label="Negotiated" k="totalNegotiatedCost" right />
                  <SortHead label="Variance" k="varianceAmount" right />
                  <SortHead label="Variance %" k="variancePercent" right />
                </TableRow>
              </TableHeader>
              <TableBody>
                {register.visibleItems.map((r) => (
                  <TableRow
                    key={r.planId}
                    className="cursor-pointer"
                    onClick={() =>
                      router.push(`/scm/resource-plans/${r.projectKickoffId}`)
                    }
                  >
                    <TableCell className="font-medium">
                      {r.projectName}
                      <div className="text-xs text-muted-foreground">
                        {r.negotiatedLineCount}/{r.lineCount} lines priced
                      </div>
                    </TableCell>
                    <TableCell>{r.orderNumber}</TableCell>
                    <TableCell>{r.customerName}</TableCell>
                    <TableCell className="text-right">
                      {r.isCostComplete
                        ? money(r.totalBenchmarkCost)
                        : 'Cost data incomplete'}
                    </TableCell>
                    <TableCell className="text-right">
                      {r.isCostComplete
                        ? money(r.totalNegotiatedCost)
                        : 'Cost data incomplete'}
                    </TableCell>
                    <TableCell className="text-right">
                      <span className={varianceToneClass(r.varianceAmount)}>
                        {r.isCostComplete
                          ? signedVariance(r.varianceAmount, money)
                          : 'Cost data incomplete'}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      {r.variancePercent !== null ? (
                        <span className={varianceToneClass(r.varianceAmount)}>
                          {Number(r.variancePercent) > 0 ? '+' : ''}
                          {r.variancePercent}%
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
      <RegisterPagination
        page={register.page}
        pageCount={register.pageCount}
        onPageChange={register.setPage}
        disabled={loading}
      />
    </PageContainer>
  );
}
