/**
 * Calendar-day helpers for leave/attendance logic. Dates are always
 * normalized to midnight UTC representing a timezone-local calendar day —
 * consistent with how DateTime columns store date-only values elsewhere in
 * this schema (e.g. Employee.dateOfBirth). No date library dependency:
 * Intl.DateTimeFormat is sufficient for "what calendar day is this in tz".
 */

/** Returns {year, month (1-12), day} for `date` as seen in `timezone`. */
function partsInTimezone(
  date: Date,
  timezone: string,
): { year: number; month: number; day: number } {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = formatter.formatToParts(date);
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value);
  return { year: get('year'), month: get('month'), day: get('day') };
}

/** Midnight UTC for today's calendar date in `timezone`. */
export function todayInTimezone(timezone: string): Date {
  const { year, month, day } = partsInTimezone(new Date(), timezone);
  return new Date(Date.UTC(year, month - 1, day));
}

/** Strips any time-of-day component, keeping only the UTC calendar date. */
export function toDateOnly(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

/** Inclusive day count between two date-only Dates (e.g. Mon..Wed = 3). */
export function daysBetweenInclusive(start: Date, end: Date): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  const diff = toDateOnly(end).getTime() - toDateOnly(start).getTime();
  return Math.round(diff / msPerDay) + 1;
}

/** "YYYY-MM" for `date`, used as the EL accrual idempotency key. */
export function monthKey(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

/** Midnight UTC for the last calendar day of the month containing `date`. */
export function endOfMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
}
