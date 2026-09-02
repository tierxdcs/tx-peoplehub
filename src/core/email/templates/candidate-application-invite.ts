import {
  linkExpiryPhrase,
  plainTextFrom,
  renderEmailLayout,
  type RenderedEmail,
} from '../email-content';

/**
 * The email that carries a requisition's public application link to a candidate.
 *
 * Unlike the qualification invites, the recipient is a private individual we may
 * never have spoken to, so this reads as an invitation to apply rather than a
 * request to complete our paperwork. It names the role, the vertical and the
 * employment type, because someone approached by several employers in the same
 * week needs to know at a glance which position this is.
 *
 * Deliberately absent: the CTC budget, the business justification and the KPIs.
 * They are on the requisition right next to this link in the UI, they are
 * internal hiring-plan figures, and quoting a budget in an unsolicited email is
 * an offer we have not made. Nothing in this input accepts them.
 *
 * Pure: no SDK, no Prisma, no clock of its own — the caller supplies `now`.
 */

export interface CandidateApplicationInviteInput {
  /** The role being advertised, e.g. "Operations Manager". */
  positionTitle: string;
  /** Our internal reference (REQ-2026-0001) — quoted so replies are traceable. */
  requisitionNumber: string;
  /** The department the role sits in, when set. */
  verticalName?: string | null;
  /** Prisma's CandidateEmploymentType, e.g. FULL_TIME_PERMANENT. Humanized here. */
  employmentType?: string | null;
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
  /** Optional note from the recruiter, e.g. "spoke to you on Tuesday". */
  note?: string | null;
  /** Reference instant for the "expires in N days" phrasing. */
  now?: Date;
  /** IANA zone the expiry date is stated in. */
  timezone?: string;
}

/** FULL_TIME_PERMANENT → "Full time permanent". */
function humanizeEmploymentType(value: string): string {
  const words = value.trim().toLowerCase().split('_').filter(Boolean).join(' ');
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : '';
}

export function candidateApplicationInviteEmail(
  input: CandidateApplicationInviteInput,
): RenderedEmail {
  const now = input.now ?? new Date();
  const timezone = input.timezone ?? 'Asia/Kolkata';
  const vertical = input.verticalName?.trim();
  const employment = input.employmentType
    ? humanizeEmploymentType(input.employmentType)
    : '';

  // "Operations Manager (Production · Full time permanent)" — whichever of the
  // two qualifiers we actually hold.
  const qualifiers = [vertical, employment].filter(Boolean).join(' · ');
  const role = qualifiers
    ? `${input.positionTitle} (${qualifiers})`
    : input.positionTitle;

  const paragraphs = [
    'Hello,',
    `${input.organisationName} is hiring for ${role}, and we would like you to apply.`,
  ];
  const note = input.note?.trim();
  if (note) paragraphs.push(note);
  paragraphs.push(
    'The application form opens in your browser — nothing to install. You will be asked for your experience, what you have worked on, and a copy of your resume.',
  );
  if (input.passwordProtected) {
    paragraphs.push(
      'The link is password-protected. The password is shared with you separately — for your security it is never included in this email.',
    );
  }

  const html = renderEmailLayout({
    heading: `Apply for ${input.positionTitle} at ${input.organisationName}`,
    paragraphs,
    cta: { label: 'Open the application form', url: input.url },
    footnote: `${linkExpiryPhrase(
      input.expiresAt,
      now,
      timezone,
    )} Reference ${input.requisitionNumber} — quote it if you reply to this email.`,
    signature: input.organisationName,
  });

  return {
    subject: `${input.positionTitle} at ${input.organisationName} — apply now`,
    html,
    text: plainTextFrom(html),
  };
}
