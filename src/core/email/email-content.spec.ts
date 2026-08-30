import {
  filterRecipients,
  isValidEmailAddress,
  normalizeRecipients,
  parseAllowlist,
  parseEmailAddress,
  plainTextFrom,
  renderEmailLayout,
} from './email-content';

describe('parseEmailAddress', () => {
  it('accepts a bare address and a friendly one', () => {
    expect(parseEmailAddress('ops@acme.com')).toEqual({
      address: 'ops@acme.com',
    });
    expect(parseEmailAddress('tx-peoplehub <no-reply@acme.com>')).toEqual({
      name: 'tx-peoplehub',
      address: 'no-reply@acme.com',
    });
    expect(parseEmailAddress('"Acme Ops" <ops@acme.com>')).toEqual({
      name: 'Acme Ops',
      address: 'ops@acme.com',
    });
  });

  it('rejects the typo class that would otherwise fail at send time', () => {
    for (const bad of ['', 'ops', 'ops@acme', 'ops acme.com', 'a@b@c.com']) {
      expect(isValidEmailAddress(bad)).toBe(false);
    }
  });
});

describe('normalizeRecipients', () => {
  it('accepts a string, a list, or a comma-separated string', () => {
    expect(normalizeRecipients('a@x.com')).toEqual(['a@x.com']);
    expect(normalizeRecipients(' a@x.com , b@x.com ')).toEqual([
      'a@x.com',
      'b@x.com',
    ]);
    expect(normalizeRecipients(['a@x.com', '', ' b@x.com'])).toEqual([
      'a@x.com',
      'b@x.com',
    ]);
  });

  it('de-duplicates case-insensitively, keeping the first spelling', () => {
    expect(normalizeRecipients(['A@x.com', 'a@x.com'])).toEqual(['A@x.com']);
  });
});

describe('filterRecipients', () => {
  it('allows everything when the allowlist is empty (production)', () => {
    expect(filterRecipients(['a@x.com'], [])).toEqual({
      allowed: ['a@x.com'],
      blocked: [],
    });
  });

  it('matches full addresses and whole domains', () => {
    const allowlist = parseAllowlist('ops@acme.com, @staff.acme.com, dev.io');
    const result = filterRecipients(
      ['OPS@acme.com', 'other@acme.com', 'a@staff.acme.com', 'b@dev.io'],
      allowlist,
    );
    expect(result.allowed).toEqual([
      'OPS@acme.com',
      'a@staff.acme.com',
      'b@dev.io',
    ]);
    expect(result.blocked).toEqual(['other@acme.com']);
  });

  it('treats * as no restriction', () => {
    expect(filterRecipients(['a@x.com'], ['*']).blocked).toEqual([]);
  });
});

describe('plainTextFrom', () => {
  it('keeps link URLs, which is the whole point of the text part', () => {
    const text = plainTextFrom(
      '<p>Open the <a href="https://app.acme.com/i/abc">invite</a>.</p>',
    );
    expect(text).toBe('Open the invite (https://app.acme.com/i/abc).');
  });

  it('turns block markup into line breaks and drops styles', () => {
    const text = plainTextFrom(
      '<style>p{color:red}</style><h1>Hi</h1><p>One<br />Two</p><ul><li>a</li><li>b</li></ul>',
    );
    expect(text).toBe('Hi\n\nOne\nTwo\n\n- a\n\n- b');
  });

  it('decodes the entities the layout escapes', () => {
    expect(plainTextFrom('<p>Acme &amp; Co &#39;24&nbsp;&mdash; ok</p>')).toBe(
      "Acme & Co '24 — ok",
    );
  });
});

describe('renderEmailLayout', () => {
  const html = renderEmailLayout({
    heading: 'Vendor qualification',
    paragraphs: ['Please complete <the> form.'],
    cta: { label: 'Open form', url: 'https://app.acme.com/q/abc?t=1&u=2' },
    footnote: 'Link expires in 72 hours.',
  });

  it('escapes caller text but leaves the URL usable', () => {
    expect(html).toContain('Please complete &lt;the&gt; form.');
    expect(html).toContain('href="https://app.acme.com/q/abc?t=1&amp;u=2"');
  });

  it('repeats the CTA link as copyable text for clients that strip buttons', () => {
    expect(html.match(/app\.acme\.com\/q\/abc/g)?.length).toBe(2);
  });

  it('survives the round trip to plain text with the link intact', () => {
    const text = plainTextFrom(html);
    expect(text).toContain('Open form (https://app.acme.com/q/abc?t=1&u=2)');
    expect(text).toContain('Link expires in 72 hours.');
    // No markup survives — but escaped caller text does come back as itself.
    expect(text).not.toContain('</');
    expect(text).not.toContain('style=');
    expect(text).toContain('Please complete <the> form.');
  });
});
