import type {
  BidAssessmentQuestion,
  BidDecisionAssessment,
} from './types';

/**
 * Single source of truth for how the *latest* Bid/No-Bid assessment maps to
 * the Opportunity page's gate UI. Kept here (not inline per-page) so the
 * button/badge mapping can't drift between screens.
 *
 * `latest` is the most-recent assessment for the opportunity (or undefined if
 * none submitted yet).
 */
export type BidGateState =
  | 'NONE' // nothing submitted → offer "Submit Assessment"
  | 'PENDING_REVIEW' // awaiting the Sales Head → info badge, no create
  | 'REJECTED' // rejected → red badge + comments + "Resubmit"
  | 'APPROVED'; // approved → green badge + enabled "Create Bid"

export interface BidGateView {
  state: BidGateState;
  badgeLabel: string | null;
  badgeVariant: 'info' | 'destructive' | 'success' | null;
  /** Reviewer comments to surface inline (rejection context). */
  comments: string | null;
  canCreateBid: boolean;
  /** Label for the primary action button, or null when none applies. */
  actionLabel: 'Submit Bid/No-Bid Assessment' | 'Resubmit Assessment' | null;
}

export function deriveBidGate(
  latest: BidDecisionAssessment | undefined,
): BidGateView {
  if (!latest) {
    return {
      state: 'NONE',
      badgeLabel: null,
      badgeVariant: null,
      comments: null,
      canCreateBid: false,
      actionLabel: 'Submit Bid/No-Bid Assessment',
    };
  }
  switch (latest.status) {
    case 'PENDING_REVIEW':
      return {
        state: 'PENDING_REVIEW',
        badgeLabel: 'Assessment pending review',
        badgeVariant: 'info',
        comments: null,
        canCreateBid: false,
        actionLabel: null,
      };
    case 'REJECTED':
      return {
        state: 'REJECTED',
        badgeLabel: 'Assessment rejected',
        badgeVariant: 'destructive',
        comments: latest.reviewerComments,
        canCreateBid: false,
        actionLabel: 'Resubmit Assessment',
      };
    case 'APPROVED':
      return {
        state: 'APPROVED',
        badgeLabel: 'Assessment approved ✓',
        badgeVariant: 'success',
        comments: null,
        canCreateBid: true,
        actionLabel: null,
      };
  }
}

/** A safe default answer for a question type (used to init form state). */
export function emptyAnswer(): string {
  return '';
}

/** 1–5 scale options rendered by SCALE questions. */
export const SCALE_OPTIONS = ['1', '2', '3', '4', '5'] as const;

/**
 * Client-side "all active questions answered" check, mirroring the backend
 * rule so the rep learns about a blank before submitting, not from a 400.
 * Returns the ids of questions still blank.
 */
export function unansweredQuestionIds(
  questions: BidAssessmentQuestion[],
  answers: Record<string, string>,
): string[] {
  return questions
    .filter((q) => !answers[q.id] || answers[q.id].trim() === '')
    .map((q) => q.id);
}
