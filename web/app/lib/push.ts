import { apiFetch } from './api';

/**
 * Push notifications, client side.
 *
 * A second, independent notification channel: the Web Push API plus a VAPID
 * public key from our own server. Nothing here touches email — no shared
 * transport, no shared configuration, no fallback from one to the other.
 *
 * The API calls are plain apiFetch; the browser-side work (service worker
 * registration, PushManager) is the part with the platform rules, and it lives in
 * subscribeToPush/unsubscribeFromPush below.
 */

export interface PushConfig {
  configured: boolean;
  /** Not a secret: handed to every browser by design. Null when unconfigured. */
  publicKey: string | null;
}

export interface PushDevice {
  id: string;
  label: string;
  createdAt: string;
  lastPushAt: string | null;
}

export interface PushSendResult {
  delivered: number;
  expired: number;
  failed: number;
  skipped?: 'no-devices';
  results: { subscriptionId: string; status: string; error?: string }[];
}

export function fetchPushConfig() {
  return apiFetch<PushConfig>('/push/config');
}

export function fetchPushDevices() {
  return apiFetch<PushDevice[]>('/push/devices');
}

export function revokePushDevice(id: string) {
  return apiFetch<PushDevice[]>(`/push/subscriptions/${id}`, {
    method: 'DELETE',
  });
}

export function sendTestPush(note?: string) {
  return apiFetch<PushSendResult>('/push/test', {
    method: 'POST',
    body: JSON.stringify(note ? { note } : {}),
  });
}

/**
 * The VAPID public key arrives as base64url text, but PushManager.subscribe()
 * insists on raw bytes. Decoding it here (rather than sending bytes from the
 * server) keeps the wire format readable and is the conventional shape of this
 * call.
 *
 * The return type is pinned to `Uint8Array<ArrayBuffer>` (not the default
 * `ArrayBufferLike`) because `applicationServerKey` only accepts a view over a
 * plain ArrayBuffer — a SharedArrayBuffer-backed view is rejected by the type.
 */
export function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const normalised = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(normalised);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/** Serialises a browser PushSubscription into the body our API expects. */
export function serializeSubscription(subscription: PushSubscription) {
  const json = subscription.toJSON();
  return {
    endpoint: subscription.endpoint,
    keys: {
      p256dh: json.keys?.p256dh ?? '',
      auth: json.keys?.auth ?? '',
    },
    userAgent:
      typeof navigator === 'undefined' ? undefined : navigator.userAgent,
  };
}

function registerSubscription(subscription: PushSubscription) {
  return apiFetch<PushDevice>('/push/subscriptions', {
    method: 'POST',
    body: JSON.stringify(serializeSubscription(subscription)),
  });
}

/**
 * Registers the service worker. Idempotent — the browser returns the existing
 * registration if this worker is already installed.
 *
 * Awaits `ready` rather than returning the raw registration, because a worker
 * that is still installing has no `pushManager` yet and subscribing against it
 * fails with a confusing error.
 */
export async function ensureServiceWorker(): Promise<ServiceWorkerRegistration> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    throw new Error('This browser does not support service workers.');
  }
  await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  return navigator.serviceWorker.ready;
}

/**
 * Asks for permission and subscribes this device.
 *
 * MUST be called from a user gesture (a button's click handler). iOS refuses a
 * permission prompt that isn't tied to an explicit tap — it doesn't just get
 * ignored, the request is rejected — and Chrome penalises pages that ask on
 * load. That is a platform rule, not a design preference, so this function is
 * never called from an effect.
 */
export async function subscribeToPush(publicKey: string): Promise<PushDevice> {
  const registration = await ensureServiceWorker();

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error(
      permission === 'denied'
        ? 'Notifications are blocked for this app. Re-allow them in your browser or phone settings.'
        : 'Notification permission was dismissed.',
    );
  }

  // Reuse an existing subscription when there is one: re-subscribing would mint
  // a new endpoint and leave the old row behind.
  const existing = await registration.pushManager.getSubscription();
  const subscription =
    existing ??
    (await registration.pushManager.subscribe({
      // Non-negotiable on every current browser: a push must be user-visible.
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    }));

  return registerSubscription(subscription);
}

/**
 * Re-posts the subscription this browser already holds, if any, without ever
 * prompting.
 *
 * This is what heals a rotated subscription: the service worker cannot re-register
 * one itself (it has no access token), so the app does it on load. Safe to call
 * unconditionally — it does nothing unless permission is already granted and a
 * subscription already exists.
 */
export async function syncExistingSubscription(): Promise<PushDevice | null> {
  if (
    typeof window === 'undefined' ||
    !('serviceWorker' in navigator) ||
    !('PushManager' in window) ||
    !('Notification' in window) ||
    Notification.permission !== 'granted'
  ) {
    return null;
  }
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return null;
  return registerSubscription(subscription);
}

/**
 * Turns notifications off for this device: drops the browser-side subscription
 * and the server-side row.
 *
 * The browser side goes first — if that succeeds and the API call then fails, the
 * server holds a dead endpoint, which its own pruning cleans up on the next
 * send. The reverse order could leave a device that still receives pushes with
 * nothing in the UI to turn them off.
 */
export async function unsubscribeFromPush(): Promise<void> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return;
  const { endpoint } = subscription;
  await subscription.unsubscribe();
  await apiFetch<PushDevice[]>(
    `/push/subscriptions?endpoint=${encodeURIComponent(endpoint)}`,
    { method: 'DELETE' },
  );
}

/** Whether this browser currently holds a push subscription. */
export async function hasLocalSubscription(): Promise<boolean> {
  if (
    typeof window === 'undefined' ||
    !('serviceWorker' in navigator) ||
    !('PushManager' in window)
  ) {
    return false;
  }
  const registration = await navigator.serviceWorker.ready;
  return (await registration.pushManager.getSubscription()) !== null;
}
