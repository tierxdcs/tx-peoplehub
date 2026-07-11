/**
 * Standalone Cloudflare R2 connectivity check for the Vault module.
 *
 * Exercises the EXACT lifecycle VaultStorageService performs, using the same
 * S3 client config (forcePathStyle + region 'auto'), so a pass here means the
 * deployed backend's R2 integration will work with these same credentials:
 *
 *   1. presign a PUT  → 2. upload bytes via the presigned URL (browser's role)
 *   3. HEAD the object → 4. presign a GET → 5. download + verify bytes
 *   6. copy the object → 7. delete both (prune/whole-file-delete cleanup)
 *
 * It writes ONE tiny throwaway object under `vault/_smoketest/…` and deletes
 * it (plus the copy) at the end, so it leaves the bucket clean.
 *
 * Usage — supply the SAME values you set on Railway (never commit them):
 *
 *   R2_ENDPOINT="https://<acct>.r2.cloudflarestorage.com" \
 *   R2_ACCESS_KEY_ID="…" R2_SECRET_ACCESS_KEY="…" R2_BUCKET="…" \
 *   node scripts/verify-r2.js
 *
 * Or `export` them / source your env file first, then run the bare command.
 * Exits 0 on full success, 1 on the first failing step (with a hint).
 */
const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  CopyObjectCommand,
  DeleteObjectCommand,
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const {
  R2_ENDPOINT,
  R2_REGION = 'auto',
  R2_ACCESS_KEY_ID,
  R2_SECRET_ACCESS_KEY,
  R2_BUCKET,
  R2_PRESIGN_TTL_SECONDS = '300',
} = process.env;

function fail(step, err, hint) {
  console.error(`\n✗ FAILED at step: ${step}`);
  if (err) console.error(`  ${err.name || 'Error'}: ${err.message || err}`);
  if (err && err.$metadata && err.$metadata.httpStatusCode) {
    console.error(`  HTTP status: ${err.$metadata.httpStatusCode}`);
  }
  if (hint) console.error(`  → ${hint}`);
  process.exit(1);
}

async function main() {
  // ── Pre-flight: presence + endpoint format (mirrors the app's Joi rules) ──
  const missing = [];
  if (!R2_ENDPOINT) missing.push('R2_ENDPOINT');
  if (!R2_ACCESS_KEY_ID) missing.push('R2_ACCESS_KEY_ID');
  if (!R2_SECRET_ACCESS_KEY) missing.push('R2_SECRET_ACCESS_KEY');
  if (!R2_BUCKET) missing.push('R2_BUCKET');
  if (missing.length) {
    fail(
      'config check',
      new Error(`missing env var(s): ${missing.join(', ')}`),
      'Set all four before running (same values as Railway).',
    );
  }
  try {
    const u = new URL(R2_ENDPOINT);
    if (u.protocol !== 'https:') throw new Error('not https');
    if (/\/./.test(u.pathname)) {
      console.warn(
        `⚠ R2_ENDPOINT has a path ("${u.pathname}"). It should be the bare\n` +
          `  account endpoint (https://<acct>.r2.cloudflarestorage.com) with NO\n` +
          `  bucket in it — the bucket goes in R2_BUCKET. Continuing anyway…`,
      );
    }
  } catch (e) {
    fail(
      'config check',
      e,
      'R2_ENDPOINT must be a full https URL, e.g. https://<acct>.r2.cloudflarestorage.com',
    );
  }

  console.log('R2 smoke test');
  console.log(`  endpoint : ${R2_ENDPOINT}`);
  console.log(`  bucket   : ${R2_BUCKET}`);
  console.log(`  region   : ${R2_REGION}`);
  console.log(`  key id   : ${R2_ACCESS_KEY_ID.slice(0, 4)}…`);

  const client = new S3Client({
    region: R2_REGION,
    endpoint: R2_ENDPOINT,
    forcePathStyle: true,
    credentials: {
      accessKeyId: R2_ACCESS_KEY_ID,
      secretAccessKey: R2_SECRET_ACCESS_KEY,
    },
  });

  const ttl = parseInt(R2_PRESIGN_TTL_SECONDS, 10) || 300;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const key = `vault/_smoketest/${stamp}.txt`;
  const copyKey = `vault/_smoketest/${stamp}-copy.txt`;
  const body = `vault r2 smoke test ${stamp}`;
  const bodyBytes = Buffer.byteLength(body);

  // 1. presign PUT
  let putUrl;
  try {
    putUrl = await getSignedUrl(
      client,
      new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: key,
        ContentType: 'text/plain',
      }),
      { expiresIn: ttl },
    );
    console.log('\n✓ 1/7 presigned PUT URL generated');
  } catch (e) {
    fail('presign PUT', e, 'Usually bad credentials or an unreachable endpoint.');
  }

  // 2. upload via the presigned URL (this is what the browser does)
  try {
    const res = await fetch(putUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'text/plain' },
      body,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`PUT returned ${res.status} ${res.statusText} ${text}`);
    }
    console.log('✓ 2/7 uploaded object via presigned URL (direct-to-R2 path)');
  } catch (e) {
    fail(
      'upload to presigned URL',
      e,
      '403 → key/secret or bucket permissions; 404 → bucket name wrong; ' +
        'network/DNS → endpoint wrong.',
    );
  }

  // 3. HEAD (what confirm-upload uses to verify size)
  try {
    const head = await client.send(
      new HeadObjectCommand({ Bucket: R2_BUCKET, Key: key }),
    );
    if (head.ContentLength !== bodyBytes) {
      throw new Error(
        `size mismatch: HEAD ${head.ContentLength} vs uploaded ${bodyBytes}`,
      );
    }
    console.log(`✓ 3/7 HEAD confirms object (${head.ContentLength} bytes)`);
  } catch (e) {
    fail('HEAD object', e, 'Object may not have persisted, or no read permission.');
  }

  // 4. presign GET + 5. download + verify
  try {
    const getUrl = await getSignedUrl(
      client,
      new GetObjectCommand({ Bucket: R2_BUCKET, Key: key }),
      { expiresIn: ttl },
    );
    const res = await fetch(getUrl);
    if (!res.ok) throw new Error(`GET returned ${res.status}`);
    const got = await res.text();
    if (got !== body) throw new Error('downloaded bytes do not match uploaded');
    console.log('✓ 4/7 presigned GET URL generated');
    console.log('✓ 5/7 downloaded object and verified bytes match');
  } catch (e) {
    fail('download via presigned GET', e);
  }

  // 6. copy (restore uses this)
  try {
    await client.send(
      new CopyObjectCommand({
        Bucket: R2_BUCKET,
        CopySource: `${R2_BUCKET}/${key}`,
        Key: copyKey,
      }),
    );
    console.log('✓ 6/7 server-side copy succeeded (version-restore path)');
  } catch (e) {
    fail('copy object', e, 'CopyObject permission may be missing on the token.');
  }

  // 7. delete both (prune / whole-file-delete cleanup)
  try {
    await client.send(
      new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: key }),
    );
    await client.send(
      new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: copyKey }),
    );
    console.log('✓ 7/7 deleted both objects (prune/delete path) — bucket clean');
  } catch (e) {
    fail(
      'delete object',
      e,
      `Delete permission may be missing. Manually remove ${key} and ${copyKey}.`,
    );
  }

  console.log(
    '\n✅ R2 is correctly configured — every operation VaultStorageService ' +
      'performs succeeded end-to-end.',
  );
  process.exit(0);
}

main().catch((e) => fail('unexpected', e));
