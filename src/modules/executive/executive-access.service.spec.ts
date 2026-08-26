import { ForbiddenException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { ExecutiveAccessService } from './executive-access.service';

const user = (role: Role, id = 'e1') =>
  ({ id, role, email: 'x@tierxdcs.com' }) as AuthenticatedUser;

function buildService(employee: unknown) {
  const prisma = {
    employee: { findUnique: jest.fn(() => Promise.resolve(employee)) },
  } as unknown as PrismaService;
  return new ExecutiveAccessService(prisma);
}

describe('ExecutiveAccessService', () => {
  it('treats SUPER_ADMIN as an implicit holder without reading the flag', async () => {
    const prisma = {
      employee: { findUnique: jest.fn() },
    } as unknown as PrismaService;
    const service = new ExecutiveAccessService(prisma);
    await expect(service.hasAccess(user(Role.SUPER_ADMIN))).resolves.toBe(true);
    expect(prisma.employee.findUnique).not.toHaveBeenCalled();
  });

  it('grants access on the flag alone, whatever the role', async () => {
    const service = buildService({ status: 'ACTIVE', hasExecutiveDashboardAccess: true });
    await expect(service.hasAccess(user(Role.EMPLOYEE))).resolves.toBe(true);
  });

  it('denies an employee without the grant', async () => {
    const service = buildService({ status: 'ACTIVE', hasExecutiveDashboardAccess: false });
    await expect(service.hasAccess(user(Role.MANAGER))).resolves.toBe(false);
  });

  it('denies a holder who is no longer active', async () => {
    const service = buildService({ status: 'INACTIVE', hasExecutiveDashboardAccess: true });
    await expect(service.hasAccess(user(Role.MANAGER))).resolves.toBe(false);
  });

  it('denies a caller with no employee record', async () => {
    await expect(buildService(null).hasAccess(user(Role.ADMIN))).resolves.toBe(false);
  });

  it('assertAccess throws Forbidden for a non-holder and passes for a holder', async () => {
    await expect(
      buildService({ status: 'ACTIVE', hasExecutiveDashboardAccess: false }).assertAccess(
        user(Role.ADMIN),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      buildService({ status: 'ACTIVE', hasExecutiveDashboardAccess: true }).assertAccess(
        user(Role.EMPLOYEE),
      ),
    ).resolves.toBeUndefined();
  });
});
