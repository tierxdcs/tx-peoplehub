/**
 * The two rules behind On-Time Delivery, kept pure so every reader of OTD uses
 * the same arithmetic. The Logistics OTD report owns them; the Executive
 * Operations dashboard segments that report's own rows by facility rather than
 * recomputing delivery performance from scratch.
 */

const DAY = 24 * 60 * 60 * 1000;

/** Delay in whole days, rounded up. `<= 0` means the DC arrived on time. */
export function delayDays(promised: Date, actual: Date): number {
  return Math.ceil((actual.getTime() - promised.getTime()) / DAY);
}

/**
 * Share of deliveries that met their promise, to one decimal. Null — never 0 —
 * when nothing has been delivered: a rate of nothing is undefined, and a 0%
 * on-time reading would be indistinguishable from total failure.
 */
export function onTimePercentage(
  onTime: number,
  total: number,
): number | null {
  return total ? Math.round((onTime / total) * 1000) / 10 : null;
}
