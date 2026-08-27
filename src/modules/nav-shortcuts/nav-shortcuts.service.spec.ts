import { BadRequestException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { MAX_NAV_SHORTCUTS, NavShortcutsService } from './nav-shortcuts.service';

const user = { id: 'emp-1', role: Role.EMPLOYEE, email: 'a@b.c' } as AuthenticatedUser;

interface Row {
  id: string;
  employeeId: string;
  href: string;
  label: string;
  sortOrder: number;
  createdAt: Date;
}

/**
 * In-memory stand-in for the nav_shortcuts table, including the
 * (employeeId, href) unique key — enough to exercise ordering, the cap and the
 * re-sequencing without a database.
 */
function buildService(seed: Array<Partial<Row>> = []) {
  let sequence = 0;
  const rows: Row[] = seed.map((row, index) => ({
    id: row.id ?? `s${index}`,
    employeeId: row.employeeId ?? user.id,
    href: row.href ?? `/p${index}`,
    label: row.label ?? `P${index}`,
    sortOrder: row.sortOrder ?? index,
    createdAt: new Date(2026, 0, 1 + index),
  }));

  const navShortcut = {
    findMany: jest.fn(({ where, orderBy }: any) => {
      const filtered = rows.filter((row) => row.employeeId === where.employeeId);
      void orderBy;
      filtered.sort(
        (a, b) =>
          a.sortOrder - b.sortOrder ||
          a.createdAt.getTime() - b.createdAt.getTime(),
      );
      return Promise.resolve(filtered.map((row) => ({ ...row })));
    }),
    findUnique: jest.fn(({ where }: any) => {
      const key = where.employeeId_href;
      const found = rows.find(
        (row) => row.employeeId === key.employeeId && row.href === key.href,
      );
      return Promise.resolve(found ? { ...found } : null);
    }),
    count: jest.fn(({ where }: any) =>
      Promise.resolve(rows.filter((row) => row.employeeId === where.employeeId).length),
    ),
    create: jest.fn(({ data }: any) => {
      const row: Row = {
        id: `new-${(sequence += 1)}`,
        employeeId: data.employeeId,
        href: data.href,
        label: data.label,
        sortOrder: data.sortOrder,
        createdAt: new Date(2026, 5, sequence),
      };
      rows.push(row);
      return Promise.resolve({ ...row });
    }),
    update: jest.fn(({ where, data }: any) => {
      const row = rows.find((candidate) => candidate.id === where.id);
      if (row) Object.assign(row, data);
      return Promise.resolve(row ? { ...row } : null);
    }),
    deleteMany: jest.fn(({ where }: any) => {
      const before = rows.length;
      for (let index = rows.length - 1; index >= 0; index -= 1) {
        if (rows[index].employeeId === where.employeeId && rows[index].href === where.href) {
          rows.splice(index, 1);
        }
      }
      return Promise.resolve({ count: before - rows.length });
    }),
  };

  const prisma = {
    navShortcut,
    $transaction: jest.fn((fn: any) => fn({ navShortcut })),
  } as unknown as PrismaService;

  return { service: new NavShortcutsService(prisma), rows, prisma };
}

describe('NavShortcutsService', () => {
  it('lists only the caller’s pins, in display order', async () => {
    const { service } = buildService([
      { href: '/b', label: 'B', sortOrder: 1 },
      { href: '/a', label: 'A', sortOrder: 0 },
      { href: '/other', label: 'Other', sortOrder: 0, employeeId: 'emp-2' },
    ]);
    const list = await service.list(user);
    expect(list.map((row) => row.href)).toEqual(['/a', '/b']);
  });

  it('appends a new pin at the end of the strip', async () => {
    const { service } = buildService([{ href: '/a', label: 'A', sortOrder: 0 }]);
    const list = await service.pin(user, { href: '/sales/leads', label: 'Leads' });
    expect(list).toHaveLength(2);
    expect(list[1]).toMatchObject({ href: '/sales/leads', label: 'Leads', sortOrder: 1 });
  });

  it('is idempotent: re-pinning refreshes the label without duplicating or reordering', async () => {
    const { service } = buildService([
      { href: '/sales/leads', label: 'Old label', sortOrder: 0 },
      { href: '/b', label: 'B', sortOrder: 1 },
    ]);
    const list = await service.pin(user, { href: '/sales/leads', label: 'Leads' });
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ href: '/sales/leads', label: 'Leads', sortOrder: 0 });
  });

  it(`rejects a pin beyond the cap of ${MAX_NAV_SHORTCUTS}`, async () => {
    const { service } = buildService(
      Array.from({ length: MAX_NAV_SHORTCUTS }, (_, index) => ({
        href: `/p${index}`,
        label: `P${index}`,
        sortOrder: index,
      })),
    );
    await expect(
      service.pin(user, { href: '/one/too/many', label: 'Nope' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('still allows re-pinning an existing route when the list is full', async () => {
    const { service } = buildService(
      Array.from({ length: MAX_NAV_SHORTCUTS }, (_, index) => ({
        href: `/p${index}`,
        label: `P${index}`,
        sortOrder: index,
      })),
    );
    const list = await service.pin(user, { href: '/p3', label: 'Renamed' });
    expect(list).toHaveLength(MAX_NAV_SHORTCUTS);
    expect(list[3].label).toBe('Renamed');
  });

  it('closes the gap in sortOrder when a middle pin is removed', async () => {
    const { service } = buildService([
      { href: '/a', label: 'A', sortOrder: 0 },
      { href: '/b', label: 'B', sortOrder: 1 },
      { href: '/c', label: 'C', sortOrder: 2 },
    ]);
    const list = await service.unpin(user, '/b');
    expect(list.map((row) => [row.href, row.sortOrder])).toEqual([
      ['/a', 0],
      ['/c', 1],
    ]);
  });

  it('treats unpinning a route that is not pinned as a no-op', async () => {
    const { service } = buildService([{ href: '/a', label: 'A', sortOrder: 0 }]);
    await expect(service.unpin(user, '/never-pinned')).resolves.toEqual([
      expect.objectContaining({ href: '/a' }),
    ]);
  });

  it('treats a trailing slash as the same route', async () => {
    const { service } = buildService([{ href: '/a', label: 'A', sortOrder: 0 }]);
    await expect(service.unpin(user, '/a/')).resolves.toEqual([]);
  });

  it.each([
    ['sales/leads', 'a relative route'],
    ['https://evil.example/x', 'an absolute URL'],
    ['//evil.example', 'a protocol-relative URL'],
    ['/sales/leads?x=1', 'a query string'],
    ['/sales leads', 'whitespace'],
    ['', 'an empty route'],
  ])('rejects %s (%s)', async (href) => {
    const { service } = buildService();
    await expect(service.pin(user, { href, label: 'X' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects a blank or over-long label', async () => {
    const { service } = buildService();
    await expect(
      service.pin(user, { href: '/a', label: '   ' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.pin(user, { href: '/a', label: 'x'.repeat(61) }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('never lets one employee touch another’s pins', async () => {
    const { service, rows } = buildService([
      { href: '/a', label: 'A', sortOrder: 0, employeeId: 'emp-2' },
    ]);
    await expect(service.unpin(user, '/a')).resolves.toEqual([]);
    expect(rows).toHaveLength(1);
  });
});
