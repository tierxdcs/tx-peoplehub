import 'dotenv/config';
import { readFile, stat } from 'node:fs/promises';
import { basename } from 'node:path';

type Envelope<T> = { success: boolean; data?: T; message?: string };

async function json<T>(response: Response): Promise<T> {
  const body = (await response.json()) as Envelope<T>;
  if (!response.ok || !body.success || !body.data) {
    throw new Error(body.message ?? `Request failed (${response.status})`);
  }
  return body.data;
}

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    throw new Error(
      'Usage: ts-node scripts/configure-nda-template.ts /path/to/NDA.pdf',
    );
  }
  const api = process.env.NDA_CONFIG_API_URL ?? 'http://127.0.0.1:3000';
  const email =
    process.env.SEED_ADMIN_EMAIL ?? 'nithin.gangadhar@phaze-dynamics.com';
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!password) throw new Error('SEED_ADMIN_PASSWORD is required');

  const auth = await json<{ accessToken: string }>(
    await fetch(`${api}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    }),
  );
  const fileStat = await stat(filePath);
  const upload = await json<{ fileId: string; uploadUrl: string }>(
    await fetch(`${api}/admin/company-documents/nda-template/upload-url`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${auth.accessToken}`,
      },
      body: JSON.stringify({
        name: basename(filePath),
        mimeType: 'application/pdf',
        sizeBytes: fileStat.size,
      }),
    }),
  );
  const put = await fetch(upload.uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/pdf' },
    body: await readFile(filePath),
  });
  if (!put.ok) throw new Error(`R2 upload failed (${put.status})`);
  await json<{ fileId: string }>(
    await fetch(`${api}/admin/company-documents/nda-template/confirm`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${auth.accessToken}`,
      },
      body: JSON.stringify({ fileId: upload.fileId }),
    }),
  );
  // eslint-disable-next-line no-console
  console.log('NDA template configured successfully.');
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
