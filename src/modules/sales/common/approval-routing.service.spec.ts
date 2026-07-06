import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../../../core/database/prisma.service';
import { AuthenticatedUser } from '../../../common/decorators/current-user.decorator';
import { ApprovalRoutingService } from './approval-routing.service';

describe('ApprovalRoutingService', () => {
  let service: ApprovalRoutingService;
  let prisma: any;

  const manager: AuthenticatedUser = {
    id: 'mgr-1',
    email: 'm@x.com',
    role: Role.MANAGER,
    verticalId: 'v-sales',
  };
  const admin: AuthenticatedUser = {
    id: 'ad-1',
    email: 'a@x.com',
    role: Role.ADMIN,
    verticalId: null,
  };

  beforeEach(async () => {
    prisma = { employee: { findUnique: jest.fn() } };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ApprovalRoutingService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = module.get(ApprovalRoutingService);
  });

  describe('resolveApprover', () => {
    it("returns the creator's reportingManagerId", async () => {
      prisma.employee.findUnique.mockResolvedValue({
        reportingManagerId: 'mgr-1',
      });
      expect(await service.resolveApprover('emp-1')).toBe('mgr-1');
    });

    it('returns null when the creator has no manager', async () => {
      prisma.employee.findUnique.mockResolvedValue({
        reportingManagerId: null,
      });
      expect(await service.resolveApprover('emp-1')).toBeNull();
    });
  });

  describe('assertCanActOnBid', () => {
    it('blocks self-approval even for a manager (their own bid escalates)', async () => {
      await expect(
        service.assertCanActOnBid('mgr-1', manager),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('allows the resolved manager to act', async () => {
      prisma.employee.findUnique.mockResolvedValue({
        reportingManagerId: 'mgr-1',
      });
      await expect(
        service.assertCanActOnBid('emp-1', manager),
      ).resolves.toBeUndefined();
    });

    it('rejects a manager who is not the creator’s manager', async () => {
      prisma.employee.findUnique.mockResolvedValue({
        reportingManagerId: 'other-mgr',
      });
      await expect(
        service.assertCanActOnBid('emp-1', manager),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('allows Admin to override-approve anyone else’s bid', async () => {
      await expect(
        service.assertCanActOnBid('emp-1', admin),
      ).resolves.toBeUndefined();
      // Admin path short-circuits before resolving an approver.
      expect(prisma.employee.findUnique).not.toHaveBeenCalled();
    });
  });
});
