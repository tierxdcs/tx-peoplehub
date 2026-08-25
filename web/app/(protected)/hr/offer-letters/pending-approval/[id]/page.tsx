'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { apiFetch, ApiError } from '../../../../../lib/api';
import {
  SCard,
  SignalHeader,
  SignalPage,
} from '../../../../../components/ui/signal';
import { Button } from '../../../../../components/ui/button';
import { Field } from '../../../../../components/ui/field';
import { Textarea } from '../../../../../components/ui/textarea';
import { Skeleton } from '../../../../../components/ui/skeleton';
import { useToast } from '../../../../../components/ui/toaster';
import { useConfirm } from '../../../../../components/ui/confirm';
import { useAuth } from '../../../../../lib/auth-context';
import {
  OfferLetterDocument,
  OfferLetterPrintDocument,
} from '../../_components/offer-letter-print-document';

/**
 * The vertical owner's review-and-decide surface for one submitted offer
 * letter. Renders the FROZEN snapshot (exactly what will download on approval)
 * and lets the owner approve or reject. A rejection comment is required; the
 * approve comment is optional.
 */
export default function OfferLetterReviewPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params.id;
  const toast = useToast();
  const confirm = useConfirm();
  const { user } = useAuth();

  const [offer, setOffer] = useState<OfferLetterDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  const [acting, setActing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setForbidden(false);
    setError(null);
    try {
      const res = await apiFetch<OfferLetterDocument>(
        `/offer-letters/${id}/review`,
      );
      setOffer(res);
    } catch (err) {
      if (err instanceof ApiError && err.statusCode === 403) {
        setForbidden(true);
      } else if (err instanceof ApiError && err.statusCode === 404) {
        setError('This offer letter no longer exists.');
      } else {
        setError('Failed to load the offer letter');
      }
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(action: 'approve' | 'reject') {
    if (action === 'reject' && !comment.trim()) {
      toast.error('A comment is required when rejecting.');
      return;
    }
    // Whether *this* approval finalises the letter or only forwards it. The CEO
    // (SUPER_ADMIN) always gives the final sign-off — either at the CEO stage or
    // clearing an owner-less vertical-stage fallback. A vertical owner acting at
    // the first stage merely forwards it to the CEO.
    const finalises =
      user?.role === 'SUPER_ADMIN' ||
      offer?.status === 'PENDING_CEO_APPROVAL';
    const ok = await confirm(
      action === 'approve'
        ? finalises
          ? {
              title: 'Give final approval to this offer letter?',
              description:
                'It will be marked APPROVED and become downloadable by HR.',
            }
          : {
              title: 'Approve and forward to the CEO?',
              description:
                'Your first-stage approval will be recorded and the letter forwarded to the CEO for final sign-off. It is not downloadable until the CEO approves.',
            }
        : {
            title: 'Reject this offer letter?',
            description:
              'It will return to the author as REJECTED with your comment.',
            destructive: true,
          },
    );
    if (!ok) return;
    setActing(true);
    try {
      await apiFetch(`/offer-letters/${id}/${action}`, {
        method: 'POST',
        body: JSON.stringify({ approverComments: comment.trim() || undefined }),
      });
      toast.success(
        action === 'approve'
          ? finalises
            ? 'Offer letter approved.'
            : 'Approved and forwarded to the CEO.'
          : 'Offer letter rejected.',
      );
      router.push('/hr/offer-letters/pending-approval');
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : `Failed to ${action}`,
      );
      setActing(false);
    }
  }

  if (forbidden) {
    return (
      <SignalPage>
        <SignalHeader
          backHref="/hr/offer-letters/pending-approval"
          backLabel="Approval Queue"
          title="Offer Letter Review"
        />
        <div className="space-y-4 px-5 pb-7 pt-[18px] lg:px-7">
          <SCard className="p-6 text-sm text-muted-foreground">
            You are not authorized to review this offer letter. Only the new
            hire’s vertical owner or the CEO may act on it.
          </SCard>
        </div>
      </SignalPage>
    );
  }

  return (
    <SignalPage>
      {/* The frozen document is rendered for the on-screen preview; the shared
          @media print CSS scopes actual printing to .print-document. */}
      <SignalHeader
        backHref="/hr/offer-letters/pending-approval"
        backLabel="Approval Queue"
        title="Review Offer Letter"
        description="Review the submitted offer letter below, then approve or reject. This is exactly the document that will be issued on approval."
      />
      <div className="space-y-4 px-5 pb-7 pt-[18px] lg:px-7">
        {loading ? (
          <Skeleton className="h-96 w-full" />
        ) : error ? (
          <SCard className="p-6 text-sm text-destructive">{error}</SCard>
        ) : offer ? (
          <>
            <SCard className="space-y-4 p-6">
              <div>
                <h2 className="text-base font-semibold">Approval decision</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Review the submitted document below, then record your decision
                  here. Your approval forwards it to the CEO for final sign-off.
                </p>
              </div>
              <Field
                label="Comment"
                hint="Required to reject; optional to approve"
              >
                <Textarea
                  rows={4}
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="Add a note for the author…"
                />
              </Field>
              <div className="flex flex-wrap justify-end gap-3">
                <Button
                  variant="destructive"
                  disabled={acting}
                  onClick={() => void act('reject')}
                >
                  Reject
                </Button>
                <Button disabled={acting} onClick={() => void act('approve')}>
                  Approve
                </Button>
              </div>
            </SCard>

            <SCard className="p-6">
              <div className="mx-auto max-w-4xl">
                <OfferLetterPrintDocument offer={offer} preview />
              </div>
            </SCard>
          </>
        ) : null}
      </div>
    </SignalPage>
  );
}
