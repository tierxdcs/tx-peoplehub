export type Role = 'SUPER_ADMIN' | 'ADMIN' | 'MANAGER' | 'EMPLOYEE';

export interface DecodedAccessToken {
  sub: string;
  email: string;
  role: Role;
  verticalId: string | null;
  /**
   * True when an admin force-reset requires this user to set a new password
   * before doing anything else. Read straight from the token so the shell can
   * route into the forced-change screen without an API call. Absent on older
   * tokens → treated as false.
   */
  mustChangePassword?: boolean;
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
