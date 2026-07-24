'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, CalendarDays, Plus, UserRound } from 'lucide-react';
import { apiFetch, ApiError } from '../../../../lib/api';
import {
  Bid,
  BidDecisionAssessment,
  Opportunity,
  OpportunityStage,
  PaginatedResult,
} from '../../../../lib/types';
import { formatINR, prettyEnum } from '../../../../lib/sales';
import { deriveBidGate } from '../../../../lib/bid-assessment';
import { PageContainer } from '../../../../components/ui/page-container';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '../../../../components/ui/card';
import { Badge } from '../../../../components/ui/badge';
import { Button } from '../../../../components/ui/button';
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
      <PageContainer>
        <Skeleton className="mb-4 h-6 w-32" />
        <Skeleton className="mb-6 h-9 w-80" />
        <Skeleton className="h-48 w-full" />
      </PageContainer>
    );
  }
  if (error || !opp) {
    return (
      <PageContainer>
        <p className="text-destructive">{error ?? 'Opportunity not found'}</p>
      </PageContainer>
    );
  }

  // Gate state is derived from the most-recent assessment (assessments are
  // returned most-recent-first).
  const gate = deriveBidGate(assessments[0]);

  return (
    <PageContainer>
      <Link
        href="/sales/opportunities"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Opportunities
      </Link>

      {/* Header: opportunity name as title */}
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">{opp.name}</h1>
        <BusinessUnitLabel
          className="mt-2"
          name={opp.businessUnitName}
          colorHex={opp.businessUnitColorHex}
        />
      </div>

      {/* Metadata card: Stage / Estimated value / Expected close */}
      <Card className="mb-4">
        <CardContent className="grid gap-6 p-6 sm:grid-cols-4">
          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Stage
            </div>
            <div className="mt-1.5">
              <StatusBadge value={opp.stage} />
            </div>
          </div>
          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Owner
            </div>
            <div className="mt-1 flex items-center gap-2 text-sm font-medium">
              <UserRound className="size-4 text-muted-foreground" />
              {opp.ownerName}
            </div>
          </div>
          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Estimated value
            </div>
            <div className="mt-1 text-2xl font-semibold">
              {formatINR(opp.estimatedValue)}
            </div>
          </div>
          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Expected close
            </div>
            <div className="mt-1 flex items-center gap-2 text-sm font-medium">
              <CalendarDays className="size-4 text-muted-foreground" />
              {opp.expectedCloseDate.slice(0, 10)}
            </div>
          </div>
        </CardContent>
      </Card>

      {opp.lostReason && (
        <Card className="mb-4">
          <CardHeader>
            <CardTitle className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
              Lost reason
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <p className="whitespace-pre-wrap text-sm">{opp.lostReason}</p>
          </CardContent>
        </Card>
      )}

      {/* Update stage — compact form card */}
      <Card className="mb-6 max-w-[400px]">
        <CardHeader>
          <CardTitle>Update stage</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 pt-0">
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
        </CardContent>
      </Card>

      {/* Bids section: header reflects the Bid/No-Bid gate state */}
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle>Bids</CardTitle>
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
        </CardHeader>
        <CardContent className="pt-0">
          {/* Rejection context surfaced inline, not hidden behind a click. */}
          {gate.state === 'REJECTED' && gate.comments && (
            <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
              <span className="font-semibold">Reviewer comments:</span>{' '}
              {gate.comments}
            </div>
          )}
          {/* Reviewer's e-signature once the assessment is approved. */}
          {gate.state === 'APPROVED' && assessments[0] && (
            <div className="mb-4 rounded-md border border-success/40 bg-success/10 p-3">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Approved by
              </div>
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
                    {formatINR(b.grandTotal)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Link
                      href={`/sales/bids/${b.id}`}
                      className="text-primary underline-offset-4 hover:underline"
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
        </CardContent>
      </Card>

      <BidAssessmentDialog
        opportunityId={opp.id}
        open={assessmentDialogOpen}
        onOpenChange={setAssessmentDialogOpen}
        onSubmitted={load}
        priorRejectionComments={
          gate.state === 'REJECTED' ? gate.comments : null
        }
      />
    </PageContainer>
  );
}
