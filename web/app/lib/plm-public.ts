const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';

export interface PlmPublicUpdate {
  id: string;
  reporterType: 'VENDOR_SELF_REPORT' | 'INTERNAL_AUDITOR_VISIT';
  reporterDisplayName: string;
  fabricationPercent: number;
  surfaceFinishPercent: number;
  assemblyPercent: number;
  notes: string | null;
  createdAt: string;
}

export interface PlmPublicView {
  trackerId: string;
  orderNumber: string;
  product: { name: string; sku: string };
  vendorName: string;
  currentStage: string;
  updates: PlmPublicUpdate[];
}

type PublicResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; message: string };

async function publicPost<T>(path: string, body: unknown): Promise<PublicResult<T>> {
  const response = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok || json.success === false) {
    return {
      ok: false,
      status: response.status,
      message: json.message ?? 'Request failed',
    };
  }
  return { ok: true, data: json.data as T };
}

const base = (token: string) =>
  `/public/plm-vendor-update/${encodeURIComponent(token)}`;

export const resolvePlmVendorUpdate = (token: string, password?: string) =>
  publicPost<PlmPublicView>(`${base(token)}/resolve`, { password });

export const createPlmPhotoUploadUrl = (
  token: string,
  body: { password?: string; name: string; mimeType: string; sizeBytes: number },
) =>
  publicPost<{ storageKey: string; uploadUrl: string; expiresInSeconds: number }>(
    `${base(token)}/photo-upload-url`,
    body,
  );

export const submitPlmVendorUpdate = (
  token: string,
  body: {
    password?: string;
    fabricationPercent: number;
    surfaceFinishPercent: number;
    assemblyPercent: number;
    notes?: string;
    photos?: Array<{ storageKey: string; fileName: string }>;
  },
) => publicPost<PlmPublicUpdate>(`${base(token)}/submit`, body);
