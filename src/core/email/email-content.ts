/**
 * Pure helpers behind EmailService — no SDK, no Nest, no I/O, so they can be
 * unit-tested directly and reused by env validation at boot.
 *
 * Everything that shapes an email (who it may go to, the text fallback, the
 * HTML shell) lives here so the seven Phase 2 features don't each hand-roll
 * their own version.
 */

/** A parsed `From`/`Reply-To` value: `Name <addr@example.com>` or `addr@example.com`. */
export interface EmailAddress {
  name?: string;
  address: string;
}

// Deliberately permissive (one @, no spaces, a dotted domain) — the mail
// provider is the real authority. This only catches the typo class that would
// otherwise fail silently at send time.
const ADDRESS_RE = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;
const FRIENDLY_RE = /^\s*(.*?)\s*<([^<>]+)>\s*$/;

/**
 * Parses a from/reply-to value. Returns null when it isn't a usable address,
 * which is how both Joi validation and the service report a bad EMAIL_FROM.
 */
export function parseEmailAddress(value: string): EmailAddress | null {
  if (!value) return null;
  const friendly = FRIENDLY_RE.exec(value);
  if (friendly) {
    const address = friendly[2].trim();
    if (!ADDRESS_RE.test(address)) return null;
    const name = friendly[1].replace(/^"|"$/g, '').trim();
    return name ? { name, address } : { address };
  }
  const address = value.trim();
  return ADDRESS_RE.test(address) ? { address } : null;
}

/** Boot-time guard for EMAIL_FROM / EMAIL_REPLY_TO. */
export function isValidEmailAddress(value: string): boolean {
  return parseEmailAddress(value) !== null;
}

/**
 * Normalizes a recipient list: accepts a single address, an array, or a
 * comma-separated string; trims, drops blanks, and de-duplicates
 * case-insensitively while preserving the caller's original casing.
 */
export function normalizeRecipients(to: string | string[]): string[] {
  const flat = (Array.isArray(to) ? to : [to])
    .flatMap((entry) => entry.split(','))
    .map((entry) => entry.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  return flat.filter((address) => {
    const key = address.toLocaleLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Parses EMAIL_ALLOWED_RECIPIENTS ("a@x.com, @y.com") into entries. */
export function parseAllowlist(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((entry) => entry.trim().toLocaleLowerCase())
    .filter(Boolean);
}

/**
 * Splits recipients into allowed/blocked against an allowlist. Entries are a
 * full address (`ops@acme.com`), a domain (`acme.com` or `@acme.com`), or `*`.
 * An empty allowlist allows everything — the production case; the allowlist
 * exists so a staging deploy can never mail a real customer by accident.
 */
export function filterRecipients(
  recipients: string[],
  allowlist: string[],
): { allowed: string[]; blocked: string[] } {
  if (allowlist.length === 0 || allowlist.includes('*')) {
    return { allowed: recipients, blocked: [] };
  }
  const domains = new Set(
    allowlist
      .filter((entry) => !entry.includes('@') || entry.startsWith('@'))
      .map((entry) => entry.replace(/^@/, '')),
  );
  const addresses = new Set(
    allowlist.filter((entry) => entry.includes('@') && !entry.startsWith('@')),
  );
  const allowed: string[] = [];
  const blocked: string[] = [];
  for (const recipient of recipients) {
    const lower = recipient.toLocaleLowerCase();
    const domain = lower.split('@')[1] ?? '';
    (addresses.has(lower) || domains.has(domain) ? allowed : blocked).push(
      recipient,
    );
  }
  return { allowed, blocked };
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const ENTITIES: Record<string, string> = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&mdash;': '—',
  '&ndash;': '–',
};

/**
 * Derives the plain-text alternative from an HTML body. Every email gets one:
 * text-only clients and most spam filters expect a multipart message, and a
 * link is useless if it only exists inside an anchor tag.
 */
export function plainTextFrom(html: string): string {
  return html
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, '')
    .replace(
      /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
      (_match, href: string, label: string) => {
        const text = label.replace(/<[^>]+>/g, '').trim();
        return !text || text === href ? href : `${text} (${href})`;
      },
    )
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6]|table|section)>/gi, '\n\n')
    .replace(/<li\b[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, '')
    .replace(/&#?\w+;/g, (entity) => ENTITIES[entity.toLowerCase()] ?? entity)
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** What a template produces: everything EmailService needs to send it. */
export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export interface EmailLayoutContent {
  /** Bold heading at the top of the card. */
  heading: string;
  /** Body paragraphs, in order. Plain text — escaped for you. */
  paragraphs?: string[];
  /** Optional single call-to-action button (invite links, upload links…). */
  cta?: { label: string; url: string };
  /** Small print under the card, e.g. "This link expires in 72 hours." */
  footnote?: string;
  /** Signature line; defaults to the product name. */
  signature?: string;
}

/**
 * The one HTML shell every outgoing email uses. Table-free, inline-styled,
 * and deliberately plain: email clients strip <style> blocks and classes, and
 * a single shared shell means a branding change is one edit, not seven.
 */
export function renderEmailLayout(content: EmailLayoutContent): string {
  const paragraphs = (content.paragraphs ?? [])
    .map(
      (text) =>
        `<p style="margin:0 0 14px;font-size:15px;line-height:1.55;color:#1f2937;">${escapeHtml(
          text,
        )}</p>`,
    )
    .join('');
  const cta = content.cta
    ? `<p style="margin:22px 0;"><a href="${escapeHtml(
        content.cta.url,
      )}" style="display:inline-block;padding:11px 20px;border-radius:6px;background:#111827;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;">${escapeHtml(
        content.cta.label,
      )}</a></p>` +
      // Repeat the URL as text: some clients strip buttons, and recipients
      // behind link-rewriting gateways need something they can copy.
      `<p style="margin:0 0 14px;font-size:12px;line-height:1.5;color:#6b7280;word-break:break-all;">If the button doesn't work, copy this link into your browser:<br />${escapeHtml(
        content.cta.url,
      )}</p>`
    : '';
  const footnote = content.footnote
    ? `<p style="margin:18px 0 0;font-size:12px;line-height:1.5;color:#6b7280;">${escapeHtml(
        content.footnote,
      )}</p>`
    : '';
  const signature = escapeHtml(content.signature ?? 'tx-peoplehub');

  return [
    '<!doctype html><html><body style="margin:0;padding:24px;background:#f3f4f6;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">',
    '<div style="max-width:560px;margin:0 auto;padding:28px;background:#ffffff;border:1px solid #e5e7eb;border-radius:10px;">',
    `<h1 style="margin:0 0 16px;font-size:19px;line-height:1.35;color:#111827;">${escapeHtml(
      content.heading,
    )}</h1>`,
    paragraphs,
    cta,
    footnote,
    `<p style="margin:22px 0 0;padding-top:16px;border-top:1px solid #e5e7eb;font-size:12px;color:#6b7280;">${signature}</p>`,
    '</div></body></html>',
  ].join('');
}
