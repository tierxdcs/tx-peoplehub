import { describe, expect, it } from 'vitest';
import { inviteEmailMessage, type EmailSendResult } from './invite-email';

const base: EmailSendResult = {
  recipients: ['contact@acme.test'],
  blocked: [],
  messageId: 'msg_1',
  skipped: null,
};

describe('inviteEmailMessage', () => {
  it('confirms a real delivery with the address it went to', () => {
    expect(inviteEmailMessage(base)).toEqual({
      tone: 'success',
      text: 'Invite emailed to contact@acme.test.',
    });
  });

  it('does not claim success for a dry-run environment', () => {
    const message = inviteEmailMessage({
      ...base,
      recipients: [],
      messageId: null,
      skipped: 'dry-run',
    });
    expect(message.tone).toBe('info');
    expect(message.text).toContain('not sent');
    expect(message.text).toContain('dry-run');
  });

  it('names the allowlist as the reason and the address that was held', () => {
    const message = inviteEmailMessage({
      recipients: [],
      blocked: ['contact@acme.test'],
      messageId: null,
      skipped: 'suppressed-by-allowlist',
    });
    expect(message.tone).toBe('info');
    expect(message.text).toContain('contact@acme.test');
    expect(message.text).toContain('allowed recipients');
  });

  it('falls back to the caller-supplied address when the server returns none', () => {
    expect(
      inviteEmailMessage(
        { recipients: [], blocked: [], messageId: null, skipped: 'dry-run' },
        'contact@acme.test',
      ).text,
    ).toContain('to contact@acme.test');
  });

  it('names what was sent when the action is not an invite', () => {
    // The purchase-order send reuses this copy; only the success line changes.
    expect(inviteEmailMessage(base, undefined, 'Purchase order').text).toBe(
      'Purchase order emailed to contact@acme.test.',
    );
    // A held mail reads the same whatever it was carrying.
    expect(
      inviteEmailMessage(
        { ...base, recipients: [], messageId: null, skipped: 'dry-run' },
        'contact@acme.test',
        'Purchase order',
      ).text,
    ).toContain('Email not sent');
  });

  it('reads sensibly when no address is known at all', () => {
    expect(
      inviteEmailMessage({
        recipients: [],
        blocked: [],
        messageId: 'msg_2',
        skipped: null,
      }),
    ).toEqual({ tone: 'success', text: 'Invite emailed.' });
  });
});
