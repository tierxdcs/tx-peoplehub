import { ForbiddenException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import * as bcrypt from 'bcrypt';

/**
 * Shared token-invite mechanism for unauthenticated public links (Vault
 * external shares, Vendor Qualification questionnaires, Supplier Qualification
 * questionnaires — three call sites, so the behavior lives here rather than
 * being copy-pasted a third time).
 *
 * Deliberately NOT a shared table: each module keeps its own invite row (its
 * own FK to the resource, its own module-specific fields). What's shared is the
 * *behavior* — cryptographic token generation, expiry computation, password
 * hashing, and the exact validation sequence (unknown→404 handled by callers;
 * revoked/expired/bad-password→403 here). The validated invite shape is the
 * minimal set every caller's row satisfies.
 */

/** A URL-safe, cryptographically random invite token. */
export function generateInviteToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Absolute expiry from now + a lifetime in hours. */
export function computeExpiry(expiresInHours: number, now: Date = new Date()): Date {
  return new Date(now.getTime() + expiresInHours * 60 * 60 * 1000);
}

/** Hash an optional invite password (null when none supplied). */
export function hashInvitePassword(
  password: string | undefined,
): Promise<string | null> {
  return password ? bcrypt.hash(password, 10) : Promise.resolve(null);
}

/** The minimal invite shape the validator needs. */
export interface UsableInvite {
  revokedAt: Date | null;
  expiresAt: Date;
  passwordHash: string | null;
}

/**
 * Enforce revoke/expiry/password on a resolved invite. Throws ForbiddenException
 * (revoked / expired / missing-or-wrong password) — matching the Vault public
 * convention. The caller is responsible for the unknown-token 404 (it already
 * has to look the row up). `now` is injectable for deterministic tests.
 */
export async function assertInviteUsable(
  invite: UsableInvite,
  password: string | undefined,
  now: Date = new Date(),
): Promise<void> {
  if (invite.revokedAt) throw new ForbiddenException('This link has been revoked');
  if (invite.expiresAt <= now) throw new ForbiddenException('This link has expired');
  if (invite.passwordHash) {
    const ok = password
      ? await bcrypt.compare(password, invite.passwordHash)
      : false;
    if (!ok) throw new ForbiddenException('A valid password is required');
  }
}
