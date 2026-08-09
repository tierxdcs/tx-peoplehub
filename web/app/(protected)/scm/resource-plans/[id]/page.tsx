'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { useAuth } from '../../../../lib/auth-context';
import { ApiError } from '../../../../lib/api';
import {
  generateResourcePlan,
  getResourcePlan,
  updateResourcePlanLine,
  varianceToneClass,
  signedVariance,
  type ResourcePlan,
  type ResourcePlanLine,
} from '../../../../lib/scm-resource-plan';
import { formatINR } from '../../../../lib/sales';
import { useNumberFormat } from '../../../../lib/number-format-context';
import { PageContainer } from '../../../../components/ui/page-container';
import { PageHeader } from '../../../../components/ui/page-header';
import { Card, CardContent } from '../../../../components/ui/card';
import { Button } from '../../../../components/ui/button';
import { Input } from '../../../../components/ui/input';
import { Skeleton } from '../../../../components/ui/skeleton';
import { useToast } from '../../../../components/ui/toaster';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../../components/ui/table';

/**
 * SCM Resource Planning — per-project view (§4). Line-item table with an
 * editable negotiated price + note per line (blur-saves only when changed), and
 * a project summary comparing total benchmark vs. negotiated cost. Cost
 * increases render destructive, savings render success — the system-wide delta
 * convention.
 */
