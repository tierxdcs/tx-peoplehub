import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../core/database/prisma.service';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';

@Injectable()
export class FinanceAccessService {
  constructor(private readonly prisma: PrismaService) {}

  private async employee(user: AuthenticatedUser) {
    return this.prisma.employee.findUnique({
      where: { id: user.id },
      select: {
        status: true,
        isAccountsHead: true,
        vertical: { select: { code: true } },
      },
    });
  }

  async accessFor(user: AuthenticatedUser) {
    const employee = await this.employee(user);
    const grant =
      employee?.status === 'ACTIVE'
        ? await this.prisma.financeAuditorGrant.findUnique({
            where: { employeeId: user.id },
          })
        : null;
    return {
      isFinanceUser:
        employee?.status === 'ACTIVE' &&
        (user.role === 'SUPER_ADMIN' || employee.vertical?.code === 'ACCOUNTS'),
      isAccountsHead:
        employee?.status === 'ACTIVE' && employee.isAccountsHead === true,
      isFinanceAuditor:
        !!grant?.isActive && (!grant.expiresAt || grant.expiresAt > new Date()),
    };
  }

  async assertCanViewFinance(user: AuthenticatedUser): Promise<void> {
    const access = await this.accessFor(user);
    if (
      access.isFinanceUser ||
      access.isAccountsHead ||
      access.isFinanceAuditor
    )
      return;
    throw new ForbiddenException('Finance reporting access is not assigned');
  }

  async assertCanUseFinance(user: AuthenticatedUser): Promise<void> {
    const access = await this.accessFor(user);
    if (access.isFinanceUser || access.isAccountsHead) return;
    throw new ForbiddenException(
      'Only Accounts-vertical users or the designated Finance/Accounts Head may access Finance',
    );
  }

  async assertAccountsHead(user: AuthenticatedUser): Promise<void> {
    const access = await this.accessFor(user);
    if (access.isAccountsHead) return;
    throw new ForbiddenException(
      'Only the designated Finance/Accounts Head may approve or post finance transactions',
    );
  }
}
