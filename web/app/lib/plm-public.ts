const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';

/**
 * Fixed sheet-metal fabrication routing — mirrors PLM_PRODUCTION_STEPS on the
 * backend. A progress update stores completedSteps = how many are done (in
 * order); percentComplete is derived as completedSteps / PLM_PRODUCTION_STEPS.length.
 */
export const PLM_PRODUCTION_STEPS = [
  'Material',
  'Cut',
  'Punch',
  'Bend',
  'Weld',
  'Powder Coating',
  'Assemble',
  'QC',
  'Pack',
] as const;

export interface PlmPublicUpdate {
  id: string;
  updateType: 'FULL_PROGRESS' | 'COMMENT_ONLY';
  reporterType: 'VENDOR_SELF_REPORT' | 'INTERNAL_AUDITOR_VISIT';
  reporterDisplayName: string;
  /** Count of completed routing steps (0..9); null for comment-only updates. */
  completedSteps: number | null;
  /** Server-derived percent from completedSteps; null for comment-only. */
  percentComplete: number | null;
  /** Legacy free-form percentages — present only on historical updates. */
  fabricationPercent: number | null;
  surfaceFinishPercent: number | null;
  assemblyPercent: number | null;
  notes: string | null;
  createdAt: string;
}

export interface PlmPublicView {
  trackerId: string;
  orderNumber: string;
  product: { name: string; sku: string };
  vendorName: string;
  currentStage: string;
  vendorUpdateCadenceDays: number;
  lastVendorUpdateAt: string | null;
  vendorCadenceStatus: 'GREEN' | 'AMBER' | 'RED';
  vendorUpdateDueAt: string;
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
    completedSteps: number;
    notes?: string;
    photos?: Array<{ storageKey: string; fileName: string }>;
  },
) => publicPost<PlmPublicUpdate>(`${base(token)}/submit`, body);

export const submitPlmVendorComment = (
  token: string,
  body: { password?: string; notes: string },
) => publicPost<PlmPublicUpdate>(`${base(token)}/comment`, body);