export default function ResourcePlanDetailPage() {
  const params = useParams<{ id: string }>();
  const kickoffId = params.id;
  const router = useRouter();
  const { user } = useAuth();
  const toast = useToast();
  const { style: numberFormatStyle } = useNumberFormat();
  const [plan, setPlan] = useState<ResourcePlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [regenerating, setRegenerating] = useState(false);

  const canEdit =
    user?.role === 'SUPER_ADMIN' ||
    user?.role === 'MANAGER' ||
    user?.role === 'EMPLOYEE';
  const canRegenerate =
    user?.role === 'SUPER_ADMIN' || user?.role === 'MANAGER';

  const money = useCallback(
    (v: string | number | null | undefined) => formatINR(v, numberFormatStyle),
    [numberFormatStyle],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setPlan(await getResourcePlan(kickoffId));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load plan.');
    } finally {
      setLoading(false);
    }
  }, [kickoffId]);

  useEffect(() => {
    void load();
  }, [load]);

  const applyLine = useCallback((updated: ResourcePlanLine) => {
    setPlan((prev) =>
      prev
        ? {
            ...prev,
            lines: prev.lines.map((l) => (l.id === updated.id ? updated : l)),
          }
        : prev,
    );
  }, []);

  // The summary totals are computed server-side; re-fetch after an edit so the
  // project summary reflects the new negotiated numbers.
  const refreshSummary = useCallback(async () => {
    try {
      const fresh = await getResourcePlan(kickoffId);
      if (fresh) setPlan(fresh);
    } catch {
      /* keep the optimistic line update; a full reload will reconcile */
    }
  }, [kickoffId]);

  async function onRegenerate() {
    setRegenerating(true);
    try {
      const fresh = await generateResourcePlan(kickoffId);
      setPlan(fresh);
      toast.success('Resource plan regenerated.');
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : 'Failed to regenerate.',
      );
    } finally {
      setRegenerating(false);
    }
  }

  if (loading) {
    return (
      <PageContainer>
        <Skeleton className="mb-4 h-10 w-64" />
        <Skeleton className="h-64 w-full" />
      </PageContainer>
    );
  }

  if (error) {
    return (
      <PageContainer>
        <p className="mb-4 text-sm text-destructive">{error}</p>
        <Button variant="outline" onClick={() => router.push('/scm/resource-plans')}>
          <ArrowLeft className="mr-1 h-4 w-4" /> Back to projects
        </Button>
      </PageContainer>
    );
  }

  if (!plan) {
    return (
      <PageContainer>
        <PageHeader
          title="No resource plan"
          description="This project does not have a resource plan yet. Generate one from the project list."
        />
        <Button variant="outline" onClick={() => router.push('/scm/resource-plans')}>
          <ArrowLeft className="mr-1 h-4 w-4" /> Back to projects
        </Button>
      </PageContainer>
    );
  }

  const s = plan.summary;

  return (
    <PageContainer>
      <PageHeader
        title={plan.projectName}
        description={`Order ${plan.orderNumber} · generated ${new Date(
          plan.generatedAt,
        ).toLocaleString()}${
          plan.generatedByName ? ` by ${plan.generatedByName}` : ''
        }`}
        action={
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => router.push('/scm/resource-plans')}
            >
              <ArrowLeft className="mr-1 h-4 w-4" /> Projects
            </Button>
            {canRegenerate && (
              <Button
                variant="outline"
                disabled={regenerating}
                onClick={() => void onRegenerate()}
              >
                {regenerating ? 'Regenerating…' : 'Regenerate'}
              </Button>
            )}
          </div>
        }
      />

      {/* Project summary */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <SummaryCard label="Total benchmark cost" value={money(s.totalBenchmarkCost)} />
        <SummaryCard
          label="Total negotiated cost"
          value={money(s.totalNegotiatedCost)}
          hint={`${s.negotiatedLineCount}/${s.lineCount} lines priced`}
        />
        <SummaryCard
          label="Variance"
          value={signedVariance(s.varianceAmount, money)}
          tone={varianceToneClass(s.varianceAmount)}
          hint={
            s.variancePercent !== null
              ? `${Number(s.variancePercent) > 0 ? '+' : ''}${s.variancePercent}%`
              : undefined
          }
        />
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead className="text-right">Required qty</TableHead>
                <TableHead className="text-right">Benchmark / unit</TableHead>
                <TableHead className="text-right">Negotiated / unit</TableHead>
                <TableHead className="text-right">Line variance</TableHead>
                <TableHead>Notes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {plan.lines.map((line) => (
                <PlanLineRow
                  key={line.id}
                  line={line}
                  canEdit={canEdit}
                  money={money}
                  onSaved={(updated) => {
                    applyLine(updated);
                    void refreshSummary();
                  }}
                  onError={(msg) => toast.error(msg)}
                />
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </PageContainer>
  );
}

function SummaryCard({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={`mt-1 text-lg font-semibold ${tone ?? ''}`}>{value}</p>
        {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

/**
 * One editable line. Negotiated price + note keep local draft state and save on
 * blur only when the value actually changed (mirrors the kickoff delivery-item
 * inline-save idiom). An empty price field clears the negotiated price (sends
 * null), reverting the line to benchmark-only.
 */
function PlanLineRow({
  line,
  canEdit,
  money,
  onSaved,
  onError,
}: {
  line: ResourcePlanLine;
  canEdit: boolean;
  money: (v: string | number | null | undefined) => string;
  onSaved: (updated: ResourcePlanLine) => void;
  onError: (msg: string) => void;
}) {
  const [price, setPrice] = useState(line.negotiatedPricePerUnit ?? '');
  const [notes, setNotes] = useState(line.notes ?? '');
  const [saving, setSaving] = useState(false);

  // Re-sync local drafts when the line is replaced (e.g. after regenerate).
  useEffect(() => {
    setPrice(line.negotiatedPricePerUnit ?? '');
    setNotes(line.notes ?? '');
  }, [line.negotiatedPricePerUnit, line.notes]);

  async function savePrice() {
    const trimmed = price.trim();
    const original = line.negotiatedPricePerUnit ?? '';
    if (trimmed === original) return;
    if (trimmed !== '' && (Number.isNaN(Number(trimmed)) || Number(trimmed) < 0)) {
      onError('Negotiated price must be a non-negative number.');
      setPrice(original);
      return;
    }
    setSaving(true);
    try {
      const updated = await updateResourcePlanLine(line.id, {
        negotiatedPricePerUnit: trimmed === '' ? null : Number(trimmed),
      });
      onSaved(updated);
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'Failed to save price.');
      setPrice(original);
    } finally {
      setSaving(false);
    }
  }

  async function saveNotes() {
    const original = line.notes ?? '';
    if (notes === original) return;
    setSaving(true);
    try {
      const updated = await updateResourcePlanLine(line.id, {
        notes: notes.trim() === '' ? null : notes,
      });
      onSaved(updated);
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'Failed to save note.');
      setNotes(original);
    } finally {
      setSaving(false);
    }
  }

  return (
    <TableRow>
      <TableCell>
        <div className="font-medium">{line.itemName}</div>
        <div className="text-xs text-muted-foreground">{line.itemCode}</div>
      </TableCell>
      <TableCell className="text-right align-top">
        {line.requiredQuantity}
        <span className="text-xs text-muted-foreground"> {line.unitOfMeasure}</span>
      </TableCell>
      <TableCell className="text-right align-top">
        {money(line.benchmarkCostPerUnit)}
        <div className="text-xs text-muted-foreground">
          = {money(line.benchmarkLineTotal)}
        </div>
      </TableCell>
      <TableCell className="text-right align-top">
        {canEdit ? (
          <Input
            type="number"
            min={0}
            step="0.01"
            value={price}
            placeholder="—"
            disabled={saving}
            onChange={(e) => setPrice(e.target.value)}
            onBlur={() => void savePrice()}
            className="h-8 w-28 text-right"
          />
        ) : line.negotiatedPricePerUnit !== null ? (
          money(line.negotiatedPricePerUnit)
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
        {line.negotiatedLineTotal !== null && (
          <div className="text-xs text-muted-foreground">
            = {money(line.negotiatedLineTotal)}
          </div>
        )}
      </TableCell>
      <TableCell className="text-right align-top">
        {line.varianceAmount !== null ? (
          <span className={varianceToneClass(line.varianceAmount)}>
            {signedVariance(line.varianceAmount, money)}
            {line.variancePercent !== null && (
              <div className="text-xs">
                {Number(line.variancePercent) > 0 ? '+' : ''}
                {line.variancePercent}%
              </div>
            )}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">not priced</span>
        )}
      </TableCell>
      <TableCell className="align-top">
        {canEdit ? (
          <Input
            value={notes}
            placeholder="Add a note…"
            disabled={saving}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={() => void saveNotes()}
            className="h-8 w-48"
          />
        ) : (
          <span className="text-sm text-muted-foreground">{line.notes ?? '—'}</span>
        )}
      </TableCell>
    </TableRow>
  );
}
