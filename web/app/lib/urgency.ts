import type { BadgeVariant } from '../components/ui/badge';

/**
 * ONE waiting-time escalation scale for the whole app.
 *
 * Pings established the original escalation: a PENDING ping crosses into
 * "overdue" at 24 hours (see ping-panel.tsx / the dashboard ping list, both of
 * which now read AGING_AFTER_HOURS from here instead of a local literal). Every
 * pending-approval badge reuses the same scale, so "amber" and "red" mean the
 * same elapsed time no matter which queue they appear on.
 *
 * Tiers:
 *   ok     — inside the normal waiting window
 *   aging  — past the 24h boundary Pings already escalates at
 *   stale  — three times that (72h): the queue isn't slow, it's stuck
 *
 * The 24h boundary is inherited from Pings verbatim. The 72h stale boundary is
 * a new number (3x aging) — Pings only ever had two tiers, so there was no
 * existing red threshold to inherit.
 */

/** Hours an item may wait before the badge turns amber. Pings' overdue line. */
export const AGING_AFTER_HOURS = 24;

/** Hours after which the badge turns red and pulses. 3x the aging boundary. */
export const STALE_AFTER_HOURS = AGING_AFTER_HOURS * 3;

export type UrgencyTier = 'ok' | 'aging' | 'stale';

/** Whole hours elapsed since `since`, floored at 0 (never negative). */
export function ageHours(since: Date | string, now: Date = new Date()): number {
  const from = since instanceof Date ? since : new Date(since);
  return Math.max(0, Math.floor((now.getTime() - from.getTime()) / 3_600_000));
}

/** The tier a given elapsed-hours figure falls into. */
export function urgencyTier(hours: number): UrgencyTier {
  if (hours >= STALE_AFTER_HOURS) return 'stale';
  if (hours >= AGING_AFTER_HOURS) return 'aging';
  return 'ok';
}

/**
 * Tier for a queue whose oldest item started waiting at `oldestPendingAt`.
 * A null/absent timestamp (empty queue, or a row with no submitted-at stamp)
 * is treated as 'ok' — never invent urgency from missing data.
 */
export function queueTier(
  oldestPendingAt: string | Date | null | undefined,
  now: Date = new Date(),
): UrgencyTier {
  if (!oldestPendingAt) return 'ok';
  return urgencyTier(ageHours(oldestPendingAt, now));
}

/**
 * Badge colour per tier, reusing the existing design-system variants rather
 * than new one-off colours: muted grey / amber warning / red destructive.
 */
export const URGENCY_BADGE_VARIANT: Record<UrgencyTier, BadgeVariant> = {
  ok: 'muted',
  aging: 'warning',
  stale: 'destructive',
};

/**
 * Extra class for the stale tier: the same 1.4s ease-in-out pulse cadence as
 * `.ping-overdue`, reshaped as a ring so it reads correctly on a small rounded
 * pill (the ping pulse animates an inset left-edge bar, which only makes sense
 * on a full-width list row). Defined in globals.css and disabled by the same
 * prefers-reduced-motion rule as the ping animations.
 */
export const URGENCY_PULSE_CLASS: Record<UrgencyTier, string> = {
  ok: '',
  aging: '',
  stale: 'badge-stale',
};

/** Human phrasing for how long the oldest item has waited, for tooltips. */
export function waitingLabel(hours: number): string {
  if (hours < 1) return 'waiting under an hour';
  if (hours < 24) return `waiting ${hours} hour${hours === 1 ? '' : 's'}`;
  const days = Math.floor(hours / 24);
  return `waiting ${days} day${days === 1 ? '' : 's'}`;
}
