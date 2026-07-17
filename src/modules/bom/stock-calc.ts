import { Prisma } from '@prisma/client';

/**
 * Pure requirement + availability math for the kickoff stock report (§7–8).
 * Kept free of Prisma queries so it is directly unit-testable. All quantities
 * are Prisma.Decimal; QTY_PRECISION decimal places, ROUND_HALF_UP (documented).
 */
export const QTY_PRECISION = 4;

export function round(d: Prisma.Decimal): Prisma.Decimal {
  return d.toDecimalPlaces(QTY_PRECISION, Prisma.Decimal.ROUND_HALF_UP);
}

export type AvailabilityStatus =
  | 'AVAILABLE'
  | 'EXPECTED_BEFORE_REQUIRED_DATE'
  | 'SHORTAGE'
  | 'UNKNOWN';

/** baseRequirement = quantityPerUnit * orderedQuantity. */
export function baseRequirement(
  quantityPerUnit: Prisma.Decimal,
  orderedQuantity: Prisma.Decimal,
): Prisma.Decimal {
  return round(quantityPerUnit.times(orderedQuantity));
}

/** wastageQuantity = base * (wastagePercent / 100). */
export function wastageQuantity(
  base: Prisma.Decimal,
  wastagePercent: Prisma.Decimal,
): Prisma.Decimal {
  return round(base.times(wastagePercent).dividedBy(100));
}

/** grossRequirement = base + wastage. */
export function grossRequirement(
  base: Prisma.Decimal,
  wastage: Prisma.Decimal,
): Prisma.Decimal {
  return round(base.plus(wastage));
}

/**
 * Classify one aggregated item against stock.
 * - No stock record at all → UNKNOWN.
 * - effectiveAvailable (available + reservedForThisKickoff) covers gross → AVAILABLE.
 * - else if expected receipts cover the deficit AND arrive before required →
 *   EXPECTED_BEFORE_REQUIRED_DATE.
 * - else SHORTAGE.
 */
export function classifyAvailability(input: {
  hasStockRecord: boolean;
  gross: Prisma.Decimal;
  effectiveAvailable: Prisma.Decimal;
  expectedReceiptQuantity: Prisma.Decimal;
  expectedInTime: boolean;
}): { status: AvailabilityStatus; shortage: Prisma.Decimal; surplus: Prisma.Decimal } {
  const zero = new Prisma.Decimal(0);
  if (!input.hasStockRecord) {
    return { status: 'UNKNOWN', shortage: input.gross, surplus: zero };
  }
  if (input.effectiveAvailable.greaterThanOrEqualTo(input.gross)) {
    return {
      status: 'AVAILABLE',
      shortage: zero,
      surplus: round(input.effectiveAvailable.minus(input.gross)),
    };
  }
  const deficit = round(input.gross.minus(input.effectiveAvailable));
  if (
    input.expectedReceiptQuantity.greaterThanOrEqualTo(deficit) &&
    input.expectedInTime
  ) {
    return { status: 'EXPECTED_BEFORE_REQUIRED_DATE', shortage: deficit, surplus: zero };
  }
  return { status: 'SHORTAGE', shortage: deficit, surplus: zero };
}
