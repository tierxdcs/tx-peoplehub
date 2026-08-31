'use client';

import { useCallback, useEffect, useState } from 'react';
import { Download, Plus, Share, X } from 'lucide-react';
import { Button } from '../ui/button';
import { BRAND } from '../../lib/theme';
import {
  installBannerKind,
  isIosDevice,
  readStandalone,
  type InstallBannerKind,
} from '../../lib/pwa';

/**
 * Per-device, not per-account: "I don't want this on this phone" is a property of
 * the phone, so localStorage is the right store (the same reasoning as the
 * sidebar's collapse state living locally while pinned shortcuts live on the
 * server).
 */
const DISMISSED_KEY = 'phazeone.pwa.install-dismissed';

/**
 * The event Chrome/Edge fire when the app is installable. Not in lib.dom yet,
 * hence the local type.
 */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/**
 * Prompts the user to add the app to their home screen.
 *
 * Two completely different mechanisms behind one banner:
 *
 * - **Android/Chrome** fire `beforeinstallprompt`. We keep the event and let the
 *   button call `prompt()`, which opens the browser's own install dialog. That
 *   event must be captured as early as possible — it fires once, and a listener
 *   attached later simply misses it.
 * - **iOS** has no equivalent. No API, no event, nothing to call: Apple only
 *   allows installation through Safari's Share menu. So the banner there can only
 *   be instructions, which is why this component exists at all rather than
 *   deferring to the platform.
 *
 * It never appears once the app is running from the home screen — see
 * installBannerKind, where that check deliberately precedes the dismissal flag.
 */
export function InstallBanner() {
  const [kind, setKind] = useState<InstallBannerKind>(null);
  const [promptEvent, setPromptEvent] =
    useState<BeforeInstallPromptEvent | null>(null);

  const dismiss = useCallback(() => {
    setKind(null);
    try {
      window.localStorage.setItem(DISMISSED_KEY, '1');
    } catch {
      // Private mode / storage disabled: the banner reappears next visit, which
      // is a smaller problem than a crash.
    }
  }, []);

  useEffect(() => {
    const dismissed = (() => {
      try {
        return window.localStorage.getItem(DISMISSED_KEY) === '1';
      } catch {
        return false;
      }
    })();

    const standalone = readStandalone();
    const isIos = isIosDevice(
      window.navigator.userAgent,
      window.navigator.maxTouchPoints,
    );

    // Once installed, clear the dismissal: it has served its purpose, and if the
    // user ever uninstalls we should be free to offer again.
    if (standalone) {
      try {
        window.localStorage.removeItem(DISMISSED_KEY);
      } catch {
        // Nothing to do — the standalone check alone already hides the banner.
      }
      setKind(null);
      return;
    }

    setKind(
      installBannerKind({
        isIos,
        standalone,
        dismissed,
        nativePromptAvailable: false,
      }),
    );

    const onBeforeInstallPrompt = (event: Event) => {
      // Chrome would otherwise show its own mini-infobar; taking the event lets
      // us ask at a moment the user has context for.
      event.preventDefault();
      setPromptEvent(event as BeforeInstallPromptEvent);
      setKind(
        installBannerKind({
          isIos,
          standalone: readStandalone(),
          dismissed,
          nativePromptAvailable: true,
        }),
      );
    };
    const onInstalled = () => setKind(null);

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const install = async () => {
    if (!promptEvent) return;
    await promptEvent.prompt();
    const { outcome } = await promptEvent.userChoice;
    // The event is single-use either way: a second prompt() throws.
    setPromptEvent(null);
    if (outcome === 'accepted') setKind(null);
    else dismiss();
  };

  if (!kind) return null;

  return (
    <div
      role="dialog"
      aria-label={`Install ${BRAND.appName}`}
      // Sits above the ping button on a phone and beside it from sm up, so
      // neither control covers the other.
      className="fixed bottom-3 left-3 right-3 z-30 mb-16 rounded-lg border bg-card p-3 shadow-lg sm:right-24 sm:mb-0"
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 rounded-md bg-muted p-2">
          <Download className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">
            Install {BRAND.appName} on this device
          </p>
          {kind === 'ios-instructions' ? (
            <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-muted-foreground">
              <span>Tap</span>
              <Share className="size-3.5" aria-hidden />
              <span className="font-medium text-foreground">Share</span>
              <span>in Safari, then</span>
              <Plus className="size-3.5" aria-hidden />
              <span className="font-medium text-foreground">
                Add to Home Screen
              </span>
              <span>.</span>
            </p>
          ) : (
            <p className="mt-1 text-sm text-muted-foreground">
              Opens full screen, launches from your home screen, and can receive
              notifications.
            </p>
          )}
          {kind === 'ios-instructions' && (
            // The honest reason to bother on iOS: it is the only way to get
            // notifications there at all.
            <p className="mt-1 text-xs text-muted-foreground">
              Required on iPhone and iPad before notifications can be turned on.
            </p>
          )}
          {kind === 'native-prompt' && (
            <div className="mt-2">
              <Button size="sm" onClick={install}>
                Install
              </Button>
            </div>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={dismiss}
          aria-label="Dismiss install prompt"
          className="-mr-1 -mt-1 shrink-0"
        >
          <X className="size-4" />
        </Button>
      </div>
    </div>
  );
}
