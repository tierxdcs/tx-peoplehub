import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../../../core/database/prisma.service';
import { AuthenticatedUser } from '../../../common/decorators/current-user.decorator';
import { EmployeesService } from '../../employees/employees.service';
import { SalesAccessService } from './sales-access.service';

describe('SalesAccessService', () => {
  let service: SalesAccessService;
  let prisma: any;
  let employees: { getTeam: jest.Mock };

  const salesEmployee: AuthenticatedUser = {
    id: 'emp-1',
    email: 'e@x.com',
    role: Role.EMPLOYEE,
    verticalId: 'v-sales',
  };
  const salesManager: AuthenticatedUser = {
    id: 'mgr-1',
    email: 'm@x.com',
    role: Role.MANAGER,
    verticalId: 'v-sales',
  };
  const superAdmin: AuthenticatedUser = {
    id: 'sa-1',
    email: 'sa@x.com',
    role: Role.SUPER_ADMIN,
    verticalId: null,
  };
  const plainAdmin: AuthenticatedUser = {
    id: 'ad-1',
    email: 'ad@x.com',
    role: Role.ADMIN,
    verticalId: 'v-sales',
  };

  beforeEach(async () => {
    prisma = { vertical: { findUnique: jest.fn() } };
    employees = { getTeam: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SalesAccessService,
        { provide: PrismaService, useValue: prisma },
        { provide: EmployeesService, useValue: employees },
      ],
    }).compile();

    service = module.get(SalesAccessService);
  });

  describe('assertSalesAccess', () => {
    it('allows a SALES-vertical employee', async () => {
      prisma.vertical.findUnique.mockResolvedValue({ code: 'SALES' });
      await expect(
        service.assertSalesAccess(salesEmployee),
      ).resolves.toBeUndefined();
    });

    it('allows SUPER_ADMIN without a vertical lookup', async () => {
      await expect(
        service.assertSalesAccess(superAdmin),
      ).resolves.toBeUndefined();
      expect(prisma.vertical.findUnique).not.toHaveBeenCalled();
    });

    it('rejects a plain ADMIN (account-management-only, no operational data)', async () => {
      await expect(
        service.assertSalesAccess(plainAdmin),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rejects a non-SALES-vertical employee', async () => {
      prisma.vertical.findUnique.mockResolvedValue({ code: 'HR' });
      await expect(
        service.assertSalesAccess({ ...salesEmployee, verticalId: 'v-hr' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('visibleOwnerIds', () => {
    it('returns only self for an EMPLOYEE', async () => {
      const ids = await service.visibleOwnerIds(salesEmployee);
      expect(ids).toEqual(['emp-1']);
    });

    it('returns self + downstream team for a MANAGER', async () => {
      employees.getTeam.mockResolvedValue([{ id: 'r1' }, { id: 'r2' }]);
      const ids = await service.visibleOwnerIds(salesManager);
      expect(ids).toEqual(['mgr-1', 'r1', 'r2']);
      expect(employees.getTeam).toHaveBeenCalledWith('mgr-1', salesManager);
    });

    it('returns null (no restriction) for SUPER_ADMIN', async () => {
      const ids = await service.visibleOwnerIds(superAdmin);
      expect(ids).toBeNull();
    });
  });

  describe('assertCanAccessOwned', () => {
    it('allows an employee to access their own record', async () => {
      await expect(
        service.assertCanAccessOwned(salesEmployee, 'emp-1'),
      ).resolves.toBeUndefined();
    });

    it("rejects an employee accessing another rep's record", async () => {
      await expect(
        service.assertCanAccessOwned(salesEmployee, 'other'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('allows a manager to access a downstream report’s record', async () => {
      employees.getTeam.mockResolvedValue([{ id: 'r1' }]);
      await expect(
        service.assertCanAccessOwned(salesManager, 'r1'),
      ).resolves.toBeUndefined();
    });

    it('allows SUPER_ADMIN to access any record', async () => {
      await expect(
        service.assertCanAccessOwned(superAdmin, 'anyone'),
      ).resolves.toBeUndefined();
    });
  });
});
