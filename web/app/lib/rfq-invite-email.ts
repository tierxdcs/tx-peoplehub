/**
 * Toast copy for "email the quote link" on an RFQ. An RFQ goes to three or more
 * partners at once, so the server reports per invitee and the summary has to say
 * WHO was left out and why — a bare "3 emails sent" hides the vendor who never
 * got one. Pure — no fetch, no React — so the wording is unit-tested once.
 *
 * Sibling of invite-email.ts, which covers the single-recipient invite flows.
 */

export type RfqInviteeEmailStatus = 'sent' | 'skipped' | 'failed';

export interface RfqInviteeEmailResult {
  inviteeId: string;
  partnerName: string | null;
  to: string | null;
  status: RfqInviteeEmailStatus;
  /** Skip reason or failure message; null when sent. */
  reason: string | null;
  messageId: string | null;
  /** True when this partner got the revision-request email, not the invitation. */
  revisionRequest: boolean;
}

export interface RfqInviteeEmailSummary {
  sent: number;
  skipped: number;
  failed: number;
  results: RfqInviteeEmailResult[];
}

export interface RfqEmailToast {
  /** 'success' only when at least one partner was actually mailed and none failed. */
  tone: 'success' | 'info' | 'error';
  title: string;
  description?: string;
}

/** Server skip reasons, in the buyer's language. */
const REASON_LABEL: Record<string, string> = {
  revoked: 'invite revoked',
  'link-not-issued': 'link not generated yet — issue the RFQ',
  'link-closed': 'RFQ is closed',
  'deadline-passed': 'deadline has passed',
  'already-submitted': 'already submitted',
  declined: 'declined to quote',
  'no-contact-email': 'no contact email on file',
  'dry-run': 'email is in dry-run mode here',
  'suppressed-by-allowlist': "outside this environment's allowed recipients",
};

function label(result: RfqInviteeEmailResult): string {
  const who = result.partnerName ?? result.to ?? 'an invitee';
  const reason = result.reason
    ? (REASON_LABEL[result.reason] ?? result.reason)
    : '';
  return reason ? `${who} (${reason})` : who;
}

/**
 * What to tell the buyer after a batch send. Skips and failures are never
 * folded into the success count: a buyer who believes all three partners were
 * invited and then waits for quotes is worse off than one who is told which
 * partner to chase.
 */
export function rfqEmailToast(summary: RfqInviteeEmailSummary): RfqEmailToast {
  const { sent, skipped, failed, results } = summary;
  const parts: string[] = [];
  const skippedList = results.filter((r) => r.status === 'skipped');
  const failedList = results.filter((r) => r.status === 'failed');

  if (sent > 0) {
    const names = results
      .filter((r) => r.status === 'sent')
      .map((r) => r.partnerName ?? r.to ?? 'invitee')
      .join(', ');
    parts.push(`Sent to ${names}.`);
  }
  if (skipped > 0) {
    parts.push(`Skipped ${skippedList.map(label).join(', ')}.`);
  }
  if (failed > 0) {
    parts.push(`Failed for ${failedList.map(label).join(', ')}.`);
  }
  const description = parts.join(' ');

  if (failed > 0) {
    return {
      tone: 'error',
      title:
        sent > 0
          ? `Emailed ${sent}, ${failed} failed`
          : `Email failed for ${failed} invitee${failed === 1 ? '' : 's'}`,
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
        : `Quote link emailed to ${sent} invitee${sent === 1 ? '' : 's'}`,
    description,
  };
}
