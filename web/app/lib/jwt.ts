export type Role = 'SUPER_ADMIN' | 'ADMIN' | 'MANAGER' | 'EMPLOYEE';

export interface DecodedAccessToken {
  sub: string;
  email: string;
  role: Role;
  verticalId: string | null;
}

/**
 * Decodes a JWT payload for UI routing only — no signature verification.
 * The backend (JwtAuthGuard/RolesGuard) is the real security boundary.
 */
export function decodeAccessToken(token: string): DecodedAccessToken {
  const payload = token.split('.')[1];
  const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
  return JSON.parse(json) as DecodedAccessToken;
}
