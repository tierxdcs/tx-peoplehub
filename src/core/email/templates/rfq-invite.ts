import {
  plainTextFrom,
  renderEmailLayout,
  type RenderedEmail,
} from '../email-content';

/**
 * The RFQ quote-link email, in its two shapes:
 *
 * - `invitation` — the RFQ has just been issued; quote by the submission deadline.
 * - `revision-request` — the RFQ is closed and SCM has reopened THIS partner's
 *   link to negotiate. Requesting a revision mints a fresh token, so the link
 *   the partner was given for the sealed round has stopped working. That makes
 *   the email materially different from the invitation: it must say the earlier
 *   link is dead, carry the negotiation ask, and use the revision deadline.
 *
 * One template with a discriminator rather than two files, for the same reason
 * qualification-invite.ts is shared: the shell, the CTA and the expiry wording
 * are identical, and two copies would drift.
 *
 * Pure: no SDK, no Prisma, no clock of its own — the caller supplies `now`.
 */

export type RfqInviteKind = 'invitation' | 'revision-request';

export interface RfqInviteInput {
  kind: RfqInviteKind;
  /** e.g. 'RFQ-2026-0042'. */
  rfqNumber: string;
  rfqTitle: string;
  /** The invited supplier/vendor's company name. */
  partnerName: string;
  /** The full public quote-form URL, token included. */
  url: string;
  /** Submission deadline for an invitation, revision deadline for a revision. */
  deadline: Date;
  /** How many sourcing lines they are quoting on. */
  lineCount: number;
  /**
   * True when the link needs a password. The password itself is NEVER in the
   * email — it is set per invitee by SCM and shared separately.
   */
  passwordProtected: boolean;
  /** Our own legal name, for the intro and the signature. */
  organisationName: string;
  /** The negotiation ask, on a revision request. */
  revisionNote?: string | null;
  /** Optional free-text note from the buyer, either shape. */
  note?: string | null;
  /** Reference instant for the "N days left" phrasing. */
  now?: Date;
  /** IANA zone the deadline is stated in. */
  timezone?: string;
}

/**
 * Deadlines here are an instant, not a date: a quote submitted an hour late is
 * late. So unlike the qualification invite's day-granular expiry, this states
 * the date AND time, in our own timezone, named — the partner may not be in it.
 */
function deadlinePhrase(deadline: Date, timezone: string): string {
  const formatted = new Intl.DateTimeFormat('en-IN', {
    timeZone: timezone,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    // 'shortOffset' (GMT+5:30) over 'short' (IST): an RFQ can go to a partner
    // abroad, and an abbreviation they read as their own zone is a missed deadline.
    timeZoneName: 'shortOffset',
  }).format(deadline);
  return formatted;
}

export function rfqInviteEmail(input: RfqInviteInput): RenderedEmail {
  const now = input.now ?? new Date();
  const timezone = input.timezone ?? 'Asia/Kolkata';
  const isRevision = input.kind === 'revision-request';
  const by = deadlinePhrase(input.deadline, timezone);
  const items = `${input.lineCount} line item${input.lineCount === 1 ? '' : 's'}`;

  const paragraphs = [`Hello ${input.partnerName},`];
  if (isRevision) {
    paragraphs.push(
      `Thank you for your quote against ${input.rfqNumber} (${input.rfqTitle}). We would like to invite a revised quote.`,
    );
    if (input.revisionNote?.trim()) {
      paragraphs.push(`What we are asking for: ${input.revisionNote.trim()}`);
    }
    paragraphs.push(
      `Please submit your revised quote by ${by}. Your earlier link has been replaced — use the one below. Your previous quote remains on record; this is an additional revision, not a replacement of your submission history.`,
    );
  } else {
    paragraphs.push(
      `${input.organisationName} invites you to quote on ${input.rfqNumber} — ${input.rfqTitle}. The request covers ${items}, with specifications and any drawings available on the form.`,
    );
    paragraphs.push(
      `Please submit your quote by ${by}. The form saves as you go, so you can complete it over more than one sitting, and you can decline with a reason if you would rather not quote.`,
    );
  }
  const note = input.note?.trim();
  if (note) paragraphs.push(note);
  if (input.passwordProtected) {
    paragraphs.push(
      'The link is password-protected. The password is shared with you separately — for your security it is never included in this email.',
    );
  }

  const html = renderEmailLayout({
    heading: isRevision
      ? `Revised quote requested — ${input.rfqNumber}`
      : `Request for Quotation — ${input.rfqNumber}`,
    paragraphs,
    cta: {
      label: isRevision ? 'Submit your revised quote' : 'Open the quote form',
      url: input.url,
    },
    footnote: `This link closes at the deadline above (${by}).${
      input.deadline <= now
        ? ' It has already passed — contact us for a new link.'
        : ''
    } If it stops working, reply to this email.`,
    signature: input.organisationName,
  });

  return {
    subject: isRevision
      ? `Revised quote requested — ${input.rfqNumber} (${input.rfqTitle})`
      : `Request for Quotation ${input.rfqNumber} — ${input.rfqTitle}`,
    html,
    text: plainTextFrom(html),
  };
}
