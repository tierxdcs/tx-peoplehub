/**
 * The one place that knows how an awarded RFQ is recorded on the Purchase Order
 * it pre-drafted.
 *
 * Awarding an RFQ auto-creates a DRAFT PurchaseOrder (see RfqService.award) and
 * stamps the RFQ number into the PO's `notes`. There is deliberately NO stored
 * `rfqId` on PurchaseOrder today, so this provenance string is the only link
 * between an award and the PO that came out of it — which makes it the only way
 * to measure "award → PO issued" cycle time.
 *
 * The writer (RfqService.award) and the reader (the executive SCM dashboard)
 * therefore both go through here rather than each hardcoding the sentence. The
 * exact wording is unchanged from when it was inline; extracting it is what stops
 * the dashboard from carrying a second, drift-prone copy of it.
 *
 * KNOWN LIMIT, reported alongside the metric rather than hidden: `notes` is
 * editable while the PO is still a DRAFT, so a PO whose note was rewritten
 * before issue becomes unmatchable. The dashboard states its match coverage so
 * that shows up as missing coverage instead of a silently wrong average.
 */

/** Prefix every auto-drafted PO note starts with. */
export const AUTO_DRAFT_PO_NOTE_PREFIX = 'Auto-drafted from awarded RFQ ';

/**
 * The note stamped on the PO an award pre-drafts. A negotiated revision records
 * which revision won, because the award figures come from that revision.
 */
export function autoDraftPoNote(
  rfqNumber: string,
  revisionNumber: number,
): string {
  return revisionNumber > 1
    ? `${AUTO_DRAFT_PO_NOTE_PREFIX}${rfqNumber} (quote revision ${revisionNumber})`
    : `${AUTO_DRAFT_PO_NOTE_PREFIX}${rfqNumber}`;
}

/**
 * The RFQ number an auto-drafted PO note refers to, or null when the note is
 * absent, edited, or something a human wrote. Never guesses: a note that does
 * not start with the exact prefix yields null.
 */
export function rfqNumberFromPoNote(notes: string | null): string | null {
  if (!notes?.startsWith(AUTO_DRAFT_PO_NOTE_PREFIX)) return null;
  const rest = notes.slice(AUTO_DRAFT_PO_NOTE_PREFIX.length).trim();
  // Strip the optional " (quote revision N)" suffix; the RFQ number itself has
  // no spaces (RFQ-YYYY-####), so the first token is the whole identifier.
  const [rfqNumber] = rest.split(' ');
  return rfqNumber || null;
}
