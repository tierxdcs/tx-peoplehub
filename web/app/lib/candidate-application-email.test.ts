import { describe, expect, it } from 'vitest';
import {
  candidateEmailToast,
  parseRecipientInput,
  type CandidateApplicationEmailResult,
  type CandidateApplicationEmailSummary,
} from './candidate-application-email';

const result = (
  to: string,
  status: CandidateApplicationEmailResult['status'],
  reason: string | null = null,
): CandidateApplicationEmailResult => ({
  to,
  status,
  reason,
  messageId: status === 'sent' ? 'msg-1' : null,
});

const summary = (
  results: CandidateApplicationEmailResult[],
): CandidateApplicationEmailSummary => ({
  results,
  sent: results.filter((r) => r.status === 'sent').length,
  skipped: results.filter((r) => r.status === 'skipped').length,
  failed: results.filter((r) => r.status === 'failed').length,
});

describe('candidateEmailToast', () => {
  it('counts a clean batch and names who got it', () => {
    const toast = candidateEmailToast(
      summary([
        result('one@example.com', 'sent'),
        result('two@example.com', 'sent'),
      ]),
    );
    expect(toast.tone).toBe('success');
    expect(toast.title).toBe('Application link emailed to 2 candidates');
    expect(toast.description).toBe('Sent to one@example.com, two@example.com.');
  });

  it('uses the singular for one candidate', () => {
    expect(
      candidateEmailToast(summary([result('one@example.com', 'sent')])).title,
    ).toBe('Application link emailed to 1 candidate');
  });

  // The whole point of the per-recipient report: a partial send must never read
  // like a clean one.
  it('does not fold a failure into the success count', () => {
    const toast = candidateEmailToast(
      summary([
        result('one@example.com', 'sent'),
        result(
          'bad@example.com',
          'failed',
          'Email send failed: invalid recipient',
        ),
      ]),
    );
    expect(toast.tone).toBe('error');
    expect(toast.title).toBe('Emailed 1, 1 failed');
    expect(toast.description).toContain('Failed for bad@example.com');
    expect(toast.description).toContain('invalid recipient');
  });

  it('reports an all-failed batch as an error, not a partial success', () => {
    const toast = candidateEmailToast(
      summary([result('one@example.com', 'failed', 'provider down')]),
    );
    expect(toast.tone).toBe('error');
    expect(toast.title).toBe('Email failed for 1 candidate');
  });

  it('translates the server skip reasons into HR language', () => {
    const toast = candidateEmailToast(
      summary([result('one@example.com', 'skipped', 'dry-run')]),
    );
    expect(toast.tone).toBe('info');
    expect(toast.title).toBe('No emails sent');
    expect(toast.description).toContain('email is in dry-run mode here');
  });

  it('separates a mixed sent/skipped batch in the title', () => {
    const toast = candidateEmailToast(
      summary([
        result('one@example.com', 'sent'),
        result('two@example.com', 'skipped', 'suppressed-by-allowlist'),
      ]),
    );
    expect(toast.tone).toBe('success');
    expect(toast.title).toBe('Emailed 1, skipped 1');
    expect(toast.description).toContain(
      "outside this environment's allowed recipients",
    );
  });

  it('passes an unrecognised reason through verbatim', () => {
    expect(
      candidateEmailToast(
        summary([result('one@example.com', 'skipped', 'brand-new-reason')]),
      ).description,
    ).toContain('brand-new-reason');
  });
});

describe('parseRecipientInput', () => {
  it('splits on commas, semicolons, spaces and newlines', () => {
    expect(
      parseRecipientInput(
        'one@example.com, two@example.com;three@example.com\nfour@example.com',
      ),
    ).toEqual([
      'one@example.com',
      'two@example.com',
      'three@example.com',
      'four@example.com',
    ]);
  });

  it('drops blanks and de-duplicates case-insensitively', () => {
    expect(
      parseRecipientInput('  One@example.com , , one@example.com  '),
    ).toEqual(['One@example.com']);
  });

  it('returns nothing for an empty or whitespace-only entry', () => {
    expect(parseRecipientInput('')).toEqual([]);
    expect(parseRecipientInput('   ,  ; \n ')).toEqual([]);
  });
});
