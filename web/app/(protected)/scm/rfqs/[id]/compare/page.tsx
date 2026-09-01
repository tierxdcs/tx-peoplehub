'use client';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../../../components/ui/table';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Lock } from 'lucide-react';
import { ApiError } from '../../../../../lib/api';
import {
  rfqComparison,
  awardRfq,
  type RfqComparison,
  type ComparisonColumn,
} from '../../../../../lib/rfq';
import { formatINR } from '../../../../../lib/sales';
import { dateOnlyStr } from '../../../../../lib/date';
import { useNumberFormat } from '../../../../../lib/number-format-context';
import { humanizeEnum } from '../../../../../lib/status';
import { PageContainer } from '../../../../../components/ui/page-container';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '../../../../../components/ui/card';
import { Button } from '../../../../../components/ui/button';
import { Input } from '../../../../../components/ui/input';
import { Field } from '../../../../../components/ui/field';
import { Textarea } from '../../../../../components/ui/textarea';
import { Skeleton } from '../../../../../components/ui/skeleton';
import { StatusBadge } from '../../../../../components/ui/status-badge';
import { EmptyState } from '../../../../../components/ui/empty-state';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../../../components/ui/dialog';
import { useToast } from '../../../../../components/ui/toaster';

const DEFAULT_WEIGHTS = { price: 60, leadTime: 20, qualification: 20 };

