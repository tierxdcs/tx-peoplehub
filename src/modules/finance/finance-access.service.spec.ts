import { ForbiddenException } from '@nestjs/common';
import { EmployeeStatus, Role } from '@prisma/client';
import { FinanceAccessService } from './finance-access.service';

describe('FinanceAccessService', () => {
  const user = { id: 'employee-1', email: 'user@example.com', role: Role.EMPLOYEE, verticalId: 'vertical-1' };
  const prisma: any = { employee: { findUnique: jest.fn() }, financeAuditorGrant: { findUnique: jest.fn() } };
  const service = new FinanceAccessService(prisma);

  beforeEach(() => jest.clearAllMocks());

  it('gives Accounts-vertical staff operational finance access without approval', async () => {
    prisma.employee.findUnique.mockResolvedValue({ status: EmployeeStatus.ACTIVE, isAccountsHead: false, vertical: { code: 'ACCOUNTS' } });
    await expect(service.accessFor(user)).resolves.toEqual({ isFinanceUser: true, isAccountsHead: false, isFinanceAuditor: false });
    await expect(service.assertCanUseFinance(user)).resolves.toBeUndefined();
    await expect(service.assertAccountsHead(user)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('gives Super Admin operational finance access without approval authority', async () => {
    const superAdmin = { ...user, role: Role.SUPER_ADMIN };
    prisma.employee.findUnique.mockResolvedValue({ status: EmployeeStatus.ACTIVE, isAccountsHead: false, vertical: null });
    await expect(service.accessFor(superAdmin)).resolves.toEqual({ isFinanceUser: true, isAccountsHead: false, isFinanceAuditor: false });
    await expect(service.assertCanUseFinance(superAdmin)).resolves.toBeUndefined();
    await expect(service.assertAccountsHead(superAdmin)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows an active auditor grant to view reports without mutation access', async () => {
    prisma.employee.findUnique.mockResolvedValue({ status: EmployeeStatus.ACTIVE, isAccountsHead: false, vertical: { code: 'SALES' } });
    prisma.financeAuditorGrant.findUnique.mockResolvedValue({ isActive: true, expiresAt: null });
    await expect(service.assertCanViewFinance(user)).resolves.toBeUndefined();
    await expect(service.assertCanUseFinance(user)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows the designated Accounts Head to approve even outside Accounts vertical', async () => {
    prisma.employee.findUnique.mockResolvedValue({ status: EmployeeStatus.ACTIVE, isAccountsHead: true, vertical: { code: 'SALES' } });
    await expect(service.assertCanUseFinance(user)).resolves.toBeUndefined();
    await expect(service.assertAccountsHead(user)).resolves.toBeUndefined();
  });

  it('denies inactive employees even when their stale flag remains set', async () => {
    prisma.employee.findUnique.mockResolvedValue({ status: EmployeeStatus.INACTIVE, isAccountsHead: true, vertical: { code: 'ACCOUNTS' } });
    await expect(service.assertCanUseFinance(user)).rejects.toBeInstanceOf(ForbiddenException);
  });
});
