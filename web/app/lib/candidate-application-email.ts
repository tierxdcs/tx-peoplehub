/**
 * Toast copy for "email the application link" on a candidate requisition. HR
 * pastes a shortlist and sends in one click, so the server reports per address
 * and the summary has to say WHICH candidate was left out and why — a bare
 * "3 emails sent" hides the applicant who never got one and is then wrongly
 * assumed to have ignored us. Pure — no fetch, no React — so the wording is
 * unit-tested once.
 *
 * Sibling of rfq-invite-email.ts (same per-recipient shape, different noun) and
 * of invite-email.ts, which covers the single-recipient invite flows.
 */

export type CandidateApplicationEmailStatus = 'sent' | 'skipped' | 'failed';

export interface CandidateApplicationEmailResult {
  to: string;
  status: CandidateApplicationEmailStatus;
  /** Skip reason or failure message; null when sent. */
  reason: string | null;
  messageId: string | null;
}

export interface CandidateApplicationEmailSummary {
  sent: number;
  skipped: number;
  failed: number;
  results: CandidateApplicationEmailResult[];
}

export interface CandidateEmailToast {
  /** 'success' only when at least one candidate was actually mailed and none failed. */
  tone: 'success' | 'info' | 'error';
  title: string;
  description?: string;
}

/** Server skip reasons, in HR's language. */
const REASON_LABEL: Record<string, string> = {
  'dry-run': 'email is in dry-run mode here',
  'suppressed-by-allowlist': "outside this environment's allowed recipients",
};

function label(result: CandidateApplicationEmailResult): string {
  const reason = result.reason
    ? (REASON_LABEL[result.reason] ?? result.reason)
    : '';
  return reason ? `${result.to} (${reason})` : result.to;
}

/**
 * What to tell HR after a batch send. Skips and failures are never folded into
 * the success count: a recruiter who believes all five candidates were invited
 * and then waits for applications is worse off than one who is told which
 * address to re-check.
 */
export function candidateEmailToast(
  summary: CandidateApplicationEmailSummary,
): CandidateEmailToast {
  const { sent, skipped, failed, results } = summary;
  const parts: string[] = [];
  const of = (status: CandidateApplicationEmailStatus) =>
    results.filter((r) => r.status === status);

  if (sent > 0) {
    parts.push(
      `Sent to ${of('sent')
        .map((r) => r.to)
        .join(', ')}.`,
    );
  }
  if (skipped > 0)
    parts.push(`Skipped ${of('skipped').map(label).join(', ')}.`);
  if (failed > 0)
    parts.push(`Failed for ${of('failed').map(label).join(', ')}.`);
  const description = parts.join(' ');

  if (failed > 0) {
    return {
      tone: 'error',
      title:
        sent > 0
          ? `Emailed ${sent}, ${failed} failed`
          : `Email failed for ${failed} candidate${failed === 1 ? '' : 's'}`,
      description,
    };
  }
  if (sent === 0) {
    return {
      tone: 'info',
      title: 'No emails sent',
      description: description || 'There was nobody to email.',
    };
  }
  return {
    tone: 'success',
    title:
      skipped > 0
        ? `Emailed ${sent}, skipped ${skipped}`
        : `Application link emailed to ${sent} candidate${sent === 1 ? '' : 's'}`,
    description,
  };
}

/**
 * Split what HR typed into addresses. Commas, semicolons, spaces and newlines
 * all separate — a shortlist gets pasted out of a spreadsheet or an email
 * client, and both use their own delimiter.
 */
export function parseRecipientInput(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(/[,;\s]+/)) {
    const address = part.trim();
    if (!address) continue;
    const key = address.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(address);
  }
  return out;
}
