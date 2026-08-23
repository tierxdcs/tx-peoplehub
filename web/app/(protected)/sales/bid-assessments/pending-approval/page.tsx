'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiFetch, ApiError } from '../../../../lib/api';
import {
  BidDecisionAssessment,
  Opportunity,
  PaginatedResult,
} from '../../../../lib/types';
import { dateOnlyStr } from '../../../../lib/date';
import {
  SCard,
  SignalHeader,
  SignalPage,
} from '../../../../components/ui/signal';
import { Button } from '../../../../components/ui/button';
import { Textarea } from '../../../../components/ui/textarea';
import { Field } from '../../../../components/ui/field';
import { Skeleton } from '../../../../components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../../components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../../components/ui/dialog';
import { useToast } from '../../../../components/ui/toaster';
import { useConfirm } from '../../../../components/ui/confirm';
import { RegisterToolbar } from '../../../../components/ui/register-toolbar';
import { RegisterPagination } from '../../../../components/ui/register-pagination';
import { EmptyState } from '../../../../components/ui/empty-state';
import { ClipboardCheck } from 'lucide-react';
import { useRegisterList } from '../../../../lib/use-register-list';
import {
  employeeNameOrFallback,
  resolveEmployeeNames,
} from '../../../../lib/employee-name-resolution';

