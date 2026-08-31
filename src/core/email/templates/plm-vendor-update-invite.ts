import {
  linkExpiryPhrase,
  plainTextFrom,
  renderEmailLayout,
  type RenderedEmail,
} from '../email-content';

/**
 * The PLM vendor production-update link email.
 *
 * Its own template rather than a third `kind` on qualification-invite.ts,
 * because what it asks for is structurally different: a questionnaire link is
 * filled in once and then done, whereas this link is a standing channel the
 * vendor returns to every few days for the life of the production run. So this
 * email leads with the cadence, tells them to keep the mail, and treats the
 * expiry as small print instead of the point.
 *
 * Pure: no SDK, no Prisma, no clock of its own — the caller supplies `now`.
 */

export interface PlmVendorUpdateInviteInput {
  /** The vendor company doing the work. */
  vendorName: string;
  /** Their contact person, when known; the greeting falls back to the company. */
  contactPersonName?: string | null;
  /** e.g. 'ORD-2026-0001'. */
  orderNumber: string;
  /** What they are building. See vendorFacingProductLabel for why not the customer's wording. */
  productName: string;
  /** The full public update-form URL, token included. */
  url: string;
  expiresAt: Date;
  /** How often we expect a self-report — the cadence agreed at kickoff. */
  cadenceDays: number;
  /**
   * True when the link needs a password. The password itself is NEVER put in
   * the email — that would undo the point of having one.
   */
  passwordProtected: boolean;
  /** Our own legal name, for the intro and the signature. */
  organisationName: string;
  /** Optional note from the person sending it, e.g. "Ramesh is your contact here". */
  note?: string | null;
  /** Reference instant for the "expires in N days" phrasing. */
  now?: Date;
  /** IANA zone the expiry date is stated in. */
  timezone?: string;
}

export function plmVendorUpdateInviteEmail(
  input: PlmVendorUpdateInviteInput,
): RenderedEmail {
  const now = input.now ?? new Date();
  const timezone = input.timezone ?? 'Asia/Kolkata';
  const greetingName = input.contactPersonName?.trim() || input.vendorName;
  const every =
    input.cadenceDays === 1 ? 'every day' : `every ${input.cadenceDays} days`;

  const paragraphs = [
    `Hello ${greetingName},`,
    `${input.organisationName} has opened a production progress link for ${input.orderNumber} — ${input.productName}. Please keep this email: the same link works for every update, it needs no login and nothing to install.`,
    `We ask for an update ${every} while this item is in production. Each update confirms the manufacturing steps you have finished, and you can attach photographs of the work. Steps are confirmed one at a time and cannot be undone, so confirm a step only once it is genuinely complete.`,
    'If you need to tell us something between updates — a delay, a material shortage, a question — use the quick comment on the same page. It reaches the person tracking this order directly.',
  ];
  const note = input.note?.trim();
  if (note) paragraphs.push(note);
  if (input.passwordProtected) {
    paragraphs.push(
      'The link is password-protected. The password is shared with you separately — for your security it is never included in this email.',
    );
  }

  const html = renderEmailLayout({
    heading: `Production updates — ${input.orderNumber}`,
    paragraphs,
    cta: { label: 'Report production progress', url: input.url },
    footnote: `${linkExpiryPhrase(input.expiresAt, now, timezone)} If it stops working, reply to this email and we will issue a new one.`,
    signature: input.organisationName,
  });

  return {
    subject: `Production updates for ${input.orderNumber} — ${input.productName}`,
    html,
    text: plainTextFrom(html),
  };
}
