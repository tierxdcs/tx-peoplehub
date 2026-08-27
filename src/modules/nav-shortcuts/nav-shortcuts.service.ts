import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../core/database/prisma.service';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { NavShortcutEntity } from './entities/nav-shortcut.entity';

/**
 * How many pins one employee may hold. Small on purpose: the pinned strip sits
 * above the whole sidebar, so an unbounded list would recreate the very problem
 * the accordion nav was built to solve.
 */
export const MAX_NAV_SHORTCUTS = 8;

/** A nav route: absolute, single-segment-separated, no scheme, no query. */
const HREF_PATTERN = /^\/[A-Za-z0-9\-._~/[\]]*$/;
const MAX_HREF_LENGTH = 200;
const MAX_LABEL_LENGTH = 60;

/**
 * Personal sidebar shortcuts, scoped to the calling employee in every method —
 * there is no cross-employee read or write path, so no additional authorization
 * beyond a valid token is needed or offered.
 *
 * Routes are declared in the frontend nav model, so there is no server-side page
 * registry to validate a pin against. The service therefore validates the SHAPE
 * of the route only, and treats a pin as a bookmark: it grants nothing. Opening
 * the page still runs that page's own guards, so a pin left behind by a revoked
 * designation is a dead link, never an access hole.
 */
@Injectable()
export class NavShortcutsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(user: AuthenticatedUser): Promise<NavShortcutEntity[]> {
    const rows = await this.prisma.navShortcut.findMany({
      where: { employeeId: user.id },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, href: true, label: true, sortOrder: true },
    });
    return rows;
  }

  /**
   * Pin a page. Idempotent: re-pinning an already-pinned route refreshes its
   * label and leaves its position alone, so a double click (or a second tab)
   * can't create a duplicate or silently reorder the strip.
   */
  async pin(
    user: AuthenticatedUser,
    input: { href: string; label: string },
  ): Promise<NavShortcutEntity[]> {
    const href = this.normaliseHref(input.href);
    const label = input.label.trim();
    if (!label) throw new BadRequestException('A shortcut label is required');
    if (label.length > MAX_LABEL_LENGTH) {
      throw new BadRequestException(
        `Shortcut label must be ${MAX_LABEL_LENGTH} characters or fewer`,
      );
    }

    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.navShortcut.findUnique({
        where: { employeeId_href: { employeeId: user.id, href } },
        select: { id: true },
      });
      if (existing) {
        await tx.navShortcut.update({ where: { id: existing.id }, data: { label } });
        return;
      }
      const count = await tx.navShortcut.count({
        where: { employeeId: user.id },
      });
      if (count >= MAX_NAV_SHORTCUTS) {
        throw new BadRequestException(
          `You can pin up to ${MAX_NAV_SHORTCUTS} shortcuts. Unpin one first.`,
        );
      }
      await tx.navShortcut.create({
        data: { employeeId: user.id, href, label, sortOrder: count },
      });
    });

    return this.list(user);
  }

  /**
   * Unpin a page and close the gap, so `sortOrder` stays dense (0..n-1) and the
   * remaining shortcuts keep their relative order.
   */
  async unpin(
    user: AuthenticatedUser,
    hrefInput: string,
  ): Promise<NavShortcutEntity[]> {
    const href = this.normaliseHref(hrefInput);
    await this.prisma.$transaction(async (tx) => {
      const deleted = await tx.navShortcut.deleteMany({
        where: { employeeId: user.id, href },
      });
      // Unpinning something that isn't pinned is a no-op, not an error: the
      // client's intent ("this must not be pinned") is already satisfied.
      if (deleted.count === 0) return;
      const remaining = await tx.navShortcut.findMany({
        where: { employeeId: user.id },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        select: { id: true, sortOrder: true },
      });
      await Promise.all(
        remaining
          .map((row, index) => ({ row, index }))
          .filter(({ row, index }) => row.sortOrder !== index)
          .map(({ row, index }) =>
            tx.navShortcut.update({
              where: { id: row.id },
              data: { sortOrder: index },
            }),
          ),
      );
    });
    return this.list(user);
  }

  /**
   * Accepts only what the nav model can produce. A trailing slash is trimmed so
   * '/sales/leads' and '/sales/leads/' are the same pin rather than two.
   */
  private normaliseHref(value: string): string {
    const href =
      value.length > 1 && value.endsWith('/') ? value.slice(0, -1) : value;
    if (
      !href ||
      href.length > MAX_HREF_LENGTH ||
      !HREF_PATTERN.test(href) ||
      href.includes('//')
    ) {
      throw new BadRequestException('Invalid shortcut route');
    }
    return href;
  }
}
