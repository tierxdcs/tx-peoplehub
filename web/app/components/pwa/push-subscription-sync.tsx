'use client';

import { useEffect } from 'react';
import { syncExistingSubscription } from '../../lib/push';

/**
 * Re-registers this browser's existing push subscription with the API on load.
 *
 * This is the repair path for a rotated subscription. A browser can replace an
 * endpoint on its own (`pushsubscriptionchange`), and the service worker cannot
 * tell us — it has no access token. So the app does it here, where there is one:
 * silent, no prompt, and a no-op unless permission is already granted and a
 * subscription already exists.
 *
 * Mounted in the PROTECTED layout, not the root one, because it calls an
 * authenticated endpoint.
 */
export function PushSubscriptionSync() {
  useEffect(() => {
    // Nothing to tell the user either way: they never asked for this, and a
    // failure just means the next send prunes a dead endpoint instead.
    syncExistingSubscription().catch(() => undefined);
  }, []);

  return null;
}
