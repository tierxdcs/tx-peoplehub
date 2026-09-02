import { candidateApplicationInviteEmail } from './candidate-application-invite';

describe('candidateApplicationInviteEmail', () => {
  const now = new Date('2026-08-30T10:00:00.000Z');
  const base = {
    positionTitle: 'Operations Manager',
    requisitionNumber: 'REQ-2026-0001',
    verticalName: 'Production',
    employmentType: 'FULL_TIME_PERMANENT',
    url: 'https://app.example.com/public/job-applications/tok_abc123',
    expiresAt: new Date('2026-11-30T10:00:00.000Z'),
    passwordProtected: false,
    organisationName: 'Phaze Dynamics',
    now,
    timezone: 'Asia/Kolkata',
  };

  it('names the role and the employer in the subject', () => {
    expect(candidateApplicationInviteEmail(base).subject).toBe(
      'Operations Manager at Phaze Dynamics — apply now',
    );
  });

  it('qualifies the role with the vertical and a readable employment type', () => {
    expect(candidateApplicationInviteEmail(base).text).toContain(
      'Operations Manager (Production · Full time permanent)',
    );
  });

  it('drops whichever qualifier we do not hold', () => {
    expect(
      candidateApplicationInviteEmail({ ...base, verticalName: null }).text,
    ).toContain('Operations Manager (Full time permanent)');
    expect(
      candidateApplicationInviteEmail({ ...base, employmentType: null }).text,
    ).toContain('Operations Manager (Production)');
    // Neither qualifier: no empty parentheses.
    expect(
      candidateApplicationInviteEmail({
        ...base,
        verticalName: '  ',
        employmentType: null,
      }).text,
    ).toContain('is hiring for Operations Manager, and');
  });

  it('puts the application link in both the HTML and the text alternative', () => {
    const { html, text } = candidateApplicationInviteEmail(base);
    expect(html).toContain(`href="${base.url}"`);
    // Repeated as copyable text for clients that strip the button.
    expect(html.split(base.url).length - 1).toBeGreaterThanOrEqual(2);
    expect(text).toContain(base.url);
  });

  it('includes the optional note, and nothing when it is blank', () => {
    expect(
      candidateApplicationInviteEmail({
        ...base,
        note: 'We spoke at the Bengaluru career fair.',
      }).text,
    ).toContain('We spoke at the Bengaluru career fair.');
    expect(
      candidateApplicationInviteEmail({ ...base, note: '   ' }).text,
    ).not.toMatch(/\n\s*\n\s*\n/);
  });

  it('mentions a password only when the link has one, and never the password', () => {
    expect(candidateApplicationInviteEmail(base).text).not.toContain(
      'password-protected',
    );
    const locked = candidateApplicationInviteEmail({
      ...base,
      passwordProtected: true,
    });
    expect(locked.text).toContain('password-protected');
    expect(locked.text).toContain('shared with you separately');
  });

  it('quotes the requisition number and the link expiry in the footnote', () => {
    const { text } = candidateApplicationInviteEmail(base);
    expect(text).toContain('Reference REQ-2026-0001');
    expect(text).toMatch(/expires/i);
  });

  // The CTC budget, the business justification and the KPIs sit next to this
  // link in the UI. They are internal hiring-plan figures, and quoting a budget
  // to a candidate is an offer we have not made — the input cannot even carry
  // them, and this test is what keeps it that way.
  it('never leaks the requisition budget or justification', () => {
    const { html, text } = candidateApplicationInviteEmail(base);
    for (const body of [html, text]) {
      expect(body).not.toMatch(/ctc|budget|justification|kpi|₹/i);
    }
  });
});
