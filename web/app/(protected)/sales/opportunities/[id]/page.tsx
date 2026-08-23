'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { CalendarDays, Plus, UserRound } from 'lucide-react';
import { apiFetch, ApiError } from '../../../../lib/api';
import {
  Bid,
  BidDecisionAssessment,
  Opportunity,
  OpportunityStage,
  PaginatedResult,
} from '../../../../lib/types';
import { formatINR, prettyEnum } from '../../../../lib/sales';
import { useNumberFormat } from '../../../../lib/number-format-context';
import { deriveBidGate } from '../../../../lib/bid-assessment';
import {
  SCard,
  SCardTitle,
  SIGNAL_EYEBROW,
  SIGNAL_LINK,
  SIGNAL_MUTED,
  SignalHeader,
  SignalPage,
} from '../../../../components/ui/signal';
import { Badge } from '../../../../components/ui/badge';
import { Button, buttonVariants } from '../../../../components/ui/button';
import { Select } from '../../../../components/ui/select';
import { Textarea } from '../../../../components/ui/textarea';
import { Field } from '../../../../components/ui/field';
import { Skeleton } from '../../../../components/ui/skeleton';
import { StatusBadge } from '../../../../components/ui/status-badge';
import { BusinessUnitLabel } from '../../../../components/ui/business-unit-label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../../components/ui/table';
import { BidAssessmentDialog } from '../../_components/bid-assessment-dialog';
import { useConfirm } from '../../../../components/ui/confirm';
import { SignatureDisplay } from '../../../../components/ui/signature-display';

const STAGES: OpportunityStage[] = [
  'PROSPECTING',
  'QUALIFICATION',
  'PROPOSAL',
  'NEGOTIATION',
  'CLOSED_WON',
  'CLOSED_LOST',
];

