/**
 * Standalone Resend check for the shared EmailService.
 *
 * Proves the three things Phase 1 has to prove, in order:
 *
 *   1. the API key is valid                (list sending domains)
 *   2. SPF + DKIM are actually VERIFIED    (per-record status from the API,
 *      not merely "records added" — a domain sitting at `pending` fails here)
 *   3. a real email sends                  (through the same payload shape
 *      EmailService builds: from, to, subject, html + derived text)
 *
 * Usage — supply the SAME values you set on Railway (never commit them):
 *
 *   RESEND_API_KEY="re_…" EMAIL_FROM="tx-peoplehub <no-reply@your-domain>" \
 *   EMAIL_TEST_TO="you@your-company.com" node scripts/verify-email.js
 *
 * Or `export` them / source your env file first, then run the bare command.
 * Add `--no-send` to run the config + DNS checks only (steps 1–3).
 * Exits 0 on full success, 1 on the first failing step (with a hint).
 */
const { Resend } = require('resend');

const {
  RESEND_API_KEY,
  EMAIL_FROM,
  EMAIL_REPLY_TO,
  EMAIL_TEST_TO,
} = process.env;
const SEND = !process.argv.includes('--no-send');

// Same permissive shape EmailService/env validation accept: bare address or
// "Name <addr@domain>".
const ADDRESS_RE = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;
function addressOf(value) {
  const friendly = /^\s*(.*?)\s*<([^<>]+)>\s*$/.exec(value || '');
  const address = friendly ? friendly[2].trim() : (value || '').trim();
  return ADDRESS_RE.test(address) ? address : null;
}

function fail(step, err, hint) {
  console.error(`\n✗ FAILED at step: ${step}`);
  if (err) console.error(`  ${err.name || 'Error'}: ${err.message || err}`);
  if (hint) console.error(`  → ${hint}`);
  process.exit(1);
}

async function main() {
  // ── Pre-flight: presence + format (mirrors the app's Joi rules) ──────
  const missing = [];
  if (!RESEND_API_KEY) missing.push('RESEND_API_KEY');
  if (!EMAIL_FROM) missing.push('EMAIL_FROM');
  if (SEND && !EMAIL_TEST_TO) missing.push('EMAIL_TEST_TO');
  if (missing.length) {
    fail(
      'config check',
      new Error(`missing env var(s): ${missing.join(', ')}`),
      'Set them for this command only — the key must never be committed or ' +
        'pasted anywhere but the Railway environment.',
    );
  }
  const fromAddress = addressOf(EMAIL_FROM);
  if (!fromAddress) {
    fail(
      'config check',
      new Error(`EMAIL_FROM is not a valid address: "${EMAIL_FROM}"`),
      'Use "Name <no-reply@your-domain>" or "no-reply@your-domain".',
    );
  }
  if (EMAIL_REPLY_TO && !addressOf(EMAIL_REPLY_TO)) {
    fail(
      'config check',
      new Error(`EMAIL_REPLY_TO is not a valid address: "${EMAIL_REPLY_TO}"`),
    );
  }
  const fromDomain = fromAddress.split('@')[1].toLowerCase();

  console.log('Resend email smoke test');
  console.log(`  from     : ${EMAIL_FROM}`);
  console.log(`  domain   : ${fromDomain}`);
  console.log(`  reply-to : ${EMAIL_REPLY_TO || '(none)'}`);
  console.log(`  key      : ${RESEND_API_KEY.slice(0, 6)}…`);
  console.log(`  test to  : ${SEND ? EMAIL_TEST_TO : '(skipped, --no-send)'}`);

  const resend = new Resend(RESEND_API_KEY);
  const steps = SEND ? 4 : 3;

  // 1. the key works at all
  let domains;
  try {
    const { data, error } = await resend.domains.list();
    if (error) throw new Error(error.message);
    domains = (data && data.data) || [];
    console.log(
      `\n✓ 1/${steps} API key accepted — ${domains.length} sending domain(s) on the account`,
    );
  } catch (e) {
    fail(
      'list domains',
      e,
      'Key is wrong, revoked, or lacks full access. Create a new key in the ' +
        'Resend dashboard and set RESEND_API_KEY on Railway.',
    );
  }

  // 2. the from-domain is actually registered
  const domain = domains.find((d) => d.name.toLowerCase() === fromDomain);
  if (!domain) {
    fail(
      'find sending domain',
      new Error(`"${fromDomain}" is not a domain on this Resend account`),
      `Add it in Resend → Domains (found: ${
        domains.map((d) => d.name).join(', ') || 'none'
      }). EMAIL_FROM must be on a verified domain.`,
    );
  }
  console.log(
    `✓ 2/${steps} "${domain.name}" found on the account (status: ${domain.status})`,
  );

  // 3. SPF + DKIM verified — the actual DNS requirement. domains.list() omits
  //    the records, so fetch the domain to see each record's own status.
  let records = [];
  try {
    const { data, error } = await resend.domains.get(domain.id);
    if (error) throw new Error(error.message);
    records = (data && data.records) || [];
  } catch (e) {
    fail('read domain records', e);
  }
  console.log(`\n  DNS records for ${domain.name}:`);
  for (const record of records) {
    const mark = record.status === 'verified' ? '✓' : '✗';
    console.log(
      `    ${mark} ${String(record.type).padEnd(5)} ${record.name || '@'} → ${record.status}`,
    );
  }
  const unverified = records.filter((r) => r.status !== 'verified');
  if (domain.status !== 'verified' || unverified.length > 0) {
    fail(
      'verify SPF/DKIM',
      new Error(
        `domain status "${domain.status}"; ${unverified.length} record(s) not verified: ` +
          unverified.map((r) => `${r.type} ${r.name || '@'} (${r.status})`).join(', '),
      ),
      'Add the exact records shown in Resend → Domains to the DNS zone, then ' +
        'press Verify. Propagation can take up to an hour; re-run this script ' +
        'until every line above is ✓.',
    );
  }
  console.log(
    `✓ 3/${steps} SPF + DKIM verified (${records.length}/${records.length} records)`,
  );

  if (!SEND) {
    console.log(
      '\n✅ Key and DNS are correct. Re-run without --no-send to send a test email.',
    );
    process.exit(0);
  }

  // 4. a real send, using the payload shape EmailService builds
  const html =
    '<!doctype html><html><body><h1>Email is working</h1>' +
    '<p>Sent by scripts/verify-email.js through the same Resend setup the backend uses.</p>' +
    '</body></html>';
  try {
    const { data, error } = await resend.emails.send({
      from: EMAIL_FROM,
      to: [EMAIL_TEST_TO],
      subject: 'tx-peoplehub email verification',
      html,
      text: 'Email is working. Sent by scripts/verify-email.js through the same Resend setup the backend uses.',
      replyTo: EMAIL_REPLY_TO || undefined,
      tags: [{ name: 'kind', value: 'verify-script' }],
    });
    if (error) throw new Error(error.message);
    console.log(`✓ 4/${steps} test email accepted — message id ${data.id}`);
  } catch (e) {
    fail(
      'send test email',
      e,
      'A 403/422 here almost always means EMAIL_FROM is not on the verified ' +
        'domain, or the recipient is on the account suppression list.',
    );
  }

  console.log(
    `\n✅ Email is correctly configured — key valid, ${domain.name} SPF/DKIM ` +
      `verified, and a live send succeeded to ${EMAIL_TEST_TO}. Check the inbox ` +
      '(and the spam folder — if it landed there, DNS is fine but the domain ' +
      'still needs sending reputation).',
  );
  process.exit(0);
}

main().catch((e) => fail('unexpected', e));
