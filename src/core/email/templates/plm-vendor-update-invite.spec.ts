import { plmVendorUpdateInviteEmail } from './plm-vendor-update-invite';

describe('plmVendorUpdateInviteEmail', () => {
  const now = new Date('2026-08-30T10:00:00.000Z');
  const base = {
    vendorName: 'Balaji MetalTech',
    contactPersonName: 'R. Iyer',
    orderNumber: 'ORD-2026-0001',
    productName: 'Platform Emergency Kiosk',
    url: 'https://app.example.com/public/plm-vendor-update/tok_abc123',
    expiresAt: new Date('2026-09-13T10:00:00.000Z'),
    cadenceDays: 7,
    passwordProtected: false,
    organisationName: 'Phaze Dynamics',
    now,
    timezone: 'Asia/Kolkata',
  };

  it('identifies the order and product in the subject and heading', () => {
    const email = plmVendorUpdateInviteEmail(base);
    expect(email.subject).toBe(
      'Production updates for ORD-2026-0001 — Platform Emergency Kiosk',
    );
    expect(email.html).toContain('Production updates — ORD-2026-0001');
  });

  it('states the agreed cadence, not a one-off deadline', () => {
    expect(plmVendorUpdateInviteEmail(base).text).toContain(
      'We ask for an update every 7 days',
    );
    // Singular reads as a sentence rather than "every 1 days".
    expect(
      plmVendorUpdateInviteEmail({ ...base, cadenceDays: 1 }).text,
    ).toContain('We ask for an update every day');
  });

  it('tells the vendor the link is reusable, since they need it for weeks', () => {
    const text = plmVendorUpdateInviteEmail(base).text;
    expect(text).toContain('the same link works for every update');
    expect(text).toContain('no login');
  });

  it('warns that confirmed steps cannot be rolled back', () => {
    // The server enforces this (recordUpdate refuses a lower step count), so a
    // vendor who is not told hits an error instead of reading a rule.
    expect(plmVendorUpdateInviteEmail(base).text).toContain('cannot be undone');
  });

  it('points them at the quick comment for anything between updates', () => {
    expect(plmVendorUpdateInviteEmail(base).text).toContain('quick comment');
  });

  it('puts the link in both the HTML and the text alternative', () => {
    const { html, text } = plmVendorUpdateInviteEmail(base);
    expect(html).toContain(`href="${base.url}"`);
    // Repeated as copyable text for clients that strip the button.
    expect(html.split(base.url).length - 1).toBeGreaterThanOrEqual(2);
    expect(text).toContain(base.url);
  });

  it('greets the contact person, falling back to the company', () => {
    expect(plmVendorUpdateInviteEmail(base).text).toContain('Hello R. Iyer,');
    expect(
      plmVendorUpdateInviteEmail({ ...base, contactPersonName: null }).text,
    ).toContain('Hello Balaji MetalTech,');
    expect(
      plmVendorUpdateInviteEmail({ ...base, contactPersonName: '  ' }).text,
    ).toContain('Hello Balaji MetalTech,');
  });

  it('mentions a password only when the link has one, and never the password', () => {
    expect(plmVendorUpdateInviteEmail(base).text).not.toContain(
      'password-protected',
    );
    const guarded = plmVendorUpdateInviteEmail({
      ...base,
      passwordProtected: true,
    });
    expect(guarded.text).toContain('password-protected');
    expect(guarded.text).toContain('shared with you separately');
  });

  it('keeps the expiry as small print, using the shared link wording', () => {
    expect(plmVendorUpdateInviteEmail(base).text).toContain(
      'This link expires on 13 Sept 2026, 14 days from now.',
    );
    expect(
      plmVendorUpdateInviteEmail({
        ...base,
        expiresAt: new Date('2026-08-30T18:00:00.000Z'),
      }).text,
    ).toContain('This link expires today (30 Aug 2026).');
  });

  it('includes the sender note when supplied', () => {
    expect(
      plmVendorUpdateInviteEmail({
        ...base,
        note: 'Ramesh in Production is your contact for this order.',
      }).text,
    ).toContain('Ramesh in Production is your contact');
  });

  it('escapes caller text instead of emitting it as markup', () => {
    const { html, text } = plmVendorUpdateInviteEmail({
      ...base,
      productName: 'Kiosk <A & B>',
      contactPersonName: null,
    });
    expect(html).toContain('Kiosk &lt;A &amp; B&gt;');
    expect(html).not.toContain('<A & B>');
    expect(text).toContain('Kiosk <A & B>');
  });
});
