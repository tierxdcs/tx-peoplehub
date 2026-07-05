/**
 * Mirrors src/common/utils/date.util.ts's todayInTimezone — duplicated
 * client-side (same convention as use-is-hr-staff.ts mirroring isHrStaff())
 * since there's no API exposing the configured timezone. Hardcodes the same
 * default ('Asia/Kolkata') the backend falls back to.
 */
const APP_TIMEZONE = 'Asia/Kolkata';

/** "YYYY-MM-DD" for today, as seen in the app's configured timezone. */
export function todayDateStr(): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(new Date());
}

/** First 10 chars of an ISO date/datetime string — the date-only portion. */
export function dateOnlyStr(iso: string): string {
  return iso.slice(0, 10);
}

/** Inclusive calendar-day count between two "YYYY-MM-DD" strings. */
export function inclusiveDaySpan(startStr: string, endStr: string): number {
  const start = new Date(`${startStr}T00:00:00.000Z`).getTime();
  const end = new Date(`${endStr}T00:00:00.000Z`).getTime();
  return Math.round((end - start) / (24 * 60 * 60 * 1000)) + 1;
}

/** "YYYY-MM-DD" for `date` offset by `days` (may be negative). */
export function addDaysStr(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
