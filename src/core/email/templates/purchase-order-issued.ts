import {
  plainTextFrom,
  renderEmailLayout,
  type RenderedEmail,
} from '../email-content';

/**
 * The covering email for an issued Purchase Order. The order itself is the
 * attached PDF — this is the note it arrives with, so it stays short and states
 * only what a supplier needs to decide whether to act now: the PO number, the
 * value, and the date the goods are wanted.
 *
 * Deliberately no line detail: duplicating the order into the body invites the
 * two copies to disagree, and the PDF is the document of record.
 *
 * Pure: no SDK, no Prisma, no clock of its own — the caller supplies `now`.
 */

export interface PurchaseOrderIssuedInput {
  /** e.g. 'PO-2026-0001'. */
  poNumber: string;
  /** The supplier/vendor/ad-hoc party company name. */
  partyName: string;
  orderDate: Date;
  expectedDeliveryDate: Date | null;
  /** Number of ordered lines, so the supplier can check the PDF is complete. */
  lineCount: number;
  /** Pre-formatted total, e.g. '1,37,000.00' — the renderer owns the grouping. */
  totalAmountFormatted: string;
  /** Filename of the attached PDF, named in the body so a stripped attachment is obvious. */
  attachmentFileName: string;
  /** Our own legal name, for the intro and the signature. */
  organisationName: string;
  /** Optional free-text note from the buyer. */
  note?: string | null;
  /** True on a repeat send, so the supplier does not read it as a second order. */
  resend?: boolean;
  /** IANA zone the dates are stated in. */
  timezone?: string;
}

/**
 * Day-granular, with the zone named: a delivery date is a calendar day, not an
 * instant, and the supplier may not sit in our timezone. (An RFQ deadline is the
 * opposite case — see rfq-invite.ts.)
 */
function day(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: timezone,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

export function purchaseOrderIssuedEmail(
  input: PurchaseOrderIssuedInput,
): RenderedEmail {
  const timezone = input.timezone ?? 'Asia/Kolkata';
  const items = `${input.lineCount} line item${input.lineCount === 1 ? '' : 's'}`;

  const paragraphs = [`Hello ${input.partyName},`];
  if (input.resend) {
    paragraphs.push(
      `This is a repeat of purchase order ${input.poNumber}, dated ${day(input.orderDate, timezone)} — not a new order. The attached copy replaces any earlier one.`,
    );
  } else {
    paragraphs.push(
      `${input.organisationName} has issued purchase order ${input.poNumber}, dated ${day(input.orderDate, timezone)}. The order is attached as ${input.attachmentFileName}.`,
    );
  }
  paragraphs.push(
    `It covers ${items} for a total of INR ${input.totalAmountFormatted}, exclusive of applicable taxes and duties unless the order states otherwise.` +
      (input.expectedDeliveryDate
        ? ` Delivery is expected by ${day(input.expectedDeliveryDate, timezone)}.`
        : ''),
  );
  const note = input.note?.trim();
  if (note) paragraphs.push(note);
  paragraphs.push(
    'Please acknowledge this order by replying to this email, and quote the PO number on your delivery challan and invoice.',
  );

  const html = renderEmailLayout({
    heading: input.resend
      ? `Purchase Order ${input.poNumber} (resent)`
      : `Purchase Order ${input.poNumber}`,
    paragraphs,
    footnote: `The signed order is the attached PDF (${input.attachmentFileName}). If the attachment is missing, reply to this email and we will resend it.`,
    signature: input.organisationName,
  });

  return {
    subject: input.resend
      ? `Purchase Order ${input.poNumber} from ${input.organisationName} (resent)`
      : `Purchase Order ${input.poNumber} from ${input.organisationName}`,
    html,
    text: plainTextFrom(html),
  };
}
