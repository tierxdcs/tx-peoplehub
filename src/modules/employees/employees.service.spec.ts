import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { EmployeeStatus, Role } from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { EmployeesService } from './employees.service';

/**
 * Unit test for EmployeesService with a mocked PrismaService. Demonstrates
 * the testing pattern future ERP module services should follow.
 */
describe('EmployeesService', () => {
  let service: EmployeesService;
  let prisma: any;

  const vertical = { id: 'v1', code: 'SALES' };

  const manager = {
    id: 'mgr-1',
    employeeId: 'EMP-0001',
    firstName: 'Mona',
    lastName: 'Manager',
    email: 'mona@peoplehub.local',
    passwordHash: 'hash',
    verticalId: vertical.id,
    role: Role.MANAGER,
    reportingManagerId: null,
    status: EmployeeStatus.ACTIVE,
    deactivatedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const employee = {
    ...manager,
    id: 'emp-1',
    employeeId: 'EMP-0002',
    email: 'jane@peoplehub.local',
    role: Role.EMPLOYEE,
    reportingManagerId: manager.id,
  };

  const adminUser: AuthenticatedUser = {
    id: 'admin-1',
    email: 'admin@peoplehub.local',
    role: Role.ADMIN,
    verticalId: null,
  };

  beforeEach(async () => {
    prisma = {
      employee: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      vertical: {
        findUnique: jest.fn(),
      },
      $transaction: jest.fn(),
      $queryRaw: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmployeesService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(EmployeesService);
  });

  describe('create', () => {
    const dto = {
      firstName: 'Jane',
      lastName: 'Doe',
      email: employee.email,
      password: 'S3curePass!',
      role: Role.EMPLOYEE,
      verticalId: vertical.id,
      reportingManagerId: manager.id,
    };

    it('creates an employee and returns an entity without passwordHash', async () => {
      prisma.employee.findUnique
        .mockResolvedValueOnce(manager) // manager active-check in validateVerticalAndManager
        .mockResolvedValueOnce(null); // email-uniqueness check
      prisma.vertical.findUnique.mockResolvedValue(vertical);
      prisma.$transaction.mockImplementation(async (cb: any) =>
        cb({
          $queryRaw: jest.fn().mockResolvedValue([{ nextval: BigInt(2) }]),
          employee: { create: jest.fn().mockResolvedValue(employee) },
        }),
      );

      const result = await service.create(dto);

      expect(result.id).toBe(employee.id);
      expect(result.employeeId).toBe(employee.employeeId);
      expect((result as any).passwordHash).toBeUndefined();
    });

    it('throws BadRequestException when verticalId is missing for a non-SUPER_ADMIN role', async () => {
      await expect(
        service.create({ ...dto, verticalId: undefined }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws BadRequestException when reportingManagerId is missing for a non-SUPER_ADMIN role', async () => {
      await expect(
        service.create({ ...dto, reportingManagerId: undefined }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('allows SUPER_ADMIN with no vertical or manager', async () => {
      prisma.employee.findUnique.mockResolvedValueOnce(null);
      prisma.$transaction.mockImplementation(async (cb: any) =>
        cb({
          $queryRaw: jest.fn().mockResolvedValue([{ nextval: BigInt(1) }]),
          employee: {
            create: jest
              .fn()
              .mockResolvedValue({ ...manager, role: Role.SUPER_ADMIN }),
          },
        }),
      );

      const result = await service.create({
        ...dto,
        role: Role.SUPER_ADMIN,
        verticalId: undefined,
        reportingManagerId: undefined,
      });

      expect(result.role).toBe(Role.SUPER_ADMIN);
    });

    it('throws ConflictException when email is taken', async () => {
      prisma.employee.findUnique
        .mockResolvedValueOnce(manager)
        .mockResolvedValueOnce(employee);
      prisma.vertical.findUnique.mockResolvedValue(vertical);

      await expect(service.create(dto)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  describe('update', () => {
    it('rejects reassigning an employee to report to themselves', async () => {
      prisma.employee.findUnique.mockResolvedValueOnce(employee); // findRawOrThrow
      prisma.vertical.findUnique.mockResolvedValue(vertical);
      prisma.employee.findUnique.mockResolvedValueOnce(employee); // manager active-check

      await expect(
        service.update(employee.id, { reportingManagerId: employee.id }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a manager reassignment that would create a cycle', async () => {
      // employee.id === 'emp-1'; attempting to set manager.reportingManagerId
      // to employee.id would make manager report to their own report.
      prisma.employee.findUnique
        .mockResolvedValueOnce(manager) // findRawOrThrow(manager.id)
        .mockResolvedValueOnce(employee) // manager active-check for new manager (employee)
        .mockResolvedValueOnce({ reportingManagerId: manager.id }); // assertNoCycle walk: employee -> manager
      prisma.vertical.findUnique.mockResolvedValue(vertical);

      await expect(
        service.update(manager.id, { reportingManagerId: employee.id }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('deactivate', () => {
    it('sets status to INACTIVE and stamps deactivatedAt', async () => {
      prisma.employee.findUnique.mockResolvedValue(employee);
      prisma.employee.update.mockResolvedValue({
        ...employee,
        status: EmployeeStatus.INACTIVE,
        deactivatedAt: new Date(),
      });

      const result = await service.deactivate(employee.id);

      expect(result.status).toBe(EmployeeStatus.INACTIVE);
      expect(result.deactivatedAt).not.toBeNull();
      expect(prisma.employee.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: employee.id },
          data: expect.objectContaining({ status: EmployeeStatus.INACTIVE }),
        }),
      );
    });
  });

  describe('getTeam', () => {
    const managerUser: AuthenticatedUser = {
      id: manager.id,
      email: manager.email,
      role: Role.MANAGER,
      verticalId: vertical.id,
    };

    it('forbids a MANAGER from requesting another manager’s subtree', async () => {
      await expect(
        service.getTeam('someone-elses-id', managerUser),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('includes indirect reports across a 3-level hierarchy', async () => {
      // Manager -> Report A -> Report B. A naive direct-reports-only filter
      // would only return A; the recursive CTE must return both A and B.
      const reportA = { ...employee, id: 'report-a' };
      const reportB = {
        ...employee,
        id: 'report-b',
        reportingManagerId: 'report-a',
      };

      prisma.employee.findUnique.mockResolvedValue(manager); // findRawOrThrow(managerId)
      prisma.$queryRaw.mockResolvedValue([
        { id: reportA.id },
        { id: reportB.id },
      ]);
      prisma.employee.findMany.mockResolvedValue([reportA, reportB]);

      const result = await service.getTeam(manager.id, managerUser);

      expect(result.map((r) => r.id).sort()).toEqual(
        [reportA.id, reportB.id].sort(),
      );
    });

    it('returns an empty array when the manager has no reports', async () => {
      prisma.employee.findUnique.mockResolvedValue(manager);
      prisma.$queryRaw.mockResolvedValue([]);

      const result = await service.getTeam(manager.id, managerUser);

      expect(result).toEqual([]);
      expect(prisma.employee.findMany).not.toHaveBeenCalled();
    });
  });

  describe('findOne', () => {
    it('throws NotFoundException when missing', async () => {
      prisma.employee.findUnique.mockResolvedValue(null);
      await expect(service.findOne('nope', adminUser)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('forbids a non-admin from viewing another employee', async () => {
      const employeeUser: AuthenticatedUser = {
        id: employee.id,
        email: employee.email,
        role: Role.EMPLOYEE,
        verticalId: vertical.id,
      };

      await expect(
        service.findOne(manager.id, employeeUser),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });
});
