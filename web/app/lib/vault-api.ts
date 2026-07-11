import type { PublicSharedResource } from './types';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';

/**
 * Vault needs two fetches the shared apiFetch() helper can't do:
 *  1. Uploading raw bytes to R2 via a presigned PUT — no Authorization header,
 *     no JSON content-type (the browser sends the file's own bytes/type), and
 *     we want upload PROGRESS, which fetch() can't report. XHR is used so the
 *     500MB-cap uploads show a real progress bar (spec §3).
 *  2. Resolving a public share link WITHOUT auth — apiFetch would attach the
 *     session bearer token if one exists; the public route must be truly
 *     anonymous.
 */

/** PUT bytes to a presigned R2 URL with progress. Resolves on 2xx, rejects otherwise. */
export function uploadToPresignedUrl(
  url: string,
  file: File,
  onProgress?: (fraction: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    // Match the content-type the presign was minted for (the mimeType we
    // declared to /upload-url) so R2's signature check passes.
    if (file.type) {
      xhr.setRequestHeader('Content-Type', file.type);
    }
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(e.loaded / e.total);
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(new Error(`Upload failed (${xhr.status})`));
      }
    };
    xhr.onerror = () => reject(new Error('Upload failed — network error'));
    xhr.send(file);
  });
}

export type PublicShareResult =
  | { ok: true; resource: PublicSharedResource }
  | { ok: false; status: number; message: string; passwordRequired: boolean };

/**
 * Resolve a public share link with NO auth. Tries GET first (no-password
 * links); if the link needs a password the caller re-invokes with one, which
 * switches to the POST-with-body variant so the password never rides in the
 * URL. Returns a discriminated result rather than throwing, so the public
 * page can render clean "expired / revoked / password" messaging.
 */
export async function resolvePublicShare(
  token: string,
  password?: string,
): Promise<PublicShareResult> {
  const encoded = encodeURIComponent(token);
  const res = await fetch(`${API_URL}/public/vault/shared/${encoded}`, {
    method: password ? 'POST' : 'GET',
    ...(password
      ? {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password }),
        }
      : {}),
  });

  const body = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    data?: PublicSharedResource;
    message?: string;
  };

  if (res.ok && body.success && body.data) {
    return { ok: true, resource: body.data };
  }

  const message = body.message ?? 'This link is no longer available.';
  // A 403 mentioning a password (or any 403 on a no-password GET attempt for a
  // protected link) means the caller should show the password prompt.
  const passwordRequired = res.status === 403 && /password/i.test(message);
  return { ok: false, status: res.status, message, passwordRequired };
}