export default function RfqComparePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const { style: numberFormatStyle } = useNumberFormat();

  const [comparison, setComparison] = useState<RfqComparison | null>(null);
  const [loading, setLoading] = useState(true);
  const [sealed, setSealed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [weights, setWeights] = useState(DEFAULT_WEIGHTS);

  // Award dialog state.
  const [awardTarget, setAwardTarget] = useState<ComparisonColumn | null>(null);
  const [justification, setJustification] = useState('');
  const [awarding, setAwarding] = useState(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchComparison = useCallback(
    async (w: typeof DEFAULT_WEIGHTS) => {
      try {
        const data = await rfqComparison(id, w);
        setComparison(data);
        setSealed(false);
        setError(null);
      } catch (err) {
        if (err instanceof ApiError && err.statusCode === 400) {
          setSealed(true);
        } else {
          setError('Failed to load comparison.');
        }
      } finally {
        setLoading(false);
      }
    },
    [id],
  );

  // Initial load.
  useEffect(() => {
    void fetchComparison(DEFAULT_WEIGHTS);
  }, [fetchComparison]);

  // Debounced re-fetch when weights change.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void fetchComparison(weights);
    }, 400);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weights]);

  function openAward(col: ComparisonColumn) {
    setAwardTarget(col);
    setJustification('');
  }

  async function confirmAward() {
    if (!awardTarget) return;
    const needsJustification = !awardTarget.isLowestTotal;
    if (needsJustification && !justification.trim()) {
      toast.error('A justification is required to award a non-lowest quote.');
      return;
    }
    setAwarding(true);
    try {
      const res = await awardRfq(
        id,
        awardTarget.inviteeId,
        justification.trim() || undefined,
      );
      toast.success(
        `Awarded — PO ${res.purchaseOrderId} created.`,
        'RFQ awarded',
      );
      setAwardTarget(null);
      router.push(`/stores/purchase-orders/${res.purchaseOrderId}`);
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : 'Failed to award RFQ',
      );
      setAwarding(false);
    }
  }

  if (loading) {
    return (
      <PageContainer>
        <Skeleton className="mb-4 h-8 w-64" />
        <Skeleton className="h-64 w-full" />
      </PageContainer>
    );
  }

  if (sealed) {
    return (
      <PageContainer>
        <BackLink id={id} />
        <Card>
          <CardContent className="p-0">
            <EmptyState
              icon={Lock}
              title="Quotes are sealed"
              description="Quotes are sealed until the RFQ closes."
            />
          </CardContent>
        </Card>
      </PageContainer>
    );
  }

  if (error || !comparison) {
    return (
      <PageContainer>
        <p className="text-sm text-destructive">{error ?? 'Not found.'}</p>
        <Button
          variant="outline"
          className="mt-4"
          onClick={() => router.push(`/scm/rfqs/${id}`)}
        >
          <ArrowLeft className="size-4" /> Back
        </Button>
      </PageContainer>
    );
  }

  const cols = comparison.columns;

  return (
    <PageContainer>
      <BackLink id={id} rfqNumber={comparison.rfqNumber} />

      <div className="mb-6 flex items-start justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">
          Compare &amp; Award — {comparison.rfqNumber}
        </h1>
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">Scoring Weights</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-3">
            {(['price', 'leadTime', 'qualification'] as const).map((k) => (
              <Field
                key={k}
                label={
                  k === 'price'
                    ? 'Price'
                    : k === 'leadTime'
                      ? 'Lead Time'
                      : 'Qualification'
                }
              >
                <Input
                  type="number"
                  min="0"
                  step="1"
                  value={weights[k]}
                  onChange={(e) =>
                    setWeights((w) => ({
                      ...w,
                      [k]: Number(e.target.value) || 0,
                    }))
                  }
                />
              </Field>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Quote Comparison</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <Table className="w-full border-collapse text-sm">
            <TableHeader>
              <TableRow className="border-b">
                <TableHead className="p-3 text-left font-medium text-muted-foreground">
                  Item
                </TableHead>
                {cols.map((c) => (
                  <TableHead
                    key={c.inviteeId}
                    className={`p-3 text-right font-medium ${c.nonResponder ? 'text-muted-foreground' : ''}`}
                  >
                    <div>{c.partnerName ?? '—'}</div>
                    <div className="text-xs font-normal text-muted-foreground">
                      {humanizeEnum(c.partnerType)}
                    </div>
                    <div className="mt-1 flex items-center justify-end gap-1.5">
                      <StatusBadge value={c.quoteStatus} />
                      {/* Which revision this column's figures come from. */}
                      {c.revisionNumber != null && c.revisionNumber > 1 && (
                        <span
                          className="rounded bg-muted px-1.5 py-0.5 text-xs font-medium"
                          title="Negotiated revision — the latest quote this partner submitted"
                        >
                          Rev {c.revisionNumber}
                        </span>
                      )}
                    </div>
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {/* Per-line unit prices */}
              {comparison.lines.map((line) => (
                <TableRow key={line.rfqLineId} className="border-b">
                  <TableCell className="p-3">
                    <div className="font-medium">{line.itemName ?? '—'}</div>
                    <div className="text-xs text-muted-foreground">
                      {line.itemCode ?? ''} · {line.quantity}{' '}
                      {line.unitOfMeasure}
                    </div>
                  </TableCell>
                  {cols.map((c) => {
                    if (c.nonResponder) return <MutedCell key={c.inviteeId} />;
                    const ql = c.lines.find(
                      (l) => l.rfqLineId === line.rfqLineId,
                    );
                    return (
                      <TableCell
                        key={c.inviteeId}
                        className={`p-3 text-right ${ql?.isLowestUnitPrice ? 'font-medium text-success' : ''}`}
                      >
                        {formatINR(ql?.unitPrice ?? null, numberFormatStyle)}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}

              {/* Summary rows */}
              <SummaryRow label="Total quoted" cols={cols}>
                {(c) => (
                  <span
                    className={
                      c.isLowestTotal ? 'font-medium text-success' : ''
                    }
                  >
                    {formatINR(c.totalQuotedValue, numberFormatStyle)}
                  </span>
                )}
              </SummaryRow>
              <SummaryRow label="Variance vs lowest" cols={cols}>
                {(c) =>
                  c.variancePctVsLowest != null
                    ? `${Number(c.variancePctVsLowest).toFixed(1)}%`
                    : '—'
                }
              </SummaryRow>
              <SummaryRow label="Lead time (days)" cols={cols}>
                {(c) =>
                  c.quotedLeadTimeDays == null ? (
                    '—'
                  ) : c.leadTimeFromLines ? (
                    // Derived from the per-line figures: the slowest line, since
                    // the order is not complete until it lands. Marked, because a
                    // buyer should know the vendor never stated an overall one.
                    <span
                      title="Slowest per-line delivery lead time — the vendor left the overall lead time blank"
                      className="underline decoration-dotted underline-offset-2"
                    >
                      {c.quotedLeadTimeDays}
                    </span>
                  ) : (
                    String(c.quotedLeadTimeDays)
                  )
                }
              </SummaryRow>
              <SummaryRow
                label="Qualification"
                cols={cols}
                responderRender={(c) => (
                  <StatusBadge value={c.qualificationStatusSnapshot} />
                )}
              />
              <SummaryRow label="Payment terms" cols={cols}>
                {(c) => c.paymentTermsOffered ?? '—'}
              </SummaryRow>
              <SummaryRow label="Validity (days)" cols={cols}>
                {(c) => (c.validityDays != null ? String(c.validityDays) : '—')}
              </SummaryRow>
              {/* Negotiation trail. Only rendered when someone actually
                  revised — every figure above is the latest revision, and each
                  earlier one is kept in full, never overwritten. */}
              {cols.some((c) => c.revisions.length > 1) && (
                <SummaryRow label="Quote revisions" cols={cols}>
                  {(c) =>
                    c.revisions.length > 1 ? (
                      <div className="space-y-0.5">
                        {c.revisions.map((rev, i) => (
                          <div
                            key={rev.revisionNumber}
                            className={
                              i === 0
                                ? 'text-xs font-medium'
                                : 'text-xs text-muted-foreground line-through'
                            }
                          >
                            Rev {rev.revisionNumber}:{' '}
                            {formatINR(rev.totalQuotedValue, numberFormatStyle)}
                            {rev.submittedAt
                              ? ` · ${dateOnlyStr(rev.submittedAt)}`
                              : ''}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        Original only
                      </span>
                    )
                  }
                </SummaryRow>
              )}
              <SummaryRow label="Weighted score" cols={cols}>
                {(c) => (
                  <span className="font-medium">
                    {c.weightedScore != null
                      ? Number(c.weightedScore).toFixed(1)
                      : '—'}
                  </span>
                )}
              </SummaryRow>

              {/* Non-responder decline reasons + award actions */}
              <TableRow className="border-b bg-muted/30">
                <TableCell className="p-3 font-medium">Decision</TableCell>
                {cols.map((c) => (
                  <TableCell
                    key={c.inviteeId}
                    className="p-3 text-right align-top"
                  >
                    {c.nonResponder ? (
                      <span className="text-xs text-muted-foreground">
                        {c.declineReason
                          ? `Declined: ${c.declineReason}`
                          : 'No response'}
                      </span>
                    ) : c.quoteStatus === 'SUBMITTED' ? (
                      <Button
                        size="sm"
                        variant={c.isLowestTotal ? 'default' : 'outline'}
                        onClick={() => openAward(c)}
                      >
                        Award
                      </Button>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                ))}
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog
        open={awardTarget != null}
        onOpenChange={(o) => !o && setAwardTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Award to {awardTarget?.partnerName ?? 'partner'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Awarding creates a purchase order from this quote.
              {awardTarget?.revisionNumber != null &&
                awardTarget.revisionNumber > 1 && (
                  <>
                    {' '}
                    The PO is drafted from{' '}
                    <span className="font-medium text-foreground">
                      Revision {awardTarget.revisionNumber}
                    </span>
                    , the negotiated quote.
                  </>
                )}
              {awardTarget && !awardTarget.isLowestTotal && (
                <>
                  {' '}
                  This is{' '}
                  <span className="font-medium text-warning">
                    not the lowest total
                  </span>{' '}
                  — a justification is required.
                </>
              )}
            </p>
            <Field
              label="Justification"
              required={awardTarget != null && !awardTarget.isLowestTotal}
            >
              <Textarea
                value={justification}
                onChange={(e) => setJustification(e.target.value)}
                placeholder="Reason for this award decision"
              />
            </Field>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setAwardTarget(null)}
              disabled={awarding}
            >
              Cancel
            </Button>
            <Button onClick={confirmAward} disabled={awarding}>
              {awarding ? 'Awarding…' : 'Confirm Award'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}

function BackLink({ id, rfqNumber }: { id: string; rfqNumber?: string }) {
  return (
    <div className="mb-4">
      <Link
        href={`/scm/rfqs/${id}`}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> {rfqNumber ?? 'RFQ'}
      </Link>
    </div>
  );
}

function MutedCell() {
  return (
    <TableCell className="p-3 text-right text-muted-foreground">—</TableCell>
  );
}

/**
 * A summary row. `children` renders responder cells; non-responder cells are
 * muted "—" unless `responderRender` handles them (still muted for non-responders).
 */
function SummaryRow({
  label,
  cols,
  children,
  responderRender,
}: {
  label: string;
  cols: ComparisonColumn[];
  children?: (c: ComparisonColumn) => React.ReactNode;
  responderRender?: (c: ComparisonColumn) => React.ReactNode;
}) {
  const render = responderRender ?? children ?? (() => '—');
  return (
    <TableRow className="border-b">
      <TableCell className="p-3 text-muted-foreground">{label}</TableCell>
      {cols.map((c) =>
        c.nonResponder ? (
          <MutedCell key={c.inviteeId} />
        ) : (
          <TableCell key={c.inviteeId} className="p-3 text-right">
            {render(c)}
          </TableCell>
        ),
      )}
    </TableRow>
  );
}
