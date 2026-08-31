/**
 * The wire format of a push notification, and the rules for fitting one into it.
 *
 * Pure — no SDK, no Prisma, no clock. The service worker in web/public/sw.js is
 * the only reader of this JSON, so these two files are a contract: any field
 * added here needs a handler there, and vice versa.
 */

/** What a caller asks to be shown on a device. */
export interface PushNotification {
  /** The bold first line. Kept short — a phone truncates it hard. */
  title: string;
  /** The second line. */
  body?: string;
  /** In-app path opened when the notification is tapped, e.g. '/my-pings'. */
  url?: string;
  /**
   * Collapses repeats about the same subject: a second push with the same tag
   * replaces the first instead of stacking. Use a stable per-subject value
   * (`ping:<id>`, `approvals`), never a random one.
   */
  tag?: string;
  /** Overrides the app icon; must be a same-origin path on the frontend. */
  icon?: string;
  badge?: string;
  /** Anything extra the tapped page wants; ends up on `notification.data`. */
  data?: Record<string, unknown>;
}

/**
 * Push services cap an encrypted payload at 4096 bytes and reject anything
 * larger outright (HTTP 413) — so an over-long body must be trimmed here, where
 * the user still gets the notification, rather than lost at the provider.
 * Encryption adds overhead (padding + a 16-byte auth tag), hence the margin.
 */
export const MAX_PUSH_PAYLOAD_BYTES = 3000;
export const MAX_TITLE_LENGTH = 120;
export const MAX_BODY_LENGTH = 400;

/** Truncates on a character boundary, marking that it was cut. */
export function clampText(value: string, max: number): string {
  const text = value.trim();
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

/**
 * Serialises a notification for the wire, trimming it to fit.
 *
 * `url` defaults to the dashboard rather than being omitted: a notification that
 * opens nothing feels broken, and the service worker has to navigate somewhere.
 *
 * If the result is still too big after clamping title and body (only possible
 * via a large `data` object), `data` is dropped — the message is what the user
 * needs; the payload is what the provider will accept.
 */
export function buildPushPayload(notification: PushNotification): string {
  const base = {
    title: clampText(notification.title, MAX_TITLE_LENGTH) || 'Notification',
    body: notification.body
      ? clampText(notification.body, MAX_BODY_LENGTH)
      : '',
    url: notification.url ?? '/dashboard',
    tag: notification.tag,
    icon: notification.icon,
    badge: notification.badge,
    data: notification.data,
  };

  const full = JSON.stringify(base);
  if (Buffer.byteLength(full, 'utf8') <= MAX_PUSH_PAYLOAD_BYTES) return full;

  const withoutData = JSON.stringify({ ...base, data: undefined });
  if (Buffer.byteLength(withoutData, 'utf8') <= MAX_PUSH_PAYLOAD_BYTES) {
    return withoutData;
  }

  // Last resort: title and url only. Still a useful notification.
  return JSON.stringify({
    title: base.title,
    body: '',
    url: base.url,
    tag: base.tag,
  });
}

/**
 * How the push service answered, in terms the caller can act on.
 *
 * - `expired`: 404/410 — the subscription is permanently gone (app deleted,
 *   browser data cleared, endpoint rotated). The row must be deleted; retrying
 *   it forever is the classic Web Push memory leak.
 * - `rejected`: our own fault (bad VAPID keys, malformed payload) — the same
 *   push to every device will fail identically, so it is worth logging loudly.
 * - `failed`: transient (network, 429, 5xx). Keep the subscription.
 */
export type PushFailureKind = 'expired' | 'rejected' | 'failed';

export function classifyPushFailure(statusCode?: number): PushFailureKind {
  if (statusCode === 404 || statusCode === 410) return 'expired';
  if (statusCode === 400 || statusCode === 401 || statusCode === 403) {
    return 'rejected';
  }
  if (statusCode === 413) return 'rejected';
  return 'failed';
}
