import { Test, TestingModule } from '@nestjs/testing';
import { Role } from '@prisma/client';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../core/database/prisma.service';
import { EmployeesService } from '../employees/employees.service';
import { VaultAccessService } from './vault-access.service';

describe('VaultAccessService', () => {
  let service: VaultAccessService;
  let employees: { getTeamIds: jest.Mock };
  let prisma: { vaultInternalShare: { findUnique: jest.Mock } };

  const owner: AuthenticatedUser = {
    id: 'owner-1',
    email: 'o@x.com',
    role: Role.MANAGER,
    verticalId: 'v-sales',
  };
  const report: AuthenticatedUser = {
    id: 'report-1',
    email: 'r@x.com',
    role: Role.EMPLOYEE,
    verticalId: 'v-sales',
  };
  const outsider: AuthenticatedUser = {
    id: 'outsider-1',
    email: 'x@x.com',
    role: Role.EMPLOYEE,
    verticalId: 'v-hr',
  };
  const superAdmin: AuthenticatedUser = {
    id: 'sa-1',
    email: 'sa@x.com',
    role: Role.SUPER_ADMIN,
    verticalId: null,
  };

  function folder(overrides: Record<string, unknown> = {}) {
    return {
      id: 'f1',
      name: 'F',
      parentFolderId: null,
      type: 'CUSTOM',
      ownerId: 'owner-1',
      visibilityScope: 'TEAM',
      scopeVerticalId: null,
      versioningEnabled: false,
      maxVersionsRetained: 5,
      status: 'ACTIVE',
      permissions: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    } as any;
  }

  beforeEach(async () => {
    employees = { getTeamIds: jest.fn().mockResolvedValue([]) };
    // Default: no internal share exists (so scope/grant tests are unaffected).
    prisma = {
      vaultInternalShare: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VaultAccessService,
        { provide: EmployeesService, useValue: employees },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = module.get(VaultAccessService);
  });

  it('SUPER_ADMIN always gets full access, without a hierarchy lookup', async () => {
    const access = await service.computeAccess(superAdmin, folder());
    expect(access).toEqual({
      canRead: true,
      canWrite: true,
      canDelete: true,
      canCreateSubfolder: true,
    });
    expect(employees.getTeamIds).not.toHaveBeenCalled();
  });

  it('owner gets full access on their own folder regardless of scope', async () => {
    const access = await service.computeAccess(
      owner,
      folder({ visibilityScope: 'PRIVATE' }),
    );
    expect(access.canRead).toBe(true);
    expect(access.canDelete).toBe(true);
  });

  describe('PRIVATE scope', () => {
    it('non-owner gets nothing', async () => {
      const access = await service.computeAccess(
        report,
        folder({ visibilityScope: 'PRIVATE' }),
      );
      expect(access).toEqual({
        canRead: false,
        canWrite: false,
        canDelete: false,
        canCreateSubfolder: false,
      });
    });
  });

  describe('TEAM scope — rides the shared getTeamIds hierarchy', () => {
    it('a downstream report gets read+write, not delete', async () => {
      employees.getTeamIds.mockResolvedValue(['report-1', 'deep-1']);
      const access = await service.computeAccess(report, folder());
      expect(employees.getTeamIds).toHaveBeenCalledWith('owner-1');
      expect(access.canRead).toBe(true);
      expect(access.canWrite).toBe(true);
      expect(access.canDelete).toBe(false);
    });

    it('an employee outside the hierarchy gets nothing', async () => {
      employees.getTeamIds.mockResolvedValue(['report-1']);
      const access = await service.computeAccess(outsider, folder());
      expect(access.canRead).toBe(false);
    });
  });

  describe('VERTICAL scope', () => {
    const verticalFolder = () =>
      folder({
        visibilityScope: 'VERTICAL',
        scopeVerticalId: 'v-sales',
        ownerId: 'someone-else',
      });

    it('members of the vertical can read; EMPLOYEE cannot write', async () => {
      const access = await service.computeAccess(report, verticalFolder());
      expect(access.canRead).toBe(true);
      expect(access.canWrite).toBe(false);
    });

    it('a MANAGER in the vertical can write', async () => {
      const access = await service.computeAccess(
        { ...owner, id: 'other-mgr' },
        verticalFolder(),
      );
      expect(access.canRead).toBe(true);
      expect(access.canWrite).toBe(true);
    });

    it('employees of other verticals get nothing', async () => {
      const access = await service.computeAccess(outsider, verticalFolder());
      expect(access.canRead).toBe(false);
    });
  });

  describe('COMPANY_WIDE scope', () => {
    const companyFolder = () =>
      folder({ visibilityScope: 'COMPANY_WIDE', ownerId: 'someone-else' });

    it('everyone reads; EMPLOYEE cannot write', async () => {
      const access = await service.computeAccess(outsider, companyFolder());
      expect(access.canRead).toBe(true);
      expect(access.canWrite).toBe(false);
    });

    it('MANAGER can write', async () => {
      const access = await service.computeAccess(
        { ...owner, id: 'other-mgr' },
        companyFolder(),
      );
      expect(access.canWrite).toBe(true);
    });
  });

  describe('explicit grants — additive, most-permissive-wins', () => {
    it('an EMPLOYEE grant adds access beyond scope without reducing anything', async () => {
      const f = folder({
        visibilityScope: 'PRIVATE',
        ownerId: 'someone-else',
        permissions: [
          {
            granteeType: 'EMPLOYEE',
            granteeId: 'outsider-1',
            canRead: true,
            canWrite: false,
            canDelete: false,
            canCreateSubfolder: false,
          },
        ],
      });
      const access = await service.computeAccess(outsider, f);
      expect(access.canRead).toBe(true);
      expect(access.canWrite).toBe(false);
    });

    it('VERTICAL and ROLE grants match by verticalId / role', async () => {
      const f = folder({
        visibilityScope: 'PRIVATE',
        ownerId: 'someone-else',
        permissions: [
          {
            granteeType: 'VERTICAL',
            granteeId: 'v-hr',
            canRead: true,
            canWrite: false,
            canDelete: false,
            canCreateSubfolder: false,
          },
          {
            granteeType: 'ROLE',
            granteeId: 'EMPLOYEE',
            canRead: false,
            canWrite: true,
            canDelete: false,
            canCreateSubfolder: false,
          },
        ],
      });
      // outsider is v-hr EMPLOYEE → union of both grants.
      const access = await service.computeAccess(outsider, f);
      expect(access.canRead).toBe(true);
      expect(access.canWrite).toBe(true);
      expect(access.canDelete).toBe(false);
    });

    it('grants union with scope access (scope read + grant delete)', async () => {
      const f = folder({
        visibilityScope: 'COMPANY_WIDE',
        ownerId: 'someone-else',
        permissions: [
          {
            granteeType: 'EMPLOYEE',
            granteeId: 'outsider-1',
            canRead: false,
            canWrite: false,
            canDelete: true,
            canCreateSubfolder: false,
          },
        ],
      });
      const access = await service.computeAccess(outsider, f);
      // read from COMPANY_WIDE scope, delete from the grant.
      expect(access.canRead).toBe(true);
      expect(access.canDelete).toBe(true);
    });
  });

  describe('internal shares (Phase 3) — additive, most-permissive-wins', () => {
    it('a FOLDER share grants access to an otherwise-excluded employee', async () => {
      prisma.vaultInternalShare.findUnique.mockResolvedValue({
        resourceType: 'FOLDER',
        resourceId: 'f1',
        sharedWithEmployeeId: 'outsider-1',
        permission: 'EDIT',
      });
      const access = await service.computeAccess(
        outsider,
        folder({ visibilityScope: 'PRIVATE', ownerId: 'someone-else' }),
      );
      expect(access.canRead).toBe(true);
      expect(access.canWrite).toBe(true); // EDIT
      expect(access.canDelete).toBe(false); // shares never grant delete
    });

    it('VIEW share grants read only', async () => {
      prisma.vaultInternalShare.findUnique.mockResolvedValue({
        permission: 'VIEW',
      });
      const access = await service.computeAccess(
        outsider,
        folder({ visibilityScope: 'PRIVATE', ownerId: 'someone-else' }),
      );
      expect(access.canRead).toBe(true);
      expect(access.canWrite).toBe(false);
    });

    it('computeFileAccess: a FILE share grants access even with NO folder access', async () => {
      // Folder itself is invisible to the outsider; only the file is shared.
      const f = folder({ visibilityScope: 'PRIVATE', ownerId: 'someone-else' });
      prisma.vaultInternalShare.findUnique.mockImplementation((args: any) => {
        const t =
          args.where.resourceType_resourceId_sharedWithEmployeeId.resourceType;
        // FOLDER lookup → none; FILE lookup → a VIEW share.
        return Promise.resolve(t === 'FILE' ? { permission: 'VIEW' } : null);
      });
      const access = await service.computeFileAccess(outsider, 'file-1', f);
      expect(access.canRead).toBe(true);
      expect(access.canWrite).toBe(false);
    });

    it('a VIEW file-share does NOT downgrade broader folder access', async () => {
      // `report` is in the owner's team → folder gives read+write.
      employees.getTeamIds.mockResolvedValue(['report-1']);
      prisma.vaultInternalShare.findUnique.mockImplementation((args: any) => {
        const t =
          args.where.resourceType_resourceId_sharedWithEmployeeId.resourceType;
        return Promise.resolve(t === 'FILE' ? { permission: 'VIEW' } : null);
      });
      const access = await service.computeFileAccess(
        report,
        'file-1',
        folder(),
      );
      // Folder write survives the VIEW-only file share (union, not override).
      expect(access.canRead).toBe(true);
      expect(access.canWrite).toBe(true);
    });
  });
});
