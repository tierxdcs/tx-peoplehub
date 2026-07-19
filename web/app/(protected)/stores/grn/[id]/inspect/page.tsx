'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, ShieldCheck, Lock, AlertTriangle, PackageX } from 'lucide-react';
import { ApiError } from '../../../../../lib/api';
import { useIsQcInspector } from '../../../../../lib/use-is-qc-inspector';
import {
  getGrn,
  finalizeQc,
  type GoodsReceiptNote,
  type QcInspectionLineInput,
} from '../../../../../lib/stores';
import { PageContainer } from '../../../../../components/ui/page-container';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '../../../../../components/ui/card';
import { Button } from '../../../../../components/ui/button';
import { Input } from '../../../../../components/ui/input';
import { Textarea } from '../../../../../components/ui/textarea';
import { Skeleton } from '../../../../../components/ui/skeleton';
import { StatusBadge } from '../../../../../components/ui/status-badge';
import { EmptyState } from '../../../../../components/ui/empty-state';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../../../components/ui/table';
import { useToast } from '../../../../../components/ui/toaster';
import { useConfirm } from '../../../../../components/ui/confirm';
import { GrnFlowIndicator } from '../../../_components/grn-flow-indicator';

interface Decision {
  accepted: string;
  rejected: string;
  reason: string;
}

/**
 * QC Inspection screen. Visible only to QC inspectors / SUPER_ADMIN. Per-line
 * accepted/rejected inputs + rejection remarks. The critical control — that
 * ONLY accepted quantity enters stock — is stated prominently and reinforced
 * per-line, never left implicit.
 */
