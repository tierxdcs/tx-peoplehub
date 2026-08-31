/**
 * A short, human-readable name for a subscribed device, derived from its user
 * agent.
 *
 * Why bother: the only way for someone to revoke notifications on the phone they
 * lost is to recognise it in a list, and a raw user-agent string is unreadable.
 * This is presentation only — nothing keys off it.
 *
 * Deliberately coarse. UA sniffing is a losing game, so this stops at "platform,
 * browser" and falls back to 'Unknown device' rather than guessing.
 */
export function describeDevice(userAgent?: string | null): string {
  const ua = (userAgent ?? '').trim();
  if (!ua) return 'Unknown device';

  const platform = (() => {
    if (/iPhone/i.test(ua)) return 'iPhone';
    if (/iPad/i.test(ua)) return 'iPad';
    if (/Android/i.test(ua)) return 'Android';
    if (/Windows/i.test(ua)) return 'Windows';
    // Order matters: an iPhone UA also contains "Mac OS X".
    if (/Macintosh|Mac OS X/i.test(ua)) return 'Mac';
    if (/CrOS/i.test(ua)) return 'ChromeOS';
    if (/Linux/i.test(ua)) return 'Linux';
    return null;
  })();

  const browser = (() => {
    // Edge and Chrome-based browsers all claim "Chrome", so the specific ones
    // must be tested first.
    if (/Edg\//i.test(ua)) return 'Edge';
    if (/OPR\/|Opera/i.test(ua)) return 'Opera';
    if (/SamsungBrowser/i.test(ua)) return 'Samsung Internet';
    if (/Firefox|FxiOS/i.test(ua)) return 'Firefox';
    if (/Chrome|CriOS/i.test(ua)) return 'Chrome';
    if (/Safari/i.test(ua)) return 'Safari';
    return null;
  })();

  if (platform && browser) return `${platform} · ${browser}`;
  return platform ?? browser ?? 'Unknown device';
}
