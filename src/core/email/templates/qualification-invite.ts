import { wholeDaysUntil } from '../../../common/utils/date.util';
import {
  plainTextFrom,
  renderEmailLayout,
  type RenderedEmail,
} from '../email-content';

/**
 * The qualification-questionnaire invite email — ONE template for both Vendor
 * Qualification and Supplier Qualification. The two flows are deliberately
 * separate modules with their own tables, but the email a supplier receives is
 * the same email a vendor receives with a different noun, so this is shared for
 * the same reason token-invite.ts is: copy-pasting it would let the two drift.
 *
 * Pure: no SDK, no Prisma, no clock of its own — the caller supplies `now`.
 */

export type QualificationInviteKind = 'vendor' | 'supplier';

export interface QualificationInviteInput {
  kind: QualificationInviteKind;
  /** The company being invited. */
  companyName: string;
  /** Their contact person, when known; the greeting falls back to the company. */
  contactPersonName?: string | null;
  /** The full public form URL, token included. */
  url: string;
  expiresAt: Date;
  /**
   * True when the link needs a password. The password itself is NEVER put in
   * the email — that would undo the point of having one.
   */
  passwordProtected: boolean;
  /** Our own legal name, for the intro and the signature. */
  organisationName: string;
  /** Optional note from the buyer, e.g. "please complete before Friday". */
  note?: string | null;
  /** Reference instant for the "expires in N days" phrasing. */
  now?: Date;
  /** IANA zone the expiry date is stated in. */
  timezone?: string;
}

const NOUN: Record<QualificationInviteKind, string> = {
  vendor: 'Vendor',
  supplier: 'Supplier',
};

function expiryPhrase(expiresAt: Date, now: Date, timezone: string): string {
  const date = new Intl.DateTimeFormat('en-IN', {
    timeZone: timezone,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(expiresAt);
  const days = wholeDaysUntil(expiresAt, now);
  if (days <= 0) return `This link expires today (${date}).`;
  return `This link expires on ${date}, ${days} day${days === 1 ? '' : 's'} from now.`;
}

export function qualificationInviteEmail(
  input: QualificationInviteInput,
): RenderedEmail {
  const noun = NOUN[input.kind];
  const now = input.now ?? new Date();
  const timezone = input.timezone ?? 'Asia/Kolkata';
  const greetingName = input.contactPersonName?.trim() || input.companyName;

  const paragraphs = [
    `Hello ${greetingName},`,
    `${input.organisationName} has invited ${input.companyName} to complete our ${noun.toLowerCase()} qualification questionnaire. It opens in your browser — nothing to install — and your answers are saved as you go, so you can complete it over more than one sitting.`,
  ];
  const note = input.note?.trim();
  if (note) paragraphs.push(note);
  if (input.passwordProtected) {
    paragraphs.push(
      'The link is password-protected. The password is shared with you separately — for your security it is never included in this email.',
    );
  }

  const html = renderEmailLayout({
    heading: `${noun} qualification questionnaire`,
    paragraphs,
    cta: { label: 'Open the questionnaire', url: input.url },
    footnote: `${expiryPhrase(input.expiresAt, now, timezone)} If it stops working, reply to this email and we will issue a new one.`,
    signature: input.organisationName,
  });

  return {
    subject: `${noun} qualification questionnaire — ${input.organisationName}`,
    html,
    text: plainTextFrom(html),
  };
}
