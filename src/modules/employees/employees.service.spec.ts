import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import {
  AccessStatus,
  CandidateHiringStage,
  EmployeeStatus,
  Role,
} from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { EncryptionService } from '../../core/crypto/encryption.service';
import { VaultStorageService } from '../vault/vault-storage.service';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { EmployeesService } from './employees.service';
import { ProvisioningService } from '../provisioning/provisioning.service';
import { OnboardingCompensationService } from '../payroll/onboarding-compensation.service';

/**
 * Unit test for EmployeesService with a mocked PrismaService. Demonstrates
 * the testing pattern future ERP module services should follow.
 */
describe('EmployeesService', () => {
  let service: EmployeesService;
  let prisma: any;
  let storage: any;

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

  const superAdminUser: AuthenticatedUser = {
    id: 'sa-1',
    email: 'ceo@peoplehub.local',
    role: Role.SUPER_ADMIN,
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
        findFirst: jest.fn(),
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
        {
          provide: OnboardingCompensationService,
          useValue: {
            calculate: jest.fn().mockResolvedValue({
              basicMonthly: '18000',
              hraMonthly: '9600',
              conveyanceMonthly: '500',
              otherAllowanceMonthly: '1900',
              incentiveAnnual: '30000',
              annualCtc: '422340',
            }),
          },
        },
        {
          provide: ProvisioningService,
          useValue: {
            createForEmployee: jest.fn().mockResolvedValue(undefined),
          },
        },
        { provide: PrismaService, useValue: prisma },
        {
          provide: EncryptionService,
          useValue: {
            encrypt: jest.fn((v: string) => `enc:${v}`),
            decrypt: jest.fn((v: string) => v.replace(/^enc:/, '')),
          },
        },
        {
          provide: VaultStorageService,
          useValue: {
            createUploadUrl: jest.fn().mockResolvedValue({
              url: 'https://r2/put',
              expiresInSeconds: 900,
            }),
            createDownloadUrl: jest.fn().mockResolvedValue({
              url: 'https://r2/get',
              expiresInSeconds: 900,
            }),
            headObject: jest.fn().mockResolvedValue({
              sizeBytes: 1024,
              contentType: 'image/jpeg',
            }),
            deleteObject: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    service = module.get(EmployeesService);
    storage = module.get(VaultStorageService);
  });

  describe('photo upload', () => {
    it('createPhotoUploadUrl mints an employees/photos key for an image', async () => {
      const res = await service.createPhotoUploadUrl({
        name: 'jane.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 2048,
      });
      expect(res.storageKey.startsWith('employees/photos/')).toBe(true);
      expect(res.uploadUrl).toBe('https://r2/put');
      expect(storage.createUploadUrl).toHaveBeenCalledWith(
        res.storageKey,
        'image/jpeg',
      );
    });

    it('createPhotoUploadUrl rejects a non-image mime type', async () => {
      await expect(
        service.createPhotoUploadUrl({
          name: 'resume.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 2048,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(storage.createUploadUrl).not.toHaveBeenCalled();
    });

    it('setPhoto verifies the object, persists the key, and deletes the previous photo', async () => {
      prisma.employee.findUnique.mockResolvedValue({
        ...employee,
        photoStorageKey: 'employees/photos/old',
      });
      prisma.employee.update.mockResolvedValue({
        ...employee,
        photoStorageKey: 'employees/photos/new',
      });

      const result = await service.setPhoto(employee.id, {
        storageKey: 'employees/photos/new',
      });

      expect(storage.headObject).toHaveBeenCalledWith('employees/photos/new');
      expect(prisma.employee.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: employee.id },
          data: { photoStorageKey: 'employees/photos/new' },
        }),
      );
      expect(storage.deleteObject).toHaveBeenCalledWith('employees/photos/old');
      expect(result.photoStorageKey).toBe('employees/photos/new');
    });

    it('setPhoto rejects a storage key outside the employees/photos prefix', async () => {
      prisma.employee.findUnique.mockResolvedValue({
        ...employee,
        photoStorageKey: null,
      });
      await expect(
        service.setPhoto(employee.id, { storageKey: 'plm/tracker/x' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.employee.update).not.toHaveBeenCalled();
    });

    it('setPhoto rejects when the object was never uploaded', async () => {
      prisma.employee.findUnique.mockResolvedValue({
        ...employee,
        photoStorageKey: null,
      });
      storage.headObject.mockResolvedValueOnce(null);
      await expect(
        service.setPhoto(employee.id, { storageKey: 'employees/photos/ghost' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.employee.update).not.toHaveBeenCalled();
    });

    it('getPhotoUrl returns a signed URL for an admin viewing a photo', async () => {
      prisma.employee.findUnique.mockResolvedValue({
        ...employee,
        photoStorageKey: 'employees/photos/x',
      });
      const res = await service.getPhotoUrl(employee.id, adminUser);
      expect(res.url).toBe('https://r2/get');
      expect(storage.createDownloadUrl).toHaveBeenCalledWith(
        'employees/photos/x',
      );
    });

    it('getPhotoUrl returns null when the employee has no photo', async () => {
      prisma.employee.findUnique.mockResolvedValue({
        ...employee,
        photoStorageKey: null,
      });
      const res = await service.getPhotoUrl(employee.id, adminUser);
      expect(res.url).toBeNull();
      expect(storage.createDownloadUrl).not.toHaveBeenCalled();
    });
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
          $queryRaw: jest.fn().mockResolvedValue([{ lastValue: 2 }]),
          employee: { create: jest.fn().mockResolvedValue(employee) },
        }),
      );

      const result = await service.create(dto, adminUser);

      expect(result.id).toBe(employee.id);
      expect(result.employeeId).toBe(employee.employeeId);
      expect((result as any).passwordHash).toBeUndefined();
    });

    it('throws BadRequestException when verticalId is missing for a non-SUPER_ADMIN role', async () => {
      await expect(
        service.create({ ...dto, verticalId: undefined }, adminUser),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws BadRequestException when reportingManagerId is missing for a non-SUPER_ADMIN role', async () => {
      await expect(
        service.create({ ...dto, reportingManagerId: undefined }, adminUser),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('forbids a non-super-admin from creating an ADMIN', async () => {
      await expect(
        service.create({ ...dto, role: Role.ADMIN }, adminUser),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('forbids a non-super-admin from creating a SUPER_ADMIN', async () => {
      await expect(
        service.create({ ...dto, role: Role.SUPER_ADMIN }, adminUser),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('allows SUPER_ADMIN with no vertical or manager', async () => {
      prisma.employee.findUnique.mockResolvedValueOnce(null);
      prisma.$transaction.mockImplementation(async (cb: any) =>
        cb({
          $queryRaw: jest.fn().mockResolvedValue([{ lastValue: 1 }]),
          employee: {
            create: jest
              .fn()
              .mockResolvedValue({ ...manager, role: Role.SUPER_ADMIN }),
          },
        }),
      );

      const result = await service.create(
        {
          ...dto,
          role: Role.SUPER_ADMIN,
          verticalId: undefined,
          reportingManagerId: undefined,
        },
        superAdminUser,
      );

      expect(result.role).toBe(Role.SUPER_ADMIN);
    });

    it('throws ConflictException when email is taken', async () => {
      prisma.employee.findUnique
        .mockResolvedValueOnce(manager)
        .mockResolvedValueOnce(employee);
      prisma.vertical.findUnique.mockResolvedValue(vertical);

      await expect(service.create(dto, adminUser)).rejects.toBeInstanceOf(
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

  describe('SCM Head designation', () => {
    const scmVertical = { id: 'v-scm', code: 'SCM' };

    it('rejects an employee outside the SCM vertical', async () => {
      prisma.employee.findUnique.mockResolvedValue({
        ...employee,
        verticalId: salesVertical.id,
        isScmHead: false,
      });
      prisma.vertical.findFirst.mockResolvedValue(scmVertical);

      await expect(service.designateScmHead(employee.id)).rejects.toThrow(
        'Only an employee in the SCM vertical can be designated as SCM Head',
      );
    });

    it('atomically replaces the holder and assigns the SCM vertical owner', async () => {
      const target = {
        ...employee,
        verticalId: scmVertical.id,
        isScmHead: false,
      };
      const updateMany = jest.fn().mockResolvedValue({ count: 1 });
      const update = jest
        .fn()
        .mockResolvedValue({ ...target, isScmHead: true });
      const verticalUpdate = jest.fn().mockResolvedValue({
        ...scmVertical,
        ownerId: employee.id,
      });
      prisma.employee.findUnique.mockResolvedValue(target);
      prisma.vertical.findFirst.mockResolvedValue(scmVertical);
      prisma.$transaction.mockImplementation(async (cb: any) =>
        cb({
          employee: { updateMany, update },
          vertical: { update: verticalUpdate },
        }),
      );

      const result = await service.designateScmHead(employee.id);

      expect(updateMany).toHaveBeenCalledWith({
        where: { isScmHead: true, id: { not: employee.id } },
        data: { isScmHead: false },
      });
      expect(verticalUpdate).toHaveBeenCalledWith({
        where: { id: scmVertical.id },
        data: { ownerId: employee.id },
      });
      expect(result.isScmHead).toBe(true);
    });

    it('revokes the capability and clears SCM ownership held by that employee', async () => {
      const target = { ...employee, isScmHead: true };
      const update = jest
        .fn()
        .mockResolvedValue({ ...target, isScmHead: false });
      const verticalUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
      prisma.employee.findUnique.mockResolvedValue(target);
      prisma.$transaction.mockImplementation(async (cb: any) =>
        cb({
          employee: { update },
          vertical: { updateMany: verticalUpdateMany },
        }),
      );

      const result = await service.revokeScmHead(employee.id);

      expect(verticalUpdateMany).toHaveBeenCalledWith({
        where: {
          code: { equals: 'SCM', mode: 'insensitive' },
          ownerId: employee.id,
        },
        data: { ownerId: null },
      });
      expect(result.isScmHead).toBe(false);
    });
  });

  describe('update', () => {
    it('rejects reassigning an employee to report to themselves', async () => {
      prisma.employee.findUnique.mockResolvedValueOnce(employee); // findRawOrThrow
      prisma.vertical.findUnique.mockResolvedValue(vertical);
      prisma.employee.findUnique.mockResolvedValueOnce(employee); // manager active-check

      await expect(
        service.update(
          employee.id,
          { reportingManagerId: employee.id },
          adminUser,
        ),
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
        service.update(
          manager.id,
          { reportingManagerId: employee.id },
          adminUser,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('forbids a non-super-admin from promoting an employee to ADMIN', async () => {
      prisma.employee.findUnique.mockResolvedValueOnce(employee); // findRawOrThrow
      await expect(
        service.update(employee.id, { role: Role.ADMIN }, adminUser),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('forbids a non-super-admin from changing an existing ADMIN’s role', async () => {
      const existingAdmin = { ...employee, role: Role.ADMIN };
      prisma.employee.findUnique.mockResolvedValueOnce(existingAdmin); // findRawOrThrow
      await expect(
        service.update(existingAdmin.id, { role: Role.EMPLOYEE }, adminUser),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('lets a SUPER_ADMIN promote an employee to ADMIN', async () => {
      prisma.employee.findUnique
        .mockResolvedValueOnce(employee) // findRawOrThrow
        .mockResolvedValueOnce(manager); // manager active-check
      prisma.vertical.findUnique.mockResolvedValue(vertical);
      prisma.employee.update.mockResolvedValue({
        ...employee,
        role: Role.ADMIN,
      });

      const result = await service.update(
        employee.id,
        { role: Role.ADMIN },
        superAdminUser,
      );
      expect(result.role).toBe(Role.ADMIN);
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
        monthlyCtc: 35195,
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
          $queryRaw: jest.fn().mockResolvedValue([{ lastValue: 3 }]),
          employee: {
            create: jest.fn().mockResolvedValue(createdEmployee),
            findUnique: jest.fn().mockResolvedValue(null), // official-email collision check: no collision
            findFirst: jest.fn().mockResolvedValue(null), // generated-email uniqueness scan (email + officialEmail)
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
        officialEmail: 'john.doe@phaze-dynamics.com',
        email: 'john.doe@phaze-dynamics.com',
      };
      mockHrTransaction(created);

      const result = await service.onboard(onboardDto, hrStaffUser);

      expect(result.id).toBe('new-emp');
      expect(prisma.$transaction).toHaveBeenCalled();
    });

    it('links a requisition whose candidate accepted an offer, fulfils it, and re-anchors the letter to the new employee', async () => {
      prisma.vertical.findUnique.mockResolvedValueOnce(hrVertical);
      prisma.vertical.findUnique.mockResolvedValueOnce(salesVertical);
      const created = {
        ...employee,
        id: 'new-emp-linked',
        firstName: 'John',
        lastName: 'Doe',
      };
      const updateMany = jest.fn().mockResolvedValue({ count: 1 });
      const offerUpdate = jest.fn().mockResolvedValue({});
      prisma.$transaction.mockImplementation(async (cb: any) =>
        cb({
          $queryRaw: jest.fn().mockResolvedValue([{ lastValue: 9 }]),
          employee: {
            create: jest.fn().mockResolvedValue(created),
            findUnique: jest.fn().mockResolvedValue(null),
            findFirst: jest.fn().mockResolvedValue(null),
          },
          candidateRequisition: {
            findUnique: jest.fn().mockResolvedValue({
              status: 'APPROVED',
              verticalId: onboardDto.verticalId,
              onboardedEmployeeId: null,
              offerLetters: [{ id: 'offer-1' }],
            }),
            updateMany,
          },
          offerLetter: { update: offerUpdate },
          salaryStructure: { create: jest.fn().mockResolvedValue({}) },
          employeeStatutoryInfo: { create: jest.fn().mockResolvedValue({}) },
          employeeBankDetails: { create: jest.fn().mockResolvedValue({}) },
          vaultFolder: { create: jest.fn().mockResolvedValue({}) },
        }),
      );

      await service.onboard(
        {
          ...onboardDto,
          candidateRequisitionId: '11111111-1111-4111-8111-111111111111',
        },
        hrStaffUser,
      );

      // The claim no longer requires the requisition to already be Fulfilled —
      // this onboarding is what fulfils it.
      expect(updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: '11111111-1111-4111-8111-111111111111',
            status: 'APPROVED',
            onboardedEmployeeId: null,
          },
          data: {
            onboardedEmployeeId: 'new-emp-linked',
            selectedCandidateName: 'John Doe',
            hiringStage: CandidateHiringStage.CANDIDATE_SELECTED,
          },
        }),
      );
      // The signed letter stays reachable from the employee record it produced.
      expect(offerUpdate).toHaveBeenCalledWith({
        where: { id: 'offer-1' },
        data: { employeeId: 'new-emp-linked' },
      });
    });

    it('refuses to onboard a candidate who has not accepted an approved offer letter', async () => {
      prisma.vertical.findUnique.mockResolvedValueOnce(hrVertical);
      prisma.vertical.findUnique.mockResolvedValueOnce(salesVertical);
      prisma.$transaction.mockImplementation(async (cb: any) =>
        cb({
          candidateRequisition: {
            findUnique: jest.fn().mockResolvedValue({
              status: 'APPROVED',
              verticalId: onboardDto.verticalId,
              onboardedEmployeeId: null,
              // Approved and sent, but nobody has said yes — filtered out by the
              // query, so this is the empty case.
              offerLetters: [],
            }),
          },
        }),
      );

      await expect(
        service.onboard(
          {
            ...onboardDto,
            candidateRequisitionId: '11111111-1111-4111-8111-111111111111',
          },
          hrStaffUser,
        ),
      ).rejects.toThrow('has not accepted an approved offer letter yet');
    });

    it('refuses to place a requisition-backed candidate in another vertical', async () => {
      prisma.vertical.findUnique.mockResolvedValueOnce(hrVertical);
      prisma.vertical.findUnique.mockResolvedValueOnce(salesVertical);
      prisma.$transaction.mockImplementation(async (cb: any) =>
        cb({
          candidateRequisition: {
            findUnique: jest.fn().mockResolvedValue({
              status: 'APPROVED',
              verticalId: 'different-vertical',
              onboardedEmployeeId: null,
              offerLetters: [{ id: 'offer-1' }],
            }),
          },
        }),
      );

      await expect(
        service.onboard(
          {
            ...onboardDto,
            candidateRequisitionId: '11111111-1111-4111-8111-111111111111',
          },
          hrStaffUser,
        ),
      ).rejects.toThrow(
        'employee vertical must match the candidate requisition vertical',
      );
    });

    it('uses a normalized HR-supplied official email when provided', async () => {
      prisma.vertical.findUnique.mockResolvedValueOnce(hrVertical);
      prisma.vertical.findUnique.mockResolvedValueOnce(salesVertical);
      let capturedEmployee: any;
      prisma.$transaction.mockImplementation(async (cb: any) =>
        cb({
          $queryRaw: jest.fn().mockResolvedValue([{ lastValue: 5 }]),
          employee: {
            findUnique: jest.fn().mockResolvedValue(null),
            create: jest.fn((args: any) => {
              capturedEmployee = args.data;
              return Promise.resolve({
                ...employee,
                ...args.data,
                id: 'new-emp-3',
              });
            }),
          },
          salaryStructure: { create: jest.fn().mockResolvedValue({}) },
          employeeStatutoryInfo: { create: jest.fn().mockResolvedValue({}) },
          employeeBankDetails: { create: jest.fn().mockResolvedValue({}) },
          vaultFolder: { create: jest.fn().mockResolvedValue({}) },
        }),
      );

      await service.onboard(
        {
          ...onboardDto,
          officialEmail: ' John.D@Phaze-Dynamics.com ',
        },
        hrStaffUser,
      );

      expect(capturedEmployee.officialEmail).toBe('john.d@phaze-dynamics.com');
      expect(capturedEmployee.email).toBe('john.d@phaze-dynamics.com');
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
          $queryRaw: jest.fn().mockResolvedValue([{ lastValue: 4 }]),
          employee: {
            create: jest.fn().mockResolvedValue(created),
            findUnique: jest.fn().mockResolvedValue(null),
            findFirst: jest.fn().mockResolvedValue(null),
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

    it('stores the server-calculated structure from the submitted monthly CTC', async () => {
      prisma.vertical.findUnique.mockResolvedValueOnce(hrVertical);
      prisma.vertical.findUnique.mockResolvedValueOnce(salesVertical);
      const created = { ...employee, id: 'new-emp-3' };

      let capturedSalary: any;
      prisma.$transaction.mockImplementation(async (cb: any) =>
        cb({
          $queryRaw: jest.fn().mockResolvedValue([{ lastValue: 5 }]),
          employee: {
            create: jest.fn().mockResolvedValue(created),
            findUnique: jest.fn().mockResolvedValue(null),
            findFirst: jest.fn().mockResolvedValue(null),
          },
          salaryStructure: {
            create: jest.fn((args: any) => {
              capturedSalary = args.data;
              return Promise.resolve({});
            }),
          },
          employeeStatutoryInfo: { create: jest.fn().mockResolvedValue({}) },
          employeeBankDetails: { create: jest.fn().mockResolvedValue({}) },
          vaultFolder: { create: jest.fn().mockResolvedValue({}) },
        }),
      );

      await service.onboard(
        {
          ...onboardDto,
          compensation: {
            monthlyCtc: 35195,
            effectiveDate: '2026-07-05',
          },
        },
        hrStaffUser,
      );

      expect(capturedSalary.basic).toBe('18000');
      expect(capturedSalary.hra).toBe('9600');
      expect(capturedSalary.specialAllowance).toBe('500');
      expect(capturedSalary.otherAllowances).toBe('1900');
      expect(capturedSalary.variablePay).toBe('30000');
      expect(capturedSalary.ctcAnnual).toBe('422340');
    });

    it('does not accept client-entered component values', async () => {
      prisma.vertical.findUnique.mockResolvedValueOnce(hrVertical);
      prisma.vertical.findUnique.mockResolvedValueOnce(salesVertical);
      const created = { ...employee, id: 'new-emp-4' };

      let capturedSalary: any;
      prisma.$transaction.mockImplementation(async (cb: any) =>
        cb({
          $queryRaw: jest.fn().mockResolvedValue([{ lastValue: 6 }]),
          employee: {
            create: jest.fn().mockResolvedValue(created),
            findUnique: jest.fn().mockResolvedValue(null),
            findFirst: jest.fn().mockResolvedValue(null),
          },
          salaryStructure: {
            create: jest.fn((args: any) => {
              capturedSalary = args.data;
              return Promise.resolve({});
            }),
          },
          employeeStatutoryInfo: { create: jest.fn().mockResolvedValue({}) },
          employeeBankDetails: { create: jest.fn().mockResolvedValue({}) },
          vaultFolder: { create: jest.fn().mockResolvedValue({}) },
        }),
      );

      await service.onboard(onboardDto, hrStaffUser);

      expect(capturedSalary.basic).toBe('18000');
      expect(capturedSalary.hra).toBe('9600');
      expect(capturedSalary.ctcAnnual).toBe('422340');
    });
  });

  describe('grantAccess', () => {
    const pendingEmployee = {
      ...employee,
      id: 'pending-1',
      role: null,
      passwordHash: null,
      accessStatus: AccessStatus.PENDING_ACCESS,
      officialEmail: 'john.doe@phaze-dynamics.com',
    };

    it('assigns role, sets password, activates login, and promotes officialEmail to email', async () => {
      prisma.$transaction.mockImplementationOnce((callback: any) =>
        callback(prisma),
      );
      prisma.employee.findUnique.mockResolvedValueOnce(pendingEmployee); // findRawOrThrow
      prisma.vertical.findUnique.mockResolvedValue(vertical);
      prisma.employee.findUnique.mockResolvedValueOnce(manager); // manager active-check
      prisma.employee.update.mockResolvedValue({
        ...pendingEmployee,
        role: Role.EMPLOYEE,
        accessStatus: AccessStatus.ACTIVE,
        email: pendingEmployee.officialEmail,
      });

      const result = await service.grantAccess(
        pendingEmployee.id,
        {
          role: Role.EMPLOYEE,
          verticalId: vertical.id,
          reportingManagerId: manager.id,
          password: 'S3curePass!',
        },
        adminUser,
      );

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
        service.grantAccess(
          pendingEmployee.id,
          {
            role: Role.EMPLOYEE,
            verticalId: vertical.id,
            reportingManagerId: manager.id,
            password: 'S3curePass!',
          },
          adminUser,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('forbids a non-super-admin from granting access as an ADMIN', async () => {
      prisma.employee.findUnique.mockResolvedValueOnce(pendingEmployee); // findRawOrThrow
      await expect(
        service.grantAccess(
          pendingEmployee.id,
          {
            role: Role.ADMIN,
            verticalId: vertical.id,
            reportingManagerId: manager.id,
            password: 'S3curePass!',
          },
          adminUser,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('denyAccess', () => {
    const pendingEmployee = {
      ...employee,
      id: 'pending-denial-1',
      accessStatus: AccessStatus.PENDING_ACCESS,
      accessDeniedAt: null,
      accessDeniedById: null,
      accessDenialReason: null,
    };

    it('denies login access while retaining the employee record and audit reason', async () => {
      prisma.employee.findUnique.mockResolvedValueOnce(pendingEmployee);
      prisma.employee.update.mockResolvedValue({
        ...pendingEmployee,
        accessStatus: AccessStatus.INACTIVE,
        accessDeniedAt: new Date(),
        accessDeniedById: adminUser.id,
        accessDenialReason: 'Duplicate onboarding record',
      });

      const result = await service.denyAccess(
        pendingEmployee.id,
        'Duplicate onboarding record',
        adminUser,
      );

      expect(result.accessStatus).toBe(AccessStatus.INACTIVE);
      expect(result.accessDenialReason).toBe('Duplicate onboarding record');
      expect(prisma.employee.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: pendingEmployee.id },
          data: expect.objectContaining({
            accessStatus: AccessStatus.INACTIVE,
            accessDeniedById: adminUser.id,
            passwordHash: null,
          }),
        }),
      );
    });

    it('refuses to deny an access request that is no longer pending', async () => {
      prisma.employee.findUnique.mockResolvedValueOnce({
        ...pendingEmployee,
        accessStatus: AccessStatus.ACTIVE,
      });

      await expect(
        service.denyAccess(pendingEmployee.id, 'Not required', adminUser),
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
