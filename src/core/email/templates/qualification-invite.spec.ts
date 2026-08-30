import { qualificationInviteEmail } from './qualification-invite';

describe('qualificationInviteEmail', () => {
  const now = new Date('2026-08-30T10:00:00.000Z');
  const base = {
    kind: 'vendor' as const,
    companyName: 'Acme Fabrication Pvt Ltd',
    contactPersonName: 'R. Iyer',
    url: 'https://app.example.com/public/vendor-questionnaire/tok_abc123',
    expiresAt: new Date('2026-09-13T10:00:00.000Z'),
    passwordProtected: false,
    organisationName: 'Phaze Dynamics',
    now,
    timezone: 'Asia/Kolkata',
  };

  it('names the flow and our organisation in the subject', () => {
    expect(qualificationInviteEmail(base).subject).toBe(
      'Vendor qualification questionnaire — Phaze Dynamics',
    );
    expect(
      qualificationInviteEmail({ ...base, kind: 'supplier' }).subject,
    ).toBe('Supplier qualification questionnaire — Phaze Dynamics');
  });

  it('uses the kind noun in the heading and the body', () => {
    const supplier = qualificationInviteEmail({ ...base, kind: 'supplier' });
    expect(supplier.html).toContain('Supplier qualification questionnaire');
    expect(supplier.text).toContain('supplier qualification questionnaire');
    expect(supplier.text).not.toContain('vendor qualification');
  });

  it('puts the link in both the HTML and the text alternative', () => {
    const { html, text } = qualificationInviteEmail(base);
    expect(html).toContain(`href="${base.url}"`);
    // Repeated as copyable text for clients that strip the button.
    expect(html.split(base.url).length - 1).toBeGreaterThanOrEqual(2);
    expect(text).toContain(base.url);
  });

  it('greets the contact person, falling back to the company', () => {
    expect(qualificationInviteEmail(base).text).toContain('Hello R. Iyer,');
    expect(
      qualificationInviteEmail({ ...base, contactPersonName: null }).text,
    ).toContain('Hello Acme Fabrication Pvt Ltd,');
    expect(
      qualificationInviteEmail({ ...base, contactPersonName: '   ' }).text,
    ).toContain('Hello Acme Fabrication Pvt Ltd,');
  });

  it('mentions a password only when the link has one, and never the password', () => {
    expect(qualificationInviteEmail(base).text).not.toContain(
      'password-protected',
    );
    const protectedEmail = qualificationInviteEmail({
      ...base,
      passwordProtected: true,
    });
    expect(protectedEmail.text).toContain('password-protected');
    expect(protectedEmail.text).toContain('shared with you separately');
  });

  it('states the expiry date with the remaining whole days', () => {
    expect(qualificationInviteEmail(base).text).toContain(
      'This link expires on 13 Sept 2026, 14 days from now.',
    );
    expect(
      qualificationInviteEmail({
        ...base,
        expiresAt: new Date('2026-08-31T12:00:00.000Z'),
      }).text,
    ).toContain('1 day from now.');
  });

  it('says "expires today" rather than a negative countdown', () => {
    const text = qualificationInviteEmail({
      ...base,
      expiresAt: new Date('2026-08-30T18:00:00.000Z'),
    }).text;
    expect(text).toContain('This link expires today (30 Aug 2026).');
    expect(text).not.toMatch(/-?\d+ days? from now/);
  });

  it('includes the buyer note when supplied', () => {
    const text = qualificationInviteEmail({
      ...base,
      note: 'Please complete before Friday — we are finalising the AVL.',
    }).text;
    expect(text).toContain('Please complete before Friday');
  });

  it('escapes caller text instead of emitting it as markup', () => {
    const { html, text } = qualificationInviteEmail({
      ...base,
      companyName: 'A & B <Metals>',
      contactPersonName: null,
    });
    expect(html).toContain('A &amp; B &lt;Metals&gt;');
    expect(html).not.toContain('<Metals>');
    // The text alternative decodes back to what the caller wrote.
    expect(text).toContain('A & B <Metals>');
  });
});
