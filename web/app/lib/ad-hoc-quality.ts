/**
 * Heuristic "bundle smell" detection for ad-hoc product names typed by sales.
 *
 * Each sellable product must be its own line item so it can be resolved to its
 * own Product + BOM; reps sometimes lump several deliverables into one ad-hoc
 * line ("Kiosk + 2x PDU, rack and cabling"). These checks flag the obvious
 * cases. Advisory only — callers show a warning, never block, because a new
 * product that isn't in the product line yet is perfectly legitimate.
 */

/** "2x", "3 nos", "4 pcs", "2 sets", "5 units" … */
const QTY_TOKEN = /\b\d+\s*(?:x\b|nos\b|pcs?\b|sets?\b|units?\b)/gi;

/** Reason the name looks like a bundle of several products, or null if clean. */
export function adHocBundleWarning(name: string): string | null {
  const value = name.trim();
  if (!value) return null;

  const reasons: string[] = [];
  if (/[+&]/.test(value) || /\band\b/i.test(value)) {
    reasons.push("joins items with '+', '&' or 'and'");
  }
  if (/[,;]/.test(value)) {
    reasons.push('reads as a comma-separated list');
  }
  if ((value.match(QTY_TOKEN) ?? []).length >= 2) {
    reasons.push('mentions more than one quantity');
  }
  if (reasons.length === 0) return null;

  return (
    `This looks like several products in one line (${reasons.join('; ')}). ` +
    'Enter each sellable product as its own line item so it can get its own ' +
    'product record and BOM.'
  );
}
