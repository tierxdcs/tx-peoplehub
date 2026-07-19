import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { AccessStatus, EmployeeStatus, Role } from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { EncryptionService } from '../../core/crypto/encryption.service';
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
  const hrVertical = { id: 'v-hr', code: 'HR' };
  const salesVertical = { id: 'v-sales', code: 'SALES' };

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
      salaryStructure: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
      },
      employeeStatutoryInfo: {
        findUnique: jest.fn(),
      },
      employeeBankDetails: {
        findUnique: jest.fn(),
      },
      $transaction: jest.fn(),
      $queryRaw: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmployeesService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: EncryptionService,
          useValue: {
            encrypt: jest.fn((v: string) => `enc:${v}`),
            decrypt: jest.fn((v: string) => v.replace(/^enc:/, '')),
          },
        },
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

  describe('Finance/Accounts Head designation', () => {
    it('rejects designation of an inactive employee', async () => {
      prisma.employee.findUnique.mockResolvedValue({
        ...employee,
        status: EmployeeStatus.INACTIVE,
        isAccountsHead: false,
      });
      await expect(
        service.designateAccountsHead(employee.id),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('atomically clears the previous holder and designates the target', async () => {
      const target = { ...employee, isAccountsHead: false };
      const updateMany = jest.fn().mockResolvedValue({ count: 1 });
      const update = jest
        .fn()
        .mockResolvedValue({ ...target, isAccountsHead: true });
      prisma.employee.findUnique.mockResolvedValue(target);
      prisma.$transaction.mockImplementation(async (cb: any) =>
        cb({ employee: { updateMany, update } }),
      );

      const result = await service.designateAccountsHead(employee.id);

      expect(updateMany).toHaveBeenCalledWith({
        where: { isAccountsHead: true, id: { not: employee.id } },
        data: { isAccountsHead: false },
      });
      expect(result.isAccountsHead).toBe(true);
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

    it('forbids a non-admin from viewing an unrelated employee', async () => {
      const employeeUser: AuthenticatedUser = {
        id: employee.id,
        email: employee.email,
        role: Role.EMPLOYEE,
        verticalId: vertical.id,
      };
      // Caller's own reportingManagerId (null here) doesn't match the target.
      prisma.employee.findUnique.mockResolvedValueOnce({
        reportingManagerId: null,
      });

      await expect(
        service.findOne('someone-else', employeeUser),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('allows a non-admin to view their own reporting manager', async () => {
      const employeeUser: AuthenticatedUser = {
        id: employee.id,
        email: employee.email,
        role: Role.EMPLOYEE,
        verticalId: vertical.id,
      };
      // First call resolves the caller's reportingManagerId; second is the
      // findRawOrThrow lookup of the target (the manager) itself.
      prisma.employee.findUnique
        .mockResolvedValueOnce({ reportingManagerId: manager.id })
        .mockResolvedValueOnce(manager);

      const result = await service.findOne(manager.id, employeeUser);
      expect(result.id).toBe(manager.id);
    });
  });

  describe('onboard', () => {
    const hrStaffUser: AuthenticatedUser = {
      id: 'hr-1',
      email: 'hr@peoplehub.local',
      role: Role.EMPLOYEE,
      verticalId: hrVertical.id,
    };
    const salesEmployeeUser: AuthenticatedUser = {
      id: 'sales-1',
      email: 'sales@peoplehub.local',
      role: Role.EMPLOYEE,
      verticalId: salesVertical.id,
    };

    const onboardDto = {
      firstName: 'John',
      lastName: 'Doe',
      dateOfBirth: '1995-05-20',
      gender: 'Male',
      personalEmail: 'john@gmail.com',
      mobile: '+91 9876543210',
      designation: 'Design Engineer',
      employmentType: 'FULL_TIME_PERMANENT' as const,
      dateOfJoining: '2026-07-05',
      workLocation: 'Bangalore HQ',
      verticalId: salesVertical.id,
      emergencyContactName: 'Jane Roe',
      emergencyContactRelation: 'Spouse',
      emergencyContactPhone: '+91 9876500000',
      compensation: {
        basicSalary: 50000,
        hra: 10000,
        effectiveDate: '2026-07-05',
      },
      statutoryInfo: {
        panNumber: 'ABCDE1234F',
        aadhaarLast4: '1234',
        pfAccountNumber: 'PF1234567890',
      },
      bankDetails: {
        bankAccountNumber: '000123456789',
        ifscCode: 'HDFC0001234',
      },
    };

    function mockHrTransaction(createdEmployee: any) {
      prisma.$transaction.mockImplementation(async (cb: any) =>
        cb({
          $queryRaw: jest.fn().mockResolvedValue([{ nextval: BigInt(3) }]),
          employee: {
            create: jest.fn().mockResolvedValue(createdEmployee),
            findUnique: jest.fn().mockResolvedValue(null), // official-email collision check: no collision
          },
          salaryStructure: { create: jest.fn().mockResolvedValue({}) },
          employeeStatutoryInfo: { create: jest.fn().mockResolvedValue({}) },
          employeeBankDetails: { create: jest.fn().mockResolvedValue({}) },
          vaultFolder: { create: jest.fn().mockResolvedValue({}) },
        }),
      );
    }

    it('allows HR-vertical staff to onboard into a different vertical, with role/password null and PENDING_ACCESS', async () => {
      prisma.vertical.findUnique.mockResolvedValue(salesVertical); // verticalId exists check
      prisma.vertical.findUnique.mockResolvedValueOnce(hrVertical); // isHrStaff lookup happens first
      prisma.vertical.findUnique.mockResolvedValueOnce(salesVertical);
      const created = {
        ...employee,
        id: 'new-emp',
        role: null,
        passwordHash: null,
        accessStatus: AccessStatus.PENDING_ACCESS,
        officialEmail: 'john.doe@vertixdcs.com',
        email: 'john.doe@vertixdcs.com',
      };
      mockHrTransaction(created);

      const result = await service.onboard(onboardDto, hrStaffUser);

      expect(result.id).toBe('new-emp');
      expect(prisma.$transaction).toHaveBeenCalled();
    });

    it('rejects a non-HR-vertical MANAGER/EMPLOYEE from onboarding', async () => {
      prisma.vertical.findUnique.mockResolvedValue(salesVertical); // isHrStaff lookup: not HR

      await expect(
        service.onboard(onboardDto, salesEmployeeUser),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('encrypts panNumber, pfAccountNumber, and bankAccountNumber before writing', async () => {
      prisma.vertical.findUnique.mockResolvedValueOnce(hrVertical);
      prisma.vertical.findUnique.mockResolvedValueOnce(salesVertical);
      const created = { ...employee, id: 'new-emp-2' };

      let capturedStatutory: any;
      let capturedBank: any;
      prisma.$transaction.mockImplementation(async (cb: any) =>
        cb({
          $queryRaw: jest.fn().mockResolvedValue([{ nextval: BigInt(4) }]),
          employee: {
            create: jest.fn().mockResolvedValue(created),
            findUnique: jest.fn().mockResolvedValue(null),
          },
          salaryStructure: { create: jest.fn().mockResolvedValue({}) },
          employeeStatutoryInfo: {
            create: jest.fn((args: any) => {
              capturedStatutory = args.data;
              return Promise.resolve({});
            }),
          },
          employeeBankDetails: {
            create: jest.fn((args: any) => {
              capturedBank = args.data;
              return Promise.resolve({});
            }),
          },
          vaultFolder: { create: jest.fn().mockResolvedValue({}) },
        }),
      );

      await service.onboard(onboardDto, hrStaffUser);

      expect(capturedStatutory.panNumber).toBe('enc:ABCDE1234F');
      expect(capturedStatutory.pfAccountNumber).toBe('enc:PF1234567890');
      expect(capturedBank.bankAccountNumber).toBe('enc:000123456789');
    });
  });

  describe('grantAccess', () => {
    const pendingEmployee = {
      ...employee,
      id: 'pending-1',
      role: null,
      passwordHash: null,
      accessStatus: AccessStatus.PENDING_ACCESS,
      officialEmail: 'john.doe@vertixdcs.com',
    };

    it('assigns role, sets password, activates login, and promotes officialEmail to email', async () => {
      prisma.employee.findUnique.mockResolvedValueOnce(pendingEmployee); // findRawOrThrow
      prisma.vertical.findUnique.mockResolvedValue(vertical);
      prisma.employee.findUnique.mockResolvedValueOnce(manager); // manager active-check
      prisma.employee.update.mockResolvedValue({
        ...pendingEmployee,
        role: Role.EMPLOYEE,
        accessStatus: AccessStatus.ACTIVE,
        email: pendingEmployee.officialEmail,
      });

      const result = await service.grantAccess(pendingEmployee.id, {
        role: Role.EMPLOYEE,
        verticalId: vertical.id,
        reportingManagerId: manager.id,
        password: 'S3curePass!',
      });

      expect(result.role).toBe(Role.EMPLOYEE);
      expect(result.accessStatus).toBe(AccessStatus.ACTIVE);
      expect(result.email).toBe(pendingEmployee.officialEmail);
    });

    it('rejects granting access to an employee who already has access', async () => {
      prisma.employee.findUnique.mockResolvedValueOnce({
        ...pendingEmployee,
        accessStatus: AccessStatus.ACTIVE,
      });

      await expect(
        service.grantAccess(pendingEmployee.id, {
          role: Role.EMPLOYEE,
          verticalId: vertical.id,
          reportingManagerId: manager.id,
          password: 'S3curePass!',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('getRoster', () => {
    const hrStaffUser: AuthenticatedUser = {
      id: 'hr-1',
      email: 'hr@peoplehub.local',
      role: Role.EMPLOYEE,
      verticalId: hrVertical.id,
    };

    it('returns the HR-shaped entity (no compensation fields) for HR-vertical staff', async () => {
      prisma.vertical.findUnique.mockResolvedValue(hrVertical);
      prisma.$transaction.mockResolvedValue([[employee], 1]);

      const result = await service.getRoster(
        { page: 1, limit: 20, skip: 0 } as any,
        hrStaffUser,
      );

      expect(result.items[0]).not.toHaveProperty('hasCompensationOnFile');
      expect(result.items[0]).not.toHaveProperty('basicSalary');
    });

    it('returns the admin-shaped entity with completeness flags (no raw values) for Admin', async () => {
      prisma.$transaction.mockResolvedValue([
        [
          {
            ...employee,
            salaryStructures: [{ id: 'c1' }],
            statutoryInfo: null,
            bankDetails: { id: 'b1' },
          },
        ],
        1,
      ]);

      const result = await service.getRoster(
        { page: 1, limit: 20, skip: 0 } as any,
        adminUser,
      );

      expect(result.items[0]).toMatchObject({
        hasCompensationOnFile: true,
        hasStatutoryInfoOnFile: false,
        hasBankDetailsOnFile: true,
      });
      expect(result.items[0]).not.toHaveProperty('basicSalary');
    });

    it('rejects a non-HR-vertical, non-admin caller', async () => {
      const salesEmployeeUser: AuthenticatedUser = {
        id: 'sales-1',
        email: 'sales@peoplehub.local',
        role: Role.EMPLOYEE,
        verticalId: salesVertical.id,
      };
      prisma.vertical.findUnique.mockResolvedValue(salesVertical);

      await expect(
        service.getRoster(
          { page: 1, limit: 20, skip: 0 } as any,
          salesEmployeeUser,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('getCompensation / getStatutory / getBankDetails', () => {
    it('getStatutory decrypts panNumber/pfAccountNumber before returning', async () => {
      prisma.employeeStatutoryInfo.findUnique.mockResolvedValue({
        employeeId: employee.id,
        panNumber: 'enc:ABCDE1234F',
        aadhaarLast4: '1234',
        pfAccountNumber: 'enc:PF1234567890',
        esicNumber: null,
      });

      const result = await service.getStatutory(employee.id);

      expect(result.panNumber).toBe('ABCDE1234F');
      expect(result.pfAccountNumber).toBe('PF1234567890');
    });

    it('getBankDetails decrypts bankAccountNumber before returning', async () => {
      prisma.employeeBankDetails.findUnique.mockResolvedValue({
        employeeId: employee.id,
        bankAccountNumber: 'enc:000123456789',
        ifscCode: 'HDFC0001234',
      });

      const result = await service.getBankDetails(employee.id);

      expect(result.bankAccountNumber).toBe('000123456789');
    });

    it('getCompensation throws NotFoundException when no record exists', async () => {
      prisma.salaryStructure.findFirst.mockResolvedValue(null);

      await expect(service.getCompensation(employee.id)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
