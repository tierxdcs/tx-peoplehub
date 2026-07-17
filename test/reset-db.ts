import { PrismaClient } from '@prisma/client';
import { seed } from '../prisma/seed';

/**
 * Clean-slate reset for e2e suites.
 *
 * WHY: every *.e2e-spec.ts shares one Postgres database and Jest's
 * `maxWorkers: 1` only serialises execution — it does NOT isolate state. Suites
 * left rows behind (or relied on the seed being pristine), so running the full
 * unfiltered `test:e2e` produced failures that never occurred in isolation. This
 * gives each suite file a pristine baseline before its first test.
 *
 * WHAT: `TRUNCATE ... RESTART IDENTITY CASCADE` on every application table
 * (discovered dynamically from the catalog, so it never goes stale as new
 * modules add tables), then re-runs the idempotent baseline seed
 * (SUPER_ADMIN, Verticals, LeaveTypes, BidAssessmentQuestions, default Vault
 * folders). Prisma's own `_prisma_migrations` table is preserved so the schema
 * is not re-migrated.
 *
 * GRANULARITY: per suite file (via a beforeAll in setup-e2e.ts), not per test —
 * individual specs already clean up their own rows, and a per-test truncate
 * would add real overhead for little gain.
 */
export async function resetDb(prisma: PrismaClient): Promise<void> {
  const rows = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `;
  if (rows.length > 0) {
    const list = rows.map((r) => `"public"."${r.tablename}"`).join(', ');
    // Single statement so CASCADE resolves all FKs at once; RESTART IDENTITY
    // resets sequences (e.g. employee_id_seq) so IDs are deterministic per run.
    await prisma.$executeRawUnsafe(
      `TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`,
    );
  }
  await seed(prisma);
}
