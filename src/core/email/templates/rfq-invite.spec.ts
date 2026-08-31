import { rfqInviteEmail, type RfqInviteInput } from './rfq-invite';

/**
 * The RFQ quote-link email. What matters is what a partner actually receives:
 * the right ask (fresh quote vs revision), a deadline stated as an instant in a
 * named zone, a link that survives a client stripping the button, and never the
 * link password.
 */
describe('rfqInviteEmail', () => {
  const base: RfqInviteInput = {
    kind: 'invitation',
    rfqNumber: 'RFQ-2026-0042',
    rfqTitle: 'Kiosk sheet metal',
    partnerName: 'Acme Metals',
    url: 'https://app.example.com/public/rfq-quote/tok-abc',
    // 10 Sept 2026, 17:30 IST
    deadline: new Date('2026-09-10T12:00:00.000Z'),
    lineCount: 4,
    passwordProtected: false,
    organisationName: 'Phaze Dynamics Pvt Ltd',
    now: new Date('2026-08-30T09:00:00.000Z'),
    timezone: 'Asia/Kolkata',
  };

  it('addresses the partner and names the RFQ, title and line count', () => {
    const email = rfqInviteEmail(base);
    expect(email.subject).toBe(
      'Request for Quotation RFQ-2026-0042 — Kiosk sheet metal',
    );
    expect(email.html).toContain('Request for Quotation — RFQ-2026-0042');
    expect(email.text).toContain('Hello Acme Metals,');
    expect(email.text).toContain('Phaze Dynamics Pvt Ltd invites you to quote');
    expect(email.text).toContain('covers 4 line items');
    expect(email.text).toContain('Open the quote form');
  });

  it('singularises a one-line request', () => {
    expect(rfqInviteEmail({ ...base, lineCount: 1 }).text).toContain(
      'covers 1 line item,',
    );
  });

  it('carries the link in the html twice and in the text', () => {
    const email = rfqInviteEmail(base);
    // Once as the button href, once as copyable text — clients strip buttons.
    expect(email.html.split(base.url).length - 1).toBe(2);
    expect(email.text).toContain(base.url);
  });

  it('states the deadline as a date AND time in a named zone', () => {
    const email = rfqInviteEmail(base);
    // A quote an hour late is late, so the instant — not just the day — is stated.
    expect(email.text).toMatch(/10 Sept? 2026/);
    expect(email.text).toMatch(/5:30\s?pm/i);
    expect(email.text).toContain('GMT+5:30');
  });

  it('renders the deadline in the timezone it is given', () => {
    const email = rfqInviteEmail({ ...base, timezone: 'UTC' });
    expect(email.text).toMatch(/10 Sept? 2026/);
    expect(email.text).toMatch(/12:00\s?pm/i);
    expect(email.text).not.toContain('GMT+5:30');
  });

  it('warns in the footnote when the deadline has already passed', () => {
    const email = rfqInviteEmail({
      ...base,
      now: new Date('2026-09-11T00:00:00.000Z'),
    });
    expect(email.text).toContain('It has already passed');
    expect(rfqInviteEmail(base).text).not.toContain('It has already passed');
  });

  it('includes the buyer note when there is one', () => {
    expect(
      rfqInviteEmail({ ...base, note: '  Freight to be quoted separately.  ' })
        .text,
    ).toContain('Freight to be quoted separately.');
    expect(rfqInviteEmail({ ...base, note: '   ' }).text).not.toContain(
      'Freight',
    );
  });

  it('mentions a password only when the link has one, and never the value', () => {
    const plain = rfqInviteEmail(base);
    expect(plain.text).not.toContain('password');
    const protectedEmail = rfqInviteEmail({ ...base, passwordProtected: true });
    expect(protectedEmail.text).toContain('The link is password-protected.');
    expect(protectedEmail.text).toContain('never included in this email');
  });

  it('escapes html in the partner and RFQ names', () => {
    const email = rfqInviteEmail({
      ...base,
      partnerName: 'A & B <Metals>',
      rfqTitle: 'Frames & <brackets>',
    });
    expect(email.html).toContain('A &amp; B &lt;Metals&gt;');
    expect(email.html).not.toContain('<Metals>');
    // The text alternative decodes back to what a human would read.
    expect(email.text).toContain('A & B <Metals>');
    expect(email.subject).toContain('Frames & <brackets>');
  });

  describe('revision-request', () => {
    const revision: RfqInviteInput = {
      ...base,
      kind: 'revision-request',
      deadline: new Date('2026-09-15T12:00:00.000Z'),
      revisionNote: 'Please re-quote lines 2 and 3 at 500 units.',
    };

    it('asks for a revised quote and carries the negotiation ask', () => {
      const email = rfqInviteEmail(revision);
      expect(email.subject).toBe(
        'Revised quote requested — RFQ-2026-0042 (Kiosk sheet metal)',
      );
      expect(email.html).toContain('Revised quote requested — RFQ-2026-0042');
      expect(email.text).toContain('Thank you for your quote against');
      expect(email.text).toContain(
        'What we are asking for: Please re-quote lines 2 and 3 at 500 units.',
      );
      expect(email.text).toContain('Submit your revised quote');
    });

    it('tells the partner their earlier link is dead', () => {
      // requestQuoteRevision mints a fresh token, so the sealed-round link the
      // partner already has has stopped working. Saying so avoids a support call.
      const email = rfqInviteEmail(revision);
      expect(email.text).toContain('Your earlier link has been replaced');
      expect(email.text).toContain('Your previous quote remains on record');
    });

    it('uses the revision deadline it is given', () => {
      expect(rfqInviteEmail(revision).text).toMatch(/15 Sept? 2026/);
    });

    it('omits the ask line when no note was recorded', () => {
      const email = rfqInviteEmail({ ...revision, revisionNote: null });
      expect(email.text).not.toContain('What we are asking for');
      expect(email.text).toContain('Submit your revised quote');
    });

    it('does not use the invitation wording', () => {
      expect(rfqInviteEmail(revision).text).not.toContain(
        'invites you to quote',
      );
    });
  });
});
