/* eslint-env serviceworker */
/**
 * Service worker — the technical prerequisite for BOTH installability and push
 * notifications. Without a registered worker at this scope the browser will not
 * offer to install the app and will not deliver a push at all.
 *
 * Served from /public so its URL is `/sw.js` and its scope is the whole origin.
 * A worker under a sub-path can only receive events for that sub-path, which
 * would silently exclude most of the app.
 *
 * Deliberately small. It does three things:
 *   1. displays incoming push notifications,
 *   2. routes a notification tap back into the app,
 *   3. caches immutable static assets, and nothing else.
 *
 * Bump CACHE_VERSION whenever this file's caching behaviour changes; the
 * activate handler deletes every other cache this origin owns.
 */
const CACHE_VERSION = 'v1';
const STATIC_CACHE = `phazeone-static-${CACHE_VERSION}`;

/** Shown when a push arrives without its own icon. */
const DEFAULT_ICON = '/icon-192.png';
const DEFAULT_BADGE = '/icon-192.png';

self.addEventListener('install', (event) => {
  // Pre-cache only the icons, which the notification itself needs — a push can
  // arrive when the app has never been opened on this device, and an icon fetch
  // that fails offline would render a blank notification.
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll([DEFAULT_ICON, '/apple-touch-icon.png']))
      // Never let a failed pre-cache block activation; the worker's real job is
      // push, and that must work whether or not this succeeded.
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key !== STATIC_CACHE).map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

/**
 * Cache-first for content-hashed build assets only.
 *
 * Everything else — every navigation, every RSC payload, every API call — goes
 * straight to the network with no cache and no offline fallback. That is a
 * deliberate limit, for two reasons:
 *
 *   - This is an ERP. A cached shell that renders yesterday's leave balance,
 *     voucher total or approval queue is worse than an offline error, because
 *     the user cannot tell the difference.
 *   - iOS Safari gives a web app a much smaller storage quota than Android,
 *     evicts it aggressively, and has no Background Sync — so a caching
 *     strategy that promised offline writes could not keep the promise there.
 *
 * /_next/static/** is safe because Next fingerprints those filenames: a changed
 * file is a changed URL, so a cache hit can never be stale.
 */
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }
  if (url.origin !== self.location.origin) return;

  const isImmutable = url.pathname.startsWith('/_next/static/');
  const isIcon =
    url.pathname === DEFAULT_ICON || url.pathname === '/apple-touch-icon.png';
  if (!isImmutable && !isIcon) return;

  event.respondWith(
    caches.match(request).then(
      (hit) =>
        hit ??
        fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches
              .open(STATIC_CACHE)
              .then((cache) => cache.put(request, copy))
              .catch(() => undefined);
          }
          return response;
        }),
    ),
  );
});

/**
 * An incoming push. The payload is the JSON produced by the backend's
 * PushNotificationService; anything else is treated as a plain body string so a
 * malformed or third-party push still shows something rather than throwing.
 *
 * showNotification() is mandatory: a push handled without displaying a
 * notification counts as a "silent push", and both iOS and Chrome will revoke
 * the push permission after a few of them.
 */
self.addEventListener('push', (event) => {
  let payload = {};
  if (event.data) {
    try {
      payload = event.data.json() ?? {};
    } catch {
      payload = { body: event.data.text() };
    }
  }

  const title = payload.title || 'PhazeOne';
  const options = {
    body: payload.body || '',
    icon: payload.icon || DEFAULT_ICON,
    badge: payload.badge || DEFAULT_BADGE,
    // A tag collapses repeats of the same subject (one "3 approvals waiting"
    // rather than three notifications); renotify still buzzes the device.
    tag: payload.tag || undefined,
    renotify: Boolean(payload.tag),
    requireInteraction: false,
    data: {
      url: payload.url || '/dashboard',
      ...(payload.data || {}),
    },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

/**
 * Tapping a notification should land the user on the thing it was about, and
 * should reuse an already-open window rather than stacking up new ones.
 */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/dashboard';

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clients) => {
        for (const client of clients) {
          if ('focus' in client) {
            if ('navigate' in client) client.navigate(target).catch(() => undefined);
            return client.focus();
          }
        }
        return self.clients.openWindow(target);
      }),
  );
});

/**
 * The browser can rotate a subscription on its own (key refresh, or a push
 * service migration), which invalidates the endpoint we have stored.
 *
 * We cannot repair it from here: re-registering it requires an authenticated
 * call to our API, and a service worker has no access token. So this is logged
 * only, and the fix happens client-side — the app re-reads its subscription and
 * re-posts it on every load while permission is granted, so the stored row
 * self-heals the next time the user opens the app. Until then the backend's own
 * pruning of 404/410 endpoints stops us from mailing a dead subscription
 * forever.
 */
self.addEventListener('pushsubscriptionchange', () => {
  console.warn('[sw] push subscription changed — will re-sync on next app open');
});
