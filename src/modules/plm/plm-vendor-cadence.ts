export type PlmVendorCadenceStatus = 'GREEN' | 'AMBER' | 'RED';

const DAY_MS = 86_400_000;
const AMBER_RATIO = 0.75;

export function deriveVendorCadence(
  referenceAt: Date,
  cadenceDays: number,
  now = new Date(),
) {
  const safeDays = Math.max(1, cadenceDays);
  const cadenceMs = safeDays * DAY_MS;
  const elapsedMs = Math.max(0, now.getTime() - referenceAt.getTime());
  const ratio = elapsedMs / cadenceMs;
  const status: PlmVendorCadenceStatus =
    ratio >= 1 ? 'RED' : ratio >= AMBER_RATIO ? 'AMBER' : 'GREEN';

  return {
    status,
    cadenceDays: safeDays,
    dueAt: new Date(referenceAt.getTime() + cadenceMs),
  };
}
