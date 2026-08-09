'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ClipboardList } from 'lucide-react';
import { useAuth } from '../../../lib/auth-context';
import { ApiError } from '../../../lib/api';
import {
  generateResourcePlan,
  listEligibleProjects,
  varianceToneClass,
  signedVariance,
  type EligibleProject,
} from '../../../lib/scm-resource-plan';
import { formatINR } from '../../../lib/sales';
import { useNumberFormat } from '../../../lib/number-format-context';
import { PageContainer } from '../../../components/ui/page-container';
import { PageHeader } from '../../../components/ui/page-header';
import { Card, CardContent } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { Badge } from '../../../components/ui/badge';
import { EmptyState } from '../../../components/ui/empty-state';
import { Skeleton } from '../../../components/ui/skeleton';
import { useToast } from '../../../components/ui/toaster';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../components/ui/table';

/**
 * SCM Resource Planning — project list (§3). Every COMPLETED project kickoff,
 * with its plan status + variance summary or a Generate action. The "Generate"
 * button shows for SUPER_ADMIN or a MANAGER (backend enforces SCM-vertical); a
 * non-SCM manager who tries gets a 403 surfaced as a toast.
 */
export default function ResourcePlansPage() {
  const router = useRouter();
  const { user } = useAuth();
  const toast = useToast();
  const { style: numberFormatStyle } = useNumberFormat();
  const [projects, setProjects] = useState<EligibleProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [generatingId, setGeneratingId] = useState<string | null>(null);

  const canGenerate =
    user?.role === 'SUPER_ADMIN' || user?.role === 'MANAGER';

  const money = useCallback(
    (v: string | number | null | undefined) => formatINR(v, numberFormatStyle),
    [numberFormatStyle],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setProjects(await listEligibleProjects());
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Failed to load projects.',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function onGenerate(p: EligibleProject) {
    setGeneratingId(p.projectKickoffId);
    try {
      await generateResourcePlan(p.projectKickoffId);
      toast.success(`Resource plan ${p.hasPlan ? 'regenerated' : 'generated'}.`);
      router.push(`/scm/resource-plans/${p.projectKickoffId}`);
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : 'Failed to generate plan.',
      );
      setGeneratingId(null);
    }
  }

  return (
    <PageContainer>
      <PageHeader
        title="Resource Planning"
        description="Benchmark vs. negotiated material cost for every completed project. Generate a plan to snapshot required quantities and benchmark costs, then enter negotiated prices."
        action={
          <Button variant="outline" onClick={() => router.push('/scm/resource-plans/summary')}>
            Cross-project summary
          </Button>
        }
      />

      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : projects.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="No completed projects yet"
          description="A project kickoff must be marked completed before a resource plan can be generated for it."
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Project</TableHead>
                  <TableHead>Order</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead className="text-right">Benchmark</TableHead>
                  <TableHead className="text-right">Negotiated</TableHead>
                  <TableHead className="text-right">Variance</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {projects.map((p) => (
                  <TableRow
                    key={p.projectKickoffId}
                    className={p.hasPlan ? 'cursor-pointer' : undefined}
                    onClick={
                      p.hasPlan
                        ? () =>
                            router.push(
                              `/scm/resource-plans/${p.projectKickoffId}`,
                            )
                        : undefined
                    }
                  >
                    <TableCell className="font-medium">
                      {p.projectName}
                      {p.hasPlan ? (
                        <Badge variant="success" className="ml-2">
                          Plan ready
                        </Badge>
                      ) : (
                        <Badge variant="muted" className="ml-2">
                          No plan
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>{p.orderNumber}</TableCell>
                    <TableCell>{p.customerName}</TableCell>
                    <TableCell className="text-right">
                      {p.hasPlan ? money(p.totalBenchmarkCost) : '—'}
                    </TableCell>
                    <TableCell className="text-right">
                      {p.hasPlan ? money(p.totalNegotiatedCost) : '—'}
                    </TableCell>
                    <TableCell className="text-right">
                      {p.hasPlan ? (
                        <span className={varianceToneClass(p.varianceAmount)}>
                          {signedVariance(p.varianceAmount, money)}
                          {p.variancePercent !== null && (
                            <span className="text-xs">
                              {' '}
                              ({Number(p.variancePercent) > 0 ? '+' : ''}
                              {p.variancePercent}%)
                            </span>
                          )}
                        </span>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {canGenerate ? (
                        <Button
                          size="sm"
                          variant={p.hasPlan ? 'outline' : 'default'}
                          disabled={generatingId === p.projectKickoffId}
                          onClick={(e) => {
                            e.stopPropagation();
                            void onGenerate(p);
                          }}
                        >
                          {generatingId === p.projectKickoffId
                            ? 'Working…'
                            : p.hasPlan
                              ? 'Regenerate'
                              : 'Generate'}
                        </Button>
                      ) : p.hasPlan ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={(e) => {
                            e.stopPropagation();
                            router.push(
                              `/scm/resource-plans/${p.projectKickoffId}`,
                            );
                          }}
                        >
                          View
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          Awaiting SCM
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </PageContainer>
  );
}
