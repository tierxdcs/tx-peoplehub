import { apiFetch } from './api';
import { uploadToPresignedUrl } from './vault-api';
import { Employee } from './types';

/**
 * Employee-photo helpers. Photos ride the same presigned direct-to-R2 flow as
 * Vault/PLM: mint an upload URL, PUT the bytes straight to storage, then hand
 * the returned storageKey back to the onboard/edit endpoints — the bytes never
 * pass through the backend.
 */

export interface PhotoUploadUrl {
  storageKey: string;
  uploadUrl: string;
  expiresInSeconds: number;
}

/** Client-side guard so we fail fast before minting a URL. Backend re-checks. */
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024; // 10 MB is ample for a photo.

/**
 * Upload a photo file to R2 and return its storageKey. Validates that the file
 * is an image and within the size guard before requesting a presigned URL.
 */
export async function uploadEmployeePhoto(
  file: File,
  onProgress?: (fraction: number) => void,
): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Please choose an image file (JPG, PNG, …).');
  }
  if (file.size > MAX_PHOTO_BYTES) {
    throw new Error('Photo must be 10 MB or smaller.');
  }
  const { storageKey, uploadUrl } = await apiFetch<PhotoUploadUrl>(
    '/employees/photo-upload-url',
    {
      method: 'POST',
      body: JSON.stringify({
        name: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
      }),
    },
  );
  await uploadToPresignedUrl(uploadUrl, file, onProgress);
  return storageKey;
}

/** Set/replace an existing employee's photo with an already-uploaded object. */
export const setEmployeePhoto = (employeeId: string, storageKey: string) =>
  apiFetch<Employee>(`/employees/${employeeId}/photo`, {
    method: 'PATCH',
    body: JSON.stringify({ storageKey }),
  });

/** Remove an existing employee's photo. */
export const removeEmployeePhoto = (employeeId: string) =>
  apiFetch<Employee>(`/employees/${employeeId}/photo`, { method: 'DELETE' });

/** Fetch a short-lived signed URL for an employee's photo (null if none). */
export const getEmployeePhotoUrl = (employeeId: string) =>
  apiFetch<{ url: string | null; expiresInSeconds: number | null }>(
    `/employees/${employeeId}/photo-url`,
  );
