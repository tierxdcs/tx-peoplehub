const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';

export type PublicProgressStage = {
  key: string;
  label: string;
  state: 'DONE' | 'CURRENT' | 'UPCOMING';
};

export interface CustomerOrderProgress {
  orderNumber: string;
  customerName: string;
  productNames: string[];
  promisedDeliveryDate: string | null;
  countdown: {
    state: 'DUE' | 'OVERDUE' | 'DELIVERED' | 'UNKNOWN';
    days: number | null;
  };
  lines: Array<{
    lineId: string;
    productName: string;
    currentStage: { key: string; label: string };
    stages: PublicProgressStage[];
    productionPercent: number;
    pace: { elapsedDays: number; totalDays: number; percent: number } | null;
  }>;
  canSignoff: boolean;
  signoffSubmitted: boolean;
  signoffSubmittedAt: string | null;
}

export type PublicProgressResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; message: string };

async function post<T>(path: string, body: unknown): Promise<PublicProgressResult<T>> {
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
      message: json.message ?? 'Unable to open this progress link',
    };
  }
  return { ok: true, data: json.data as T };
}

const base = (token: string) =>
  `/public/order-progress/${encodeURIComponent(token)}`;

export const resolveCustomerOrderProgress = (token: string, password?: string) =>
  post<CustomerOrderProgress | { requiresPassword: true }>(
    `${base(token)}/resolve`,
    { password },
  );

export const submitCustomerDeliverySignoff = (
  token: string,
  body: {
    password?: string;
    customerName: string;
    designation: string;
    receiptConfirmed: boolean;
    comments?: string;
    satisfactionRating?: number;
  },
) => post<{ submittedAt: string; expiresAt: string }>(`${base(token)}/signoff`, body);
