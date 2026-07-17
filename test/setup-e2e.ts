import { PrismaClient } from '@prisma/client';
import { resetDb } from './reset-db';

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
