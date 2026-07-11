'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from './auth-context';
import { apiFetch } from './api';

/**
 * Pending-approval counters surfaced as sidebar badges. Every key is always
 * present (0 when not applicable to the caller's role), so a `null` value
 * means "not loaded yet" rather than "no data".
 */
export interface PendingCounts {
  leaveApprovals: number;
  bidDiscountApprovals: number;
  bidAssessmentApprovals: number;
  hrPendingAccess: number;
  confirmationSheetsPending: number;
}

/**
 * Fetches the pending-approval counts for the current user and keeps them
 * fresh: polls every 60s and refetches when the window regains focus. A failed
 * fetch is swallowed (counts stay as-is) so a transient error never crashes the
 * layout — it just means the badges don't update. Only fetches for an
 * authenticated user.
 */
export function usePendingApprovalCounts(): { counts: PendingCounts | null } {
  const { user } = useAuth();
  const [counts, setCounts] = useState<PendingCounts | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    try {
      const res = await apiFetch<PendingCounts>('/notifications/pending-counts');
      setCounts(res);
    } catch {
      // Leave counts as-is; a failed fetch just means no badge update.
    }
  }, [user]);

  useEffect(() => {
    if (!user) {
      setCounts(null);
      return;
    }

    void load();

    const interval = setInterval(() => void load(), 60_000);
    const onFocus = () => void load();
    window.addEventListener('focus', onFocus);

    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', onFocus);
    };
  }, [user, load]);

  return { counts };
}
