import { ForbiddenException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../core/database/prisma.service';
import { PlmAccessService } from './plm-access.service';

describe('PlmAccessService — Project Manager authority', () => {
  const projectManager: AuthenticatedUser = {
    id: 'pm-1',
    email: 'pm@example.com',
    role: Role.EMPLOYEE,
    verticalId: 'projects',
  };
  const employee: AuthenticatedUser = {
    id: 'employee-1',
    email: 'employee@example.com',
    role: Role.EMPLOYEE,
    verticalId: 'scm',
  };
  const productionHead: AuthenticatedUser = {
    id: 'production-head-1',
    email: 'production@example.com',
    role: Role.MANAGER,
    verticalId: 'production',
  };

  let prisma: {
    employee: { findUnique: jest.Mock };
    plmTracker: { findUnique: jest.Mock; findFirst: jest.Mock };
  };
  let service: PlmAccessService;

  beforeEach(() => {
    prisma = {
      employee: {
        findUnique: jest.fn().mockImplementation(({ where }) =>
          Promise.resolve({
            isProjectManager: where.id === projectManager.id,
            isProductionHead: where.id === productionHead.id,
            isInternalAuditor: false,
            isDesignHead: false,
            isRdHead: false,
            vertical: { code: 'PROJECTS' },
          }),
        ),
      },
      plmTracker: {
        findUnique: jest.fn().mockResolvedValue({
          ownerId: 'someone-else',
          order: { ownerId: 'someone-else' },
          kickoff: { attendees: [] },
        }),
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };
    service = new PlmAccessService(prisma as unknown as PrismaService);
  });

  it('grants a Project Manager every internal PLM permission gate', async () => {
    await expect(
      service.assertCanOperate(projectManager, 'someone-else'),
    ).resolves.toBeUndefined();
    await expect(
      service.assertCanConfirmStage(projectManager),
    ).resolves.toBeUndefined();
    await expect(
      service.assertProductionHead(projectManager),
    ).resolves.toBeUndefined();
    await expect(
      service.assertCanCompleteDesign(projectManager),
    ).resolves.toBeUndefined();
    await expect(
      service.assertInternalAuditor(projectManager),
    ).resolves.toBeUndefined();
  });

  it('allows a Project Manager to view unrelated trackers and orders', async () => {
    await expect(
      service.assertCanViewTracker(projectManager, 'tracker-1'),
    ).resolves.toBeUndefined();
    await expect(
      service.assertCanViewOrder(projectManager, 'order-1'),
    ).resolves.toBeUndefined();
  });

  it('does not grant full authority to an ordinary employee', async () => {
    await expect(
      service.assertCanOperate(employee, 'someone-else'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.assertProductionHead(employee)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('does not let a tracker owner or Production Head confirm a lifecycle stage', async () => {
    await expect(
      service.assertCanConfirmStage(employee),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.assertCanConfirmStage(productionHead),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('lets the CEO/SuperAdmin confirm a lifecycle stage', async () => {
    await expect(
      service.assertCanConfirmStage({ ...employee, role: Role.SUPER_ADMIN }),
    ).resolves.toBeUndefined();
  });
});
