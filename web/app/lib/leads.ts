'use client';

import { apiFetch } from './api';
import { uploadToPresignedUrl } from './vault-api';
import type {
  Lead,
  LeadAttachment,
  VaultUploadUrlResponse,
} from './types';

export function getLead(id: string) {
  return apiFetch<Lead>(`/leads/${id}`);
}

export function listLeadAttachments(leadId: string) {
  return apiFetch<LeadAttachment[]>(`/leads/${leadId}/attachments`);
}

export function deleteLeadAttachment(leadId: string, attachmentId: string) {
  return apiFetch<void>(`/leads/${leadId}/attachments/${attachmentId}`, {
    method: 'DELETE',
  });
}

/**
 * Attach a file to a lead. The file becomes a real VaultFile (so the in-app
 * Vault previewer works), then a LeadAttachment row links it to the lead:
 *  1. resolve the Sales "Lead Attachments" Vault folder,
 *  2. presign an upload into it, PUT the bytes to R2 (with progress),
 *  3. confirm the upload (kicks off preview generation),
 *  4. link the confirmed VaultFile to the lead.
 */
export async function uploadLeadAttachment(
  leadId: string,
  file: File,
  onProgress?: (fraction: number) => void,
): Promise<LeadAttachment> {
  const { folderId } = await apiFetch<{ folderId: string }>(
    '/leads/attachments-folder',
  );
  const presign = await apiFetch<VaultUploadUrlResponse>(
    '/vault/files/upload-url',
    {
      method: 'POST',
      body: JSON.stringify({
        folderId,
        name: file.name,
        mimeType: file.type || 'application/octet-stream',
        sizeBytes: file.size,
      }),
    },
  );
  await uploadToPresignedUrl(presign.uploadUrl, file, onProgress);
  await apiFetch(`/vault/files/${presign.file.id}/confirm-upload`, {
    method: 'POST',
  });
  return apiFetch<LeadAttachment>(`/leads/${leadId}/attachments`, {
    method: 'POST',
    body: JSON.stringify({ vaultFileId: presign.file.id }),
  });
}