export default function BidAssessmentQueuePage() {
  const toast = useToast();
  const [items, setItems] = useState<BidDecisionAssessment[]>([]);
  const [oppNames, setOppNames] = useState<Record<string, string>>({});
  const [submitterNames, setSubmitterNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [selected, setSelected] = useState<BidDecisionAssessment | null>(null);
  const register = useRegisterList(items, (item) => `${oppNames[item.opportunityId] ?? item.opportunityId} ${employeeNameOrFallback(submitterNames, item.submittedById)} ${item.status} ${item.createdAt}`);

  const load = useCallback(async () => {
    setLoading(true);
    setForbidden(false);
    try {
      const res = await apiFetch<PaginatedResult<BidDecisionAssessment>>(
        '/bid-assessments/pending-approval?page=1&limit=100',
      );
      setItems(res.items);
      // Resolve opportunity names for display (best-effort; ignore failures).
      const names: Record<string, string> = {};
      await Promise.all(
        Array.from(new Set(res.items.map((a) => a.opportunityId))).map(
          async (oid) => {
            try {
              const opp = await apiFetch<Opportunity>(`/opportunities/${oid}`);
              names[oid] = opp.name;
            } catch {
              names[oid] = oid;
            }
          },
        ),
      );
      setOppNames(names);
      setSubmitterNames(
        await resolveEmployeeNames(res.items.map((a) => a.submittedById)),
      );
    } catch (err) {
      if (err instanceof ApiError && err.statusCode === 403) {
        setForbidden(true);
      } else {
        toast.error('Failed to load the approval queue');
      }
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  if (forbidden) {
    return (
      <SignalPage>
        <SignalHeader title="Bid/No-Bid Approvals" />
        <div className="space-y-4 px-5 pb-7 pt-[18px] lg:px-7">
          <SCard className="p-6 text-sm text-muted-foreground">
            This queue is visible only to the designated Sales Head and Super
            Admins.
          </SCard>
        </div>
      </SignalPage>
    );
  }

  return (
    <SignalPage>
      <SignalHeader
        title="Bid/No-Bid Approvals"
        description="Assessments awaiting your review. Approve to let the rep create a bid, or reject with feedback."
      />
      <div className="space-y-4 px-5 pb-7 pt-[18px] lg:px-7">
      <RegisterToolbar title="Approval Queue" search={register.search} onSearchChange={register.setSearch} searchPlaceholder="Search opportunity, requester or status" />

      <SCard className="overflow-hidden">
          {loading ? (
            <div className="p-4">
              <Skeleton className="h-40 w-full" />
            </div>
          ) : (
            <>
              <div className="space-y-3 p-3 md:hidden">
                {register.visibleItems.map((assessment) => (
                  <article
                    key={assessment.id}
                    className="space-y-3 rounded-lg border p-4"
                  >
                    <div>
                      <p className="font-medium">
                        {oppNames[assessment.opportunityId] ??
                          assessment.opportunityId}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {employeeNameOrFallback(submitterNames, assessment.submittedById)} · Submitted {dateOnlyStr(assessment.createdAt)}
                      </p>
                    </div>
                    <Button
                      className="w-full"
                      variant="outline"
                      onClick={() => setSelected(assessment)}
                    >
                      Review assessment
                    </Button>
                  </article>
                ))}
                {!register.visibleItems.length && <EmptyState icon={ClipboardCheck} title="No assessments pending review" tone="positive" />}
              </div>
              <div className="hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Opportunity</TableHead>
                      <TableHead>Submitted</TableHead>
                      <TableHead>Requester</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {register.visibleItems.map((a) => (
                      <TableRow key={a.id}>
                        <TableCell className="font-medium">
                          {oppNames[a.opportunityId] ?? a.opportunityId}
                        </TableCell>
                        <TableCell>{dateOnlyStr(a.createdAt)}</TableCell>
                        <TableCell>{employeeNameOrFallback(submitterNames, a.submittedById)}</TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setSelected(a)}
                          >
                            Review →
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                    {register.visibleItems.length === 0 && (
                      <TableRow>
                        <TableCell
                          colSpan={4}
                          className="p-0"
                        >
                          <EmptyState icon={ClipboardCheck} title="No assessments pending review" tone="positive" />
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
      </SCard>
      <RegisterPagination page={register.page} pageCount={register.pageCount} onPageChange={register.setPage} disabled={loading} />

      {selected && (
        <ReviewDialog
          assessment={selected}
          opportunityName={oppNames[selected.opportunityId]}
          onClose={() => setSelected(null)}
          onReviewed={() => {
            setSelected(null);
            void load();
          }}
        />
      )}
      </div>
    </SignalPage>
  );
}

function ReviewDialog({
  assessment,
  opportunityName,
  onClose,
  onReviewed,
}: {
  assessment: BidDecisionAssessment;
  opportunityName?: string;
  onClose: () => void;
  onReviewed: () => void;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const [comments, setComments] = useState('');
  const [acting, setActing] = useState(false);
  const [showRejectError, setShowRejectError] = useState(false);

  async function decide(action: 'approve' | 'reject') {
    // Comments required to reject — enforced here, not discovered via a 400.
    if (action === 'reject' && !comments.trim()) {
      setShowRejectError(true);
      return;
    }
    const ok = await confirm(
      action === 'approve'
        ? {
            title: 'Approve this assessment?',
            description:
              'The rep will be able to create a bid for this opportunity.',
          }
        : {
            title: 'Reject this assessment?',
            description: 'The rep will need to revise and resubmit.',
            destructive: true,
          },
    );
    if (!ok) return;
    setActing(true);
    try {
      await apiFetch(`/bid-assessments/${assessment.id}/${action}`, {
        method: 'PATCH',
        body: JSON.stringify({
          reviewerComments: comments.trim() || undefined,
        }),
      });
      toast.success(
        action === 'approve' ? 'Assessment approved' : 'Assessment rejected',
      );
      onReviewed();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : `Failed to ${action}`,
      );
    } finally {
      setActing(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="left-0 top-0 h-dvh max-h-dvh w-screen max-w-none translate-x-0 translate-y-0 rounded-none p-4 sm:left-1/2 sm:top-1/2 sm:h-auto sm:max-h-[90vh] sm:w-full sm:max-w-xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-lg sm:p-6">
        <DialogHeader>
          <DialogTitle>Review assessment</DialogTitle>
          <DialogDescription>
            {opportunityName ?? assessment.opportunityId}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {(assessment.responses ?? []).map((r) => (
            <div key={r.id} className="border-b pb-2 last:border-0">
              <div className="text-sm font-medium">
                {r.questionTextSnapshot}
              </div>
              <div className="mt-0.5 text-sm text-muted-foreground">
                {r.answerValue}
              </div>
            </div>
          ))}
        </div>

        <Field
          label="Reviewer comments"
          htmlFor="reviewerComments"
          hint="Required to reject; optional to approve."
          error={
            showRejectError && !comments.trim()
              ? 'A comment is required to reject'
              : null
          }
        >
          <Textarea
            id="reviewerComments"
            value={comments}
            onChange={(e) => {
              setComments(e.target.value);
              if (e.target.value.trim()) setShowRejectError(false);
            }}
            placeholder="Feedback for the rep…"
          />
        </Field>

        <DialogFooter>
          <Button
            variant="destructive"
            disabled={acting}
            onClick={() => decide('reject')}
          >
            Reject
          </Button>
          <Button disabled={acting} onClick={() => decide('approve')}>
            Approve
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
