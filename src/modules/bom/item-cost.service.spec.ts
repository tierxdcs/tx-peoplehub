import { ForbiddenException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { ItemCostService } from './item-cost.service';

/**
 * Cost-visibility access rules (§4): CEO/SuperAdmin + Finance + SCM may SEE an
 * item's cost, but only CEO/SuperAdmin + Finance may EDIT it. SCM reads the
 * benchmark for Resource Planning; it must not be able to move its own yardstick.
 */
function makeService(opts: {
  isFinanceUser?: boolean;
  verticalCode?: string | null;
}) {
  const prisma = {
    vertical: {
      findUnique: jest.fn().mockResolvedValue(
        opts.verticalCode ? { code: opts.verticalCode } : null,
      ),
    },
  } as any;
  const financeAccess = {
    accessFor: jest
      .fn()
      .mockResolvedValue({ isFinanceUser: opts.isFinanceUser ?? false }),
  } as any;
  return new ItemCostService(prisma, financeAccess);
}

const asUser = (
  role: Role,
  verticalId: string | null = null,
): AuthenticatedUser =>
  ({ id: 'u1', role, verticalId } as AuthenticatedUser);

describe('ItemCostService — cost visibility vs. management', () => {
  it('SUPER_ADMIN can both view and manage cost', async () => {
    const svc = makeService({});
    const user = asUser(Role.SUPER_ADMIN);
    expect(await svc.canViewCost(user)).toBe(true);
    expect(await svc.canManageCost(user)).toBe(true);
    await expect(svc.assertCanManageCost(user)).resolves.toBeUndefined();
  });

  it('Finance (ACCOUNTS vertical) can both view and manage cost', async () => {
    const svc = makeService({ isFinanceUser: true, verticalCode: 'ACCOUNTS' });
    const user = asUser(Role.EMPLOYEE, 'accounts-id');
    expect(await svc.canViewCost(user)).toBe(true);
    expect(await svc.canManageCost(user)).toBe(true);
  });

  it('SCM staff can VIEW cost but NOT manage it', async () => {
    const svc = makeService({ isFinanceUser: false, verticalCode: 'SCM' });
    const user = asUser(Role.EMPLOYEE, 'scm-id');
    expect(await svc.canViewCost(user)).toBe(true);
    expect(await svc.canManageCost(user)).toBe(false);
    await expect(svc.assertCanManageCost(user)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('Store/Production staff can neither view nor manage cost', async () => {
    const svc = makeService({ isFinanceUser: false, verticalCode: 'PRODUCTION' });
    const user = asUser(Role.EMPLOYEE, 'prod-id');
    expect(await svc.canViewCost(user)).toBe(false);
    expect(await svc.canManageCost(user)).toBe(false);
    await expect(svc.assertCanManageCost(user)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('a user with no vertical cannot view cost', async () => {
    const svc = makeService({ isFinanceUser: false, verticalCode: null });
    const user = asUser(Role.EMPLOYEE, null);
    expect(await svc.canViewCost(user)).toBe(false);
  });
});
