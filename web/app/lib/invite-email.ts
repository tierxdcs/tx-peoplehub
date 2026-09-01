/**
 * Shared shape + toast copy for "email this link" actions (Vendor and Supplier
 * qualification today, other invite flows next). Pure — no fetch, no React —
 * so the wording is unit-tested once instead of being retyped per page.
 */

export interface EmailSendResult {
  /** Addresses the provider accepted. Empty when the send was skipped. */
  recipients: string[];
  /** Addresses dropped by the server's recipient allowlist. */
  blocked: string[];
  messageId: string | null;
  /** Set when nothing was actually delivered, and why. */
  skipped: 'dry-run' | 'suppressed-by-allowlist' | null;
}

export interface InviteEmailMessage {
  /** 'success' for a real delivery; 'info' when the server deliberately held it. */
  tone: 'success' | 'info';
  text: string;
}

/**
 * What to tell the user after a send. The two skip reasons are deliberately NOT
 * reported as success: a staff member who thinks the vendor was emailed and
 * then waits is worse off than one who is told the mail was held.
 *
 * `subject` names what was sent, for actions that are not invites (e.g. the
 * purchase order sent to a supplier). Only the success line varies — a held mail
 * reads the same whatever it was carrying.
 */
export function inviteEmailMessage(
  result: EmailSendResult,
  fallbackRecipient?: string,
  subject = 'Invite',
): InviteEmailMessage {
  const attempted =
    result.recipients[0] ?? result.blocked[0] ?? fallbackRecipient ?? '';
  const who = attempted ? ` to ${attempted}` : '';

  if (result.skipped === 'dry-run') {
    return {
      tone: 'info',
      text: `Email not sent${who}: this environment has email in dry-run mode.`,
    };
  }
  if (result.skipped === 'suppressed-by-allowlist') {
    return {
      tone: 'info',
      text: `Email not sent${who}: the address is outside this environment's allowed recipients.`,
    };
  }
  return { tone: 'success', text: `${subject} emailed${who}.` };
}
