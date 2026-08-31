/**
 * Pure PWA environment logic: is this an iOS device, is the app already
 * installed, may we ask for push permission, and should the install banner show.
 *
 * Kept free of `window` on purpose — every function takes the environment as an
 * argument, so the platform rules (especially Apple's) are unit-testable instead
 * of only observable on a real phone. The thin wrappers that actually read
 * `navigator`/`matchMedia` are at the bottom and do no branching of their own.
 */

export interface PwaEnvironment {
  /** iPhone/iPad/iPod, including iPadOS in desktop mode. */
  isIos: boolean;
  /** Launched from the home screen (no browser chrome) rather than in a tab. */
  standalone: boolean;
  hasServiceWorker: boolean;
  hasPushManager: boolean;
  hasNotification: boolean;
  /** 'unsupported' when the Notification API is absent entirely. */
  permission: NotificationPermission | 'unsupported';
}

/**
 * iPadOS 13+ reports a *Macintosh* user agent by default, so a UA test alone
 * misses every iPad — which would be a silent hole exactly where the install
 * banner matters. A Mac never reports multiple touch points, so that pair
 * separates them.
 */
export function isIosDevice(userAgent: string, maxTouchPoints = 0): boolean {
  if (/iPad|iPhone|iPod/i.test(userAgent)) return true;
  return /Macintosh/i.test(userAgent) && maxTouchPoints > 1;
}

export type PushBlockReason =
  | 'ios-needs-install'
  | 'unsupported-browser'
  | 'permission-denied'
  | null;

export interface PushAvailability {
  /** True when asking for permission (or subscribing) can actually succeed. */
  canSubscribe: boolean;
  reason: PushBlockReason;
  /** What to tell the user, when they cannot. */
  message: string;
}

/**
 * Whether this browser can be asked for push permission at all.
 *
 * The iOS rule is the one that surprises people: Safari exposes the Push API
 * *only* to a web app launched from the home screen in standalone display mode.
 * In an ordinary iOS tab `window.PushManager` is missing, so a generic
 * "your browser doesn't support notifications" message would be both true and
 * useless — the browser does support them, once the app is installed. That case
 * gets its own reason and its own instruction.
 */
export function pushAvailability(env: PwaEnvironment): PushAvailability {
  const hasApi = env.hasServiceWorker && env.hasPushManager && env.hasNotification;

  if (!hasApi) {
    if (env.isIos && !env.standalone) {
      return {
        canSubscribe: false,
        reason: 'ios-needs-install',
        message:
          'On iPhone and iPad, notifications only work once the app is added to your home screen. Install it, open it from the home screen, then turn notifications on.',
      };
    }
    return {
      canSubscribe: false,
      reason: 'unsupported-browser',
      message: 'This browser cannot receive push notifications.',
    };
  }

  // Belt and braces: an iOS tab that somehow exposes the API still cannot
  // deliver a push, and letting the user "enable" it would be a lie.
  if (env.isIos && !env.standalone) {
    return {
      canSubscribe: false,
      reason: 'ios-needs-install',
      message:
        'On iPhone and iPad, notifications only work once the app is added to your home screen. Install it, open it from the home screen, then turn notifications on.',
    };
  }

  if (env.permission === 'denied') {
    return {
      canSubscribe: false,
      reason: 'permission-denied',
      message:
        'Notifications are blocked for this app. Re-allow them in your browser or phone settings, then try again.',
    };
  }

  return { canSubscribe: true, reason: null, message: '' };
}

export interface InstallBannerInput {
  isIos: boolean;
  standalone: boolean;
  /** The user closed the banner before (persisted). */
  dismissed: boolean;
  /** Android/Chrome fired `beforeinstallprompt`, so a native prompt exists. */
  nativePromptAvailable: boolean;
}

export type InstallBannerKind = 'ios-instructions' | 'native-prompt' | null;

/**
 * Which install affordance to show, if any.
 *
 * Android gets the real thing: `beforeinstallprompt` gives us a saved event and
 * one button press opens the browser's own install dialog. iOS has no
 * programmatic equivalent at all — no API, no event, no permission to ask — so
 * the only honest option is a custom banner that tells the user which two menu
 * items to tap.
 *
 * Once the app is running standalone the banner must never appear again: it is
 * already installed, and a banner telling you to install it is a bug the user
 * cannot dismiss their way out of. That check comes first deliberately, ahead of
 * the dismissal flag.
 */
export function installBannerKind(input: InstallBannerInput): InstallBannerKind {
  if (input.standalone) return null;
  if (input.dismissed) return null;
  if (input.nativePromptAvailable) return 'native-prompt';
  return input.isIos ? 'ios-instructions' : null;
}

/** The two taps, in the order iOS presents them. Shown verbatim in the banner. */
export const IOS_INSTALL_STEPS = [
  'Tap the Share button in Safari',
  'Choose "Add to Home Screen"',
] as const;

// ── Environment readers (browser-only; no logic beyond reading a value) ──────

/**
 * True when the page is running as an installed app. `display-mode: standalone`
 * is the standard signal; `navigator.standalone` is the legacy iOS one, and iOS
 * versions exist that set only the latter — so both are consulted.
 */
export function readStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const byDisplayMode =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(display-mode: standalone)').matches;
  const legacyIos =
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
  return byDisplayMode || legacyIos;
}

export function readEnvironment(): PwaEnvironment {
  if (typeof window === 'undefined') {
    return {
      isIos: false,
      standalone: false,
      hasServiceWorker: false,
      hasPushManager: false,
      hasNotification: false,
      permission: 'unsupported',
    };
  }
  return {
    isIos: isIosDevice(window.navigator.userAgent, window.navigator.maxTouchPoints),
    standalone: readStandalone(),
    hasServiceWorker: 'serviceWorker' in window.navigator,
    hasPushManager: 'PushManager' in window,
    hasNotification: 'Notification' in window,
    permission: 'Notification' in window ? Notification.permission : 'unsupported',
  };
}
