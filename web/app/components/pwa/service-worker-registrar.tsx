'use client';

import { useEffect } from 'react';

/**
 * Registers the service worker, once, on every page.
 *
 * Mounted in the ROOT layout rather than the protected one because installability
 * is not an authenticated concern: the browser only offers to install an app whose
 * worker is already registered, and someone may well install from the login
 * screen. It renders nothing and makes no API call, so it is safe there.
 *
 * Registration is idempotent — the browser returns the existing registration and
 * checks for an updated worker file, which is why /sw.js is served no-cache.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
      return;
    }
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch((err) => {
      // A failed registration costs installability and push, but must never
      // break the page — so it is logged, not surfaced.
      console.warn('[pwa] service worker registration failed', err);
    });
  }, []);

  return null;
}