export default function OpportunityDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const confirm = useConfirm();
  const { style: numberFormatStyle } = useNumberFormat();
  const [opp, setOpp] = useState<Opportunity | null>(null);
  const [bids, setBids] = useState<Bid[]>([]);
  const [assessments, setAssessments] = useState<BidDecisionAssessment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [assessmentDialogOpen, setAssessmentDialogOpen] = useState(false);

  const [stage, setStage] = useState<OpportunityStage>('PROSPECTING');
  const [lostReason, setLostReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [oppRes, bidsRes, assessmentsRes] = await Promise.all([
        apiFetch<Opportunity>(`/opportunities/${id}`),
        apiFetch<PaginatedResult<Bid>>('/bids?page=1&limit=100'),
        apiFetch<BidDecisionAssessment[]>(
          `/opportunities/${id}/bid-assessments`,
        ),
      ]);
      setOpp(oppRes);
      setStage(oppRes.stage);
      setLostReason(oppRes.lostReason ?? '');
      setBids(bidsRes.items.filter((b) => b.opportunityId === id));
      setAssessments(assessmentsRes);
    } catch {
      setError('Failed to load opportunity');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function saveStage() {
    setSaveError(null);
    if (stage === 'CLOSED_LOST' && !lostReason.trim()) {
      setSaveError('A lost reason is required when closing as lost');
      return;
    }
    const ok = await confirm({
      title: 'Update opportunity stage?',
      description: `The stage will change to ${prettyEnum(stage)}.`,
      destructive: stage === 'CLOSED_LOST',
    });
    if (!ok) return;
    setSaving(true);
    try {
      await apiFetch(`/opportunities/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          stage,
          lostReason: stage === 'CLOSED_LOST' ? lostReason : undefined,
        }),
      });
      await load();
    } catch (err) {
      setSaveError(
        err instanceof ApiError ? err.message : 'Failed to update stage',
      );
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <SignalPage>
        <div className="px-5 py-[18px] lg:px-7">
          <Skeleton className="mb-4 h-6 w-32" />
          <Skeleton className="mb-6 h-9 w-80" />
          <Skeleton className="h-48 w-full" />
        </div>
      </SignalPage>
    );
  }
  if (error || !opp) {
    return (
      <SignalPage>
        <div className="px-5 py-[18px] lg:px-7">
          <p className="text-destructive">{error ?? 'Opportunity not found'}</p>
        </div>
      </SignalPage>
    );
  }

  // Gate state is derived from the most-recent assessment (assessments are
  // returned most-recent-first).
  const gate = deriveBidGate(assessments[0]);

  return (
    <SignalPage>
      <SignalHeader
        backHref="/sales/opportunities"
        backLabel="Opportunities"
        title={opp.name}
        chip={
          <BusinessUnitLabel
            name={opp.businessUnitName}
            colorHex={opp.businessUnitColorHex}
          />
        }
      />
      <div className="space-y-4 px-5 pb-7 pt-[18px] lg:px-7">

      {/* Metadata card: Stage / Estimated value / Expected close */}
      <SCard className="px-5 py-[18px]">
        <div className="grid gap-6 sm:grid-cols-4">
          <div>
            <div className={SIGNAL_EYEBROW}>Stage</div>
            <div className="mt-1.5">
              <StatusBadge value={opp.stage} />
            </div>
          </div>
          <div>
            <div className={SIGNAL_EYEBROW}>Owner</div>
            <div className="mt-1 flex items-center gap-2 text-sm font-medium">
              <UserRound className={`size-4 ${SIGNAL_MUTED}`} />
              {opp.ownerName}
            </div>
          </div>
          <div>
            <div className={SIGNAL_EYEBROW}>Estimated value</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums tracking-[-1px]">
              {formatINR(opp.estimatedValue, numberFormatStyle)}
            </div>
          </div>
          <div>
            <div className={SIGNAL_EYEBROW}>Expected close</div>
            <div className="mt-1 flex items-center gap-2 text-sm font-medium">
              <CalendarDays className={`size-4 ${SIGNAL_MUTED}`} />
              {opp.expectedCloseDate.slice(0, 10)}
            </div>
          </div>
        </div>
      </SCard>

      {opp.lostReason && (
        <SCard className="px-5 py-[18px]">
          <div className={SIGNAL_EYEBROW}>Lost reason</div>
          <p className="mt-2 whitespace-pre-wrap text-sm">{opp.lostReason}</p>
        </SCard>
      )}

      <SCard className="px-5 py-[18px]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <span className="text-[14px] font-bold">Customer BOM intake</span>
            <p className="mt-1 text-[12px] text-black/45 dark:text-white/45">
              Turn a customer file into traceable Items, a Product, and a
              quote-stage BOM for SCM sourcing.
            </p>
          </div>
          <Link
            className={buttonVariants()}
            href={`/sales/opportunities/${opp.id}/customer-bom-intake`}
          >
            Open BOM intake
          </Link>
        </div>
      </SCard>

      {/* Update stage — compact form card */}
      <SCard className="max-w-[400px] px-5 py-[18px]">
        <SCardTitle title="Update stage" />
        <div className="mt-3.5 space-y-3">
          <Select
            value={stage}
            onChange={(e) => setStage(e.target.value as OpportunityStage)}
          >
            {STAGES.map((s) => (
              <option key={s} value={s}>
                {prettyEnum(s)}
              </option>
            ))}
          </Select>
          {stage === 'CLOSED_LOST' && (
            <Field label="Reason for loss" htmlFor="lostReason" required>
              <Textarea
                id="lostReason"
                placeholder="Reason for loss (required)"
                value={lostReason}
                onChange={(e) => setLostReason(e.target.value)}
              />
            </Field>
          )}
          {saveError && <p className="text-sm text-destructive">{saveError}</p>}
          <Button onClick={saveStage} disabled={saving}>
            {saving ? 'Saving…' : 'Save stage'}
          </Button>
        </div>
      </SCard>

      {/* Bids section: header reflects the Bid/No-Bid gate state */}
      <SCard className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 px-5 pb-3.5 pt-[18px]">
          <span className="text-[14px] font-bold">Bids</span>
          <div className="flex items-center gap-2">
            {gate.badgeLabel && gate.badgeVariant && (
              <Badge variant={gate.badgeVariant}>{gate.badgeLabel}</Badge>
            )}
            {gate.actionLabel && (
              <Button onClick={() => setAssessmentDialogOpen(true)}>
                {gate.actionLabel}
              </Button>
            )}
            {gate.canCreateBid && (
              <Button
                onClick={() =>
                  router.push(`/sales/bids/new?opportunityId=${opp.id}`)
                }
              >
                <Plus /> Create Bid
              </Button>
            )}
          </div>
        </div>
          {/* Rejection context surfaced inline, not hidden behind a click. */}
          {gate.state === 'REJECTED' && gate.comments && (
            <div className="mx-5 mb-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
              <span className="font-semibold">Reviewer comments:</span>{' '}
              {gate.comments}
            </div>
          )}
          {/* Reviewer's e-signature once the assessment is approved. */}
          {gate.state === 'APPROVED' && assessments[0] && (
            <div className="mx-5 mb-4 rounded-md border border-success/40 bg-success/10 p-3">
              <div className={SIGNAL_EYEBROW}>Approved by</div>
              <div className="mt-1">
                <SignatureDisplay
                  text={assessments[0].approverSignatureTextSnapshot}
                  font={assessments[0].approverSignatureFontSnapshot}
                  date={
                    assessments[0].reviewedAt
                      ? assessments[0].reviewedAt.slice(0, 10)
                      : null
                  }
                />
              </div>
            </div>
          )}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Bid #</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bids.map((b) => (
                <TableRow key={b.id}>
                  <TableCell className="font-medium">{b.bidNumber}</TableCell>
                  <TableCell>
                    <StatusBadge value={b.status} />
                  </TableCell>
                  <TableCell className="text-right">
                    {formatINR(b.grandTotal, numberFormatStyle)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Link
                      href={`/sales/bids/${b.id}`}
                      className={SIGNAL_LINK}
                    >
                      View →
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
              {bids.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={4}
                    className="text-center text-muted-foreground"
                  >
                    No bids for this opportunity yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
      </SCard>

      <BidAssessmentDialog
        opportunityId={opp.id}
        open={assessmentDialogOpen}
        onOpenChange={setAssessmentDialogOpen}
        onSubmitted={load}
        priorRejectionComments={
          gate.state === 'REJECTED' ? gate.comments : null
        }
      />
      </div>
    </SignalPage>
  );
}
