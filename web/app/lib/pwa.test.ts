import { describe, expect, it } from 'vitest';
import {
  installBannerKind,
  isIosDevice,
  pushAvailability,
  type PwaEnvironment,
} from './pwa';

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const IPADOS_DESKTOP_MODE =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';
const ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';
const MAC_DESKTOP =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

describe('isIosDevice', () => {
  it('detects iPhone from the user agent', () => {
    expect(isIosDevice(IPHONE)).toBe(true);
  });

  it('detects an iPad reporting a Macintosh user agent, via touch points', () => {
    // iPadOS 13+ defaults to a desktop UA; touch points are what give it away.
    expect(isIosDevice(IPADOS_DESKTOP_MODE, 5)).toBe(true);
  });

  it('does not mistake a real Mac for an iPad', () => {
    expect(isIosDevice(MAC_DESKTOP, 0)).toBe(false);
    expect(isIosDevice(IPADOS_DESKTOP_MODE, 0)).toBe(false);
  });

  it('is false for Android', () => {
    expect(isIosDevice(ANDROID, 5)).toBe(false);
  });
});

describe('pushAvailability', () => {
  const env = (overrides: Partial<PwaEnvironment> = {}): PwaEnvironment => ({
    isIos: false,
    standalone: false,
    hasServiceWorker: true,
    hasPushManager: true,
    hasNotification: true,
    permission: 'default',
    ...overrides,
  });

  it('allows a subscribe on a supported browser that has not been asked yet', () => {
    expect(pushAvailability(env())).toMatchObject({
      canSubscribe: true,
      reason: null,
    });
  });

  it('still allows it once permission is granted (so a device can re-register)', () => {
    expect(pushAvailability(env({ permission: 'granted' })).canSubscribe).toBe(true);
  });

  it('names the iOS install requirement rather than blaming the browser', () => {
    // The expected Apple restriction: no Push API in a plain iOS tab. Telling
    // the user "unsupported" here would be wrong — it works once installed.
    const result = pushAvailability(
      env({ isIos: true, standalone: false, hasPushManager: false }),
    );
    expect(result.canSubscribe).toBe(false);
    expect(result.reason).toBe('ios-needs-install');
    expect(result.message).toMatch(/home screen/i);
  });

  it('blocks an iOS tab even if the push API is somehow present', () => {
    expect(pushAvailability(env({ isIos: true, standalone: false })).reason).toBe(
      'ios-needs-install',
    );
  });

  it('allows an installed iOS app', () => {
    expect(
      pushAvailability(env({ isIos: true, standalone: true })).canSubscribe,
    ).toBe(true);
  });

  it('reports a genuinely unsupported browser', () => {
    expect(pushAvailability(env({ hasPushManager: false })).reason).toBe(
      'unsupported-browser',
    );
    expect(pushAvailability(env({ hasNotification: false })).reason).toBe(
      'unsupported-browser',
    );
    expect(pushAvailability(env({ hasServiceWorker: false })).reason).toBe(
      'unsupported-browser',
    );
  });

  it('explains a denied permission and where to undo it', () => {
    const result = pushAvailability(env({ permission: 'denied' }));
    expect(result.canSubscribe).toBe(false);
    expect(result.reason).toBe('permission-denied');
    expect(result.message).toMatch(/settings/i);
  });
});

describe('installBannerKind', () => {
  const input = (overrides: Record<string, boolean> = {}) => ({
    isIos: false,
    standalone: false,
    dismissed: false,
    nativePromptAvailable: false,
    ...overrides,
  });

  it('shows the custom instructions on iOS, where no native prompt exists', () => {
    expect(installBannerKind(input({ isIos: true }))).toBe('ios-instructions');
  });

  it('prefers the native prompt when the browser offered one', () => {
    expect(installBannerKind(input({ nativePromptAvailable: true }))).toBe(
      'native-prompt',
    );
  });

  it('shows nothing on a desktop browser that never offered a prompt', () => {
    expect(installBannerKind(input())).toBeNull();
  });

  it('never shows once the app is running from the home screen', () => {
    // Even with a native prompt event still in hand, and even if the user never
    // dismissed the banner: it is installed, so there is nothing to offer.
    expect(
      installBannerKind(
        input({ isIos: true, standalone: true, nativePromptAvailable: true }),
      ),
    ).toBeNull();
  });

  it('stays hidden after the user dismisses it', () => {
    expect(installBannerKind(input({ isIos: true, dismissed: true }))).toBeNull();
    expect(
      installBannerKind(input({ nativePromptAvailable: true, dismissed: true })),
    ).toBeNull();
  });
});
