import { describe, expect, it } from 'vitest';
import {
  rfqEmailToast,
  type RfqInviteeEmailResult,
  type RfqInviteeEmailSummary,
} from './rfq-invite-email';

const result = (
  overrides: Partial<RfqInviteeEmailResult>,
): RfqInviteeEmailResult => ({
  inviteeId: 'i-1',
  partnerName: 'Acme Metals',
  to: 'rfq@acme.test',
  status: 'sent',
  reason: null,
  messageId: 'msg-1',
  revisionRequest: false,
  ...overrides,
});

const summary = (results: RfqInviteeEmailResult[]): RfqInviteeEmailSummary => ({
  results,
  sent: results.filter((r) => r.status === 'sent').length,
  skipped: results.filter((r) => r.status === 'skipped').length,
  failed: results.filter((r) => r.status === 'failed').length,
});

describe('rfqEmailToast', () => {
  it('reports a clean batch as a success and names the partners', () => {
    const toast = rfqEmailToast(
      summary([
        result({ inviteeId: 'a' }),
        result({ inviteeId: 'b', partnerName: 'Bharat Fabrication' }),
      ]),
    );
    expect(toast.tone).toBe('success');
    expect(toast.title).toBe('Quote link emailed to 2 invitees');
    expect(toast.description).toBe('Sent to Acme Metals, Bharat Fabrication.');
  });

  it('singularises a one-partner send', () => {
    expect(rfqEmailToast(summary([result({})])).title).toBe(
      'Quote link emailed to 1 invitee',
    );
  });

  it('names who was skipped and why in the buyer language', () => {
    const toast = rfqEmailToast(
      summary([
        result({ inviteeId: 'a' }),
        result({
          inviteeId: 'b',
          partnerName: 'Bharat Fabrication',
          status: 'skipped',
          reason: 'no-contact-email',
          to: null,
          messageId: null,
        }),
      ]),
    );
    expect(toast.tone).toBe('success');
    expect(toast.title).toBe('Emailed 1, skipped 1');
    expect(toast.description).toContain('Sent to Acme Metals.');
    expect(toast.description).toContain(
      'Skipped Bharat Fabrication (no contact email on file).',
    );
  });

  it('never calls a send-nothing batch a success', () => {
    const toast = rfqEmailToast(
      summary([
        result({
          status: 'skipped',
          reason: 'already-submitted',
          messageId: null,
        }),
      ]),
    );
    expect(toast.tone).toBe('info');
    expect(toast.title).toBe('No emails sent');
    expect(toast.description).toContain('Acme Metals (already submitted)');
  });

  it('surfaces a dry-run or allowlist hold as not-sent', () => {
    const toast = rfqEmailToast(
      summary([result({ status: 'skipped', reason: 'dry-run' })]),
    );
    expect(toast.tone).toBe('info');
    expect(toast.description).toContain('email is in dry-run mode here');
  });

  it('reports a partial failure as an error while still crediting the sends', () => {
    const toast = rfqEmailToast(
      summary([
        result({ inviteeId: 'a' }),
        result({
          inviteeId: 'b',
          partnerName: 'Bharat Fabrication',
          status: 'failed',
          reason: 'The domain is not verified.',
          messageId: null,
        }),
      ]),
    );
    expect(toast.tone).toBe('error');
    expect(toast.title).toBe('Emailed 1, 1 failed');
    expect(toast.description).toContain('Sent to Acme Metals.');
    expect(toast.description).toContain(
      'Failed for Bharat Fabrication (The domain is not verified.).',
    );
  });

  it('passes an unknown reason through verbatim rather than swallowing it', () => {
    const toast = rfqEmailToast(
      summary([
        result({ status: 'skipped', reason: 'something-new', messageId: null }),
      ]),
    );
    expect(toast.description).toContain('Acme Metals (something-new)');
  });

  it('falls back to the address, then a generic noun, when there is no name', () => {
    expect(
      rfqEmailToast(summary([result({ partnerName: null })])).description,
    ).toBe('Sent to rfq@acme.test.');
    expect(
      rfqEmailToast(
        summary([
          result({
            partnerName: null,
            to: null,
            status: 'skipped',
            reason: 'revoked',
            messageId: null,
          }),
        ]),
      ).description,
    ).toContain('an invitee (invite revoked)');
  });
});
