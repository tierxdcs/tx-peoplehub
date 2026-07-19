import { PrismaClient } from '@prisma/client';
import { resetDb } from './reset-db';

/**
 * Global hook/test timeout for ALL e2e suites (registered via
 * `setupFilesAfterEnv`, so this runs in every suite's environment before its
 * hooks). Each suite's own `beforeAll` boots a full Nest app
 * (`NestFactory.create()` + `app.init()`) + logs in; a cold boot measures only
 * ~25–80ms in isolation, but during the full serial run (21+ suites back to
 * back on a many-core box, each booting + tearing down an app and warming a
 * fresh DB connection) a boot occasionally crosses Jest's DEFAULT 5000ms hook
 * timeout under GC/JIT/connection-warmup load — even though nothing is hung.
 * That produced the intermittent "Exceeded timeout of 5000 ms for a hook"
 * flake that hit a different suite each run. 30s gives generous headroom over
 * the real ~sub-second boot without masking a genuine hang (a truly stuck boot
 * still fails, just later). Kept in ONE place so individual suites don't each
 * need a per-hook timeout arg.
 */
jest.setTimeout(30_000);

/**
 * Runs once per e2e suite file (registered via `setupFilesAfterEnv` in
 * test/jest-e2e.json). Before any test in the file runs, it resets the shared
 * database to a pristine seeded baseline — see test/reset-db.ts for the why.
 *
 * Uses a dedicated PrismaClient because this executes before the Nest app (and
 * therefore its DI-managed PrismaService) is created inside each suite. Capped
 * to a single connection (`connection_limit=1`) since it only runs a sequential
 * truncate + seed — this avoids piling a full pool per suite on top of each
 * app's PrismaService pool and exhausting Postgres `max_connections`.
 */
function withConnectionLimit(url: string): string {
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}connection_limit=1`;
}

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: withConnectionLimit(process.env.DATABASE_URL ?? ''),
    },
  },
});

beforeAll(async () => {
  await resetDb(prisma);
}, 60_000);

afterAll(async () => {
  await prisma.$disconnect();
});
