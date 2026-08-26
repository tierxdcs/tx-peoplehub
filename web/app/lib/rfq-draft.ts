/**
 * Pure helpers behind editing an RFQ while it is still a DRAFT (see
 * app/(protected)/scm/rfqs/[id]/page.tsx). Kept out of the page so the
 * "did the sourcing scope actually change?" rule is testable: the server clears
 * the Project Manager approval whenever a save carries lines, so the client only
 * sends them when they genuinely differ.
 */
import type { RfqLine } from './rfq';

/** One editable line while the draft is open for editing. */
export interface LineDraft {
  key: number;
  /**
   * The persisted line's UoM, sent back untouched so a save never silently
   * re-defaults it to the item's base unit. Blank for a line added here.
   */
  unitOfMeasure: string;
  itemId: string;
  quantity: string;
  targetPrice: string;
  specificationNotes: string;
}

let lineKeySeq = 0;

/** A fresh React key for a draft line. */
export function nextLineKey(): number {
  return lineKeySeq++;
}

export function toLineDraft(line: RfqLine): LineDraft {
  return {
    key: nextLineKey(),
    unitOfMeasure: line.unitOfMeasure,
    itemId: line.itemId,
    quantity: line.quantity,
    targetPrice: line.targetPrice ?? '',
    specificationNotes: line.specificationNotes ?? '',
  };
}

export function blankLineDraft(): LineDraft {
  return {
    key: nextLineKey(),
    unitOfMeasure: '',
    itemId: '',
    quantity: '',
    targetPrice: '',
    specificationNotes: '',
  };
}

/**
 * Comparable shape of a line set — quantities and prices go through Number so
 * "10" and the server's "10.0000" don't read as an edit. Order matters: it is
 * the line sequence being saved.
 */
export function lineSignature(lines: LineDraft[]): string {
  return lines
    .map((line) =>
      [
        line.itemId,
        Number(line.quantity),
        line.targetPrice ? Number(line.targetPrice) : '',
        line.specificationNotes.trim(),
      ].join('|'),
    )
    .join('¦');
}

/** ISO instant → the "YYYY-MM-DDTHH:mm" a datetime-local input expects. */
export function toDateTimeInput(iso: string): string {
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