export default function QcInspectionPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const { isQcInspector, loading: gateLoading } = useIsQcInspector();

  const [grn, setGrn] = useState<GoodsReceiptNote | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getGrn(id);
      setGrn(data);
      // Seed each line as fully accepted (the common case), inspector adjusts.
      const seed: Record<string, Decision> = {};
      for (const line of data.lines) {
        seed[line.id] = { accepted: line.receivedQuantity, rejected: '0', reason: '' };
      }
      setDecisions(seed);
    } catch {
      setError('Failed to load GRN.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  function updateDecision(lineId: string, patch: Partial<Decision>) {
    setDecisions((prev) => ({ ...prev, [lineId]: { ...prev[lineId], ...patch } }));
  }

  // Per-line validity: accepted + rejected must equal received; reason required
  // when rejecting.
  const lineErrors = useMemo(() => {
    const errs: Record<string, string> = {};
    if (!grn) return errs;
    for (const line of grn.lines) {
      const d = decisions[line.id];
      if (!d) continue;
      const acc = Number(d.accepted);
      const rej = Number(d.rejected);
      const rec = Number(line.receivedQuantity);
      if (Number.isNaN(acc) || Number.isNaN(rej) || acc < 0 || rej < 0) {
        errs[line.id] = 'Quantities must be non-negative numbers.';
      } else if (Math.abs(acc + rej - rec) > 1e-9) {
        errs[line.id] = `Accepted + rejected must equal received (${rec}).`;
      } else if (rej > 0 && !d.reason.trim()) {
        errs[line.id] = 'A rejection reason is required.';
      }
    }
    return errs;
  }, [grn, decisions]);

  const totals = useMemo(() => {
    let accepted = 0;
    let rejected = 0;
    for (const d of Object.values(decisions)) {
      accepted += Number(d.accepted) || 0;
      rejected += Number(d.rejected) || 0;
    }
    return { accepted, rejected };
  }, [decisions]);

  const canSubmit =
    !!grn &&
    grn.status === 'PENDING_QC' &&
    Object.keys(lineErrors).length === 0 &&
    !submitting;

  async function handleFinalize() {
    if (!grn || !canSubmit) return;
    const anyRejected = totals.rejected > 0;
    const ok = await confirm({
      title: 'Finalize QC inspection',
      description: anyRejected
        ? `${totals.accepted} will enter stock; ${totals.rejected} will be rejected and an NCR raised. This cannot be undone.`
        : `${totals.accepted} will enter stock. This cannot be undone.`,
      confirmLabel: 'Finalize & Update Stock',
    });
    if (!ok) return;
    setSubmitting(true);
    try {
      const lines: QcInspectionLineInput[] = grn.lines.map((line) => {
        const d = decisions[line.id];
        return {
          grnLineId: line.id,
          acceptedQuantity: Number(d.accepted),
          rejectedQuantity: Number(d.rejected),
          ...(Number(d.rejected) > 0 ? { rejectionReason: d.reason.trim() } : {}),
        };
      });
      const result = await finalizeQc(grn.id, lines);
      const ncrMsg = result.ncrs.length
        ? ` NCR ${result.ncrs.map((n) => n.ncrNumber).join(', ')} raised.`
        : '';
      toast.success(`QC finalized (${result.status.replace(/_/g, ' ')}).${ncrMsg}`);
      router.push(`/stores/grn/${grn.id}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to finalize QC');
      setSubmitting(false);
    }
  }

  if (gateLoading || loading) {
    return (
      <PageContainer>
        <Skeleton className="mb-4 h-8 w-64" />
        <Skeleton className="h-64 w-full" />
      </PageContainer>
    );
  }

  // isQcInspector gate — non-inspectors get a clear, non-actionable screen.
  if (!isQcInspector) {
    return (
      <PageContainer>
        <EmptyState
          icon={Lock}
          title="QC inspection is restricted"
          description="Only a designated QC Inspector (or a Super Admin) can inspect incoming goods and finalize the QC gate."
        />
        <div className="flex justify-center">
          <Button variant="outline" onClick={() => router.push(`/stores/grn/${id}`)}>
            <ArrowLeft className="size-4" /> Back to GRN
          </Button>
        </div>
      </PageContainer>
    );
  }

  if (error || !grn) {
    return (
      <PageContainer>
        <p className="text-sm text-destructive">{error ?? 'Not found.'}</p>
      </PageContainer>
    );
  }

  const alreadyInspected = grn.status !== 'PENDING_QC';

  return (
    <PageContainer className="max-w-5xl">
      <div className="mb-4">
        <Link href={`/stores/grn/${grn.id}`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> {grn.grnNumber}
        </Link>
      </div>
      <h1 className="mb-2 flex items-center gap-3 text-2xl font-semibold tracking-tight">
        <ShieldCheck className="size-6 text-primary" /> QC Inspection
        <StatusBadge value={grn.status} />
      </h1>

      <GrnFlowIndicator status={grn.status} className="my-6" />

      {alreadyInspected ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            This GRN has already been inspected (status {grn.status.replace(/_/g, ' ')}).
          </CardContent>
        </Card>
      ) : (
        <>
          {/* The critical control, stated unmistakably. */}
          <div className="mb-6 flex items-start gap-3 rounded-lg border border-primary/30 bg-primary/5 p-4">
            <PackageX className="mt-0.5 size-5 shrink-0 text-primary" />
            <div className="text-sm">
              <p className="font-semibold">Only the accepted quantity enters stock.</p>
              <p className="text-muted-foreground">
                Rejected quantity is <span className="font-medium">not</span> added to inventory —
                it automatically raises a Non-Conformance Report for disposition. Accepted +
                rejected must equal the received quantity on every line.
              </p>
            </div>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Inspect Lines</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead className="text-right">Received</TableHead>
                    <TableHead className="w-28 text-right">Accepted</TableHead>
                    <TableHead className="w-28 text-right">Rejected</TableHead>
                    <TableHead>Rejection Remarks</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {grn.lines.map((line) => {
                    const d = decisions[line.id];
                    const err = lineErrors[line.id];
                    const rejecting = Number(d?.rejected) > 0;
                    return (
                      <TableRow key={line.id}>
                        <TableCell>
                          <div className="font-medium">{line.itemName}</div>
                          <div className="text-xs text-muted-foreground">{line.itemCode}</div>
                          {err && (
                            <div className="mt-1 flex items-center gap-1 text-xs text-destructive">
                              <AlertTriangle className="size-3" /> {err}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          {line.receivedQuantity}
                        </TableCell>
                        <TableCell className="text-right">
                          <Input
                            type="number"
                            min="0"
                            step="any"
                            className="text-right"
                            value={d?.accepted ?? ''}
                            onChange={(e) => {
                              const accepted = e.target.value;
                              const rec = Number(line.receivedQuantity);
                              const acc = Number(accepted);
                              // Auto-fill rejected as the remainder for convenience.
                              const rejected = Number.isFinite(acc)
                                ? String(Math.max(0, +(rec - acc).toFixed(4)))
                                : d?.rejected ?? '0';
                              updateDecision(line.id, { accepted, rejected });
                            }}
                          />
                        </TableCell>
                        <TableCell className="text-right">
                          <Input
                            type="number"
                            min="0"
                            step="any"
                            className="text-right"
                            value={d?.rejected ?? ''}
                            onChange={(e) => updateDecision(line.id, { rejected: e.target.value })}
                            aria-invalid={!!err && rejecting}
                          />
                        </TableCell>
                        <TableCell>
                          <Textarea
                            className="min-h-[38px]"
                            placeholder={rejecting ? 'Required — why rejected?' : 'Optional'}
                            value={d?.reason ?? ''}
                            onChange={(e) => updateDecision(line.id, { reason: e.target.value })}
                          />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <div className="mt-6 flex items-center justify-between">
            <div className="text-sm">
              <span className="text-success">
                Entering stock: <span className="font-semibold">{totals.accepted}</span>
              </span>
              {totals.rejected > 0 && (
                <span className="ml-4 text-destructive">
                  Rejected (→ NCR): <span className="font-semibold">{totals.rejected}</span>
                </span>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => router.push(`/stores/grn/${grn.id}`)}>
                Cancel
              </Button>
              <Button onClick={handleFinalize} disabled={!canSubmit}>
                {submitting ? 'Finalizing…' : 'Finalize & Update Stock'}
              </Button>
            </div>
          </div>
        </>
      )}
    </PageContainer>
  );
}
