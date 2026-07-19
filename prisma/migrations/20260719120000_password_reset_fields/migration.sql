-- Password reset / force-change support. Additive, safe defaults:
--  - tokenVersion: bumped to invalidate all prior JWTs (session invalidation).
--  - mustChangePassword: set by an admin force-reset; a guard blocks everything
--    but change-password until the user resets. Both default sensibly for
--    existing rows (version 0, not forced).
ALTER TABLE "employees" ADD COLUMN "tokenVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "employees" ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;
