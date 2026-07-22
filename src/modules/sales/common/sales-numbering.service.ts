import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/database/prisma.service';

/**
 * Year-prefixed, annually-resetting human-readable numbers:
 * `LD-2026-0001`, `BID-2026-0001`, `ORD-2026-0001`.
 *
 * A plain Postgres sequence (like employee_id_seq) can't reset per calendar
 * year, so numbering is backed by the `sales_sequences` counter table keyed
 * by (entity, year). The next value is obtained with a single atomic
 * `INSERT ... ON CONFLICT (entity, year) DO UPDATE SET lastValue =
 * sales_sequences.lastValue + 1 RETURNING lastValue` — the row-level lock
 * Postgres takes on the conflicting row serializes concurrent callers, so
 * no two records ever get the same number even under parallel creation. The
 * first record of a new year inserts lastValue = 1, restarting the count.
 *
 * Always call inside the same transaction as the record insert (pass `tx`)
 * so a rolled-back create doesn't burn a number — matching how employeeId
 * is allocated inside its onboarding transaction.
 */
@Injectable()
export class SalesNumberingService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * @param prefix e.g. 'LD' | 'BID' | 'ORD'
   * @param entity the sequence key (kept distinct from prefix so a prefix
   *   rename never silently resets a live counter)
   * @param year   calendar year the number belongs to
   * @param tx     the enclosing transaction client
   */
  async nextNumber(
    prefix: string,
    entity: string,
    year: number,
    tx: Prisma.TransactionClient,
  ): Promise<string> {
    const rows = await tx.$queryRaw<Array<{ lastValue: number }>>`
      INSERT INTO sales_sequences ("entity", "year", "lastValue", "updatedAt")
      VALUES (${entity}, ${year}, 1, now())
      ON CONFLICT ("entity", "year")
      DO UPDATE SET "lastValue" = sales_sequences."lastValue" + 1,
                    "updatedAt" = now()
      RETURNING "lastValue"
    `;
    const seq = rows[0].lastValue;
    return `${prefix}-${year}-${seq.toString().padStart(4, '0')}`;
  }

  /**
   * Continuous, non-resetting counterpart to `nextNumber` for identifiers
   * that have no fiscal-year framing (e.g. Item Master codes): `RM-00001`,
   * `CM-00456`. Reuses the same `sales_sequences` table and atomic
   * upsert — no parallel sequence table — by keying on a fixed sentinel
   * year (0) that no real calendar year can ever collide with, so the
   * counter simply never resets. 5-digit zero-padded, matching the spec's
   * `{PREFIX}-{5-digit sequence}` format.
   */
  private static readonly CONTINUOUS_YEAR = 0;

  async nextContinuousNumber(
    prefix: string,
    entity: string,
    tx: Prisma.TransactionClient,
  ): Promise<string> {
    const rows = await tx.$queryRaw<Array<{ lastValue: number }>>`
      INSERT INTO sales_sequences ("entity", "year", "lastValue", "updatedAt")
      VALUES (${entity}, ${SalesNumberingService.CONTINUOUS_YEAR}, 1, now())
      ON CONFLICT ("entity", "year")
      DO UPDATE SET "lastValue" = sales_sequences."lastValue" + 1,
                    "updatedAt" = now()
      RETURNING "lastValue"
    `;
    const seq = rows[0].lastValue;
    return `${prefix}-${seq.toString().padStart(5, '0')}`;
  }

  /**
   * Read-only preview of the continuous number a create would currently
   * receive, WITHOUT consuming a sequence value. Used by create forms that
   * show the generated code before submit (e.g. Item Master). This does not
   * take the row lock `nextContinuousNumber` does, so under concurrent
   * creation the previewed number can differ by a small margin from the one
   * actually assigned at submit time — cosmetic only, never a correctness
   * or collision risk, since the real number is still allocated atomically
   * inside the create transaction.
   */
  async peekNextContinuousNumber(prefix: string, entity: string): Promise<string> {
    const row = await this.prisma.salesSequence.findUnique({
      where: { entity_year: { entity, year: SalesNumberingService.CONTINUOUS_YEAR } },
      select: { lastValue: true },
    });
    const next = (row?.lastValue ?? 0) + 1;
    return `${prefix}-${next.toString().padStart(5, '0')}`;
  }
}
