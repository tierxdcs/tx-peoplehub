const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';

/**
 * Current access token, held in memory only (never localStorage). Source of
 * truth for apiFetch; AuthProvider mirrors it into React state for re-renders.
 */
let accessToken: string | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
  }
}

interface Envelope<T> {
  success: boolean;
  data?: T;
  message?: string;
  statusCode?: number;
}

async function rawFetch(path: string, options: RequestInit = {}) {
  return fetch(`${API_URL}${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...options.headers,
    },
  });
}

/** Exchanges the httpOnly refresh cookie for a new access token. */
export async function refreshAccessToken(): Promise<string | null> {
  const res = await fetch(`${API_URL}/auth/refresh`, {
    method: 'POST',
    credentials: 'include',
  });
  if (!res.ok) {
    setAccessToken(null);
    return null;
  }
  const body = (await res.json()) as Envelope<{ accessToken: string }>;
  const token = body.data?.accessToken ?? null;
  setAccessToken(token);
  return token;
}

/**
 * Fetches from the API, unwraps the {success, data} envelope, and retries
 * once via silent refresh on a 401 (access token expired mid-session).
 */
export async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
  { skipRetry = false }: { skipRetry?: boolean } = {},
): Promise<T> {
  let res = await rawFetch(path, options);

  if (res.status === 401 && !skipRetry) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      res = await rawFetch(path, options);
    }
  }

  const body = (await res.json()) as Envelope<T>;
  if (!res.ok || !body.success) {
    throw new ApiError(body.message ?? 'Request failed', res.status);
  }
  return body.data as T;
}
