import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { DesignService } from './design.service';

describe('DesignService project stage gates', () => {
  const prisma: any = {
    designProject: { findUnique: jest.fn(), update: jest.fn() },
    designRequest: { findUnique: jest.fn(), update: jest.fn() },
  };
  const access: any = { assertUser: jest.fn(), assertHead: jest.fn() };
  const service = new DesignService(
    prisma,
    access,
    {} as any,
    {
      approvalRequired: jest.fn(),
      designReviewRejected: jest.fn(),
    } as never,
  );
  const user: any = { id: 'employee-1', role: 'EMPLOYEE' };

  // resetAllMocks (not clearAllMocks) so a mockRejectedValue set on the shared
  // assertHead mock in one test doesn't leak into the next.
  beforeEach(() => jest.resetAllMocks());

  // Minimal project payload matching updateProjectStatus's include shape.
  const project = (over: any = {}) => ({
    id: 'project-1',
    status: 'REQUIREMENTS',
    requirements: [],
    milestones: [],
    changes: [],
    documents: [],
    reviews: [],
    ...over,
  });

  describe('updateProjectStatus', () => {
    it('blocks REQUIREMENTS -> CONCEPT until at least one requirement exists', async () => {
      prisma.designProject.findUnique.mockResolvedValue(project());
      await expect(
        service.updateProjectStatus('project-1', 'CONCEPT', user),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.designProject.update).not.toHaveBeenCalled();
    });

    it('allows REQUIREMENTS -> CONCEPT once a requirement is defined', async () => {
      prisma.designProject.findUnique.mockResolvedValue(
        project({ requirements: [{ id: 'r1' }] }),
      );
      prisma.designProject.update.mockResolvedValue({});
      await service.updateProjectStatus('project-1', 'CONCEPT', user);
      expect(prisma.designProject.update).toHaveBeenCalledWith({
        where: { id: 'project-1' },
        data: { status: 'CONCEPT' },
      });
    });

    it('enforces every intermediate gate when skipping stages (cumulative)', async () => {
      // The CONCEPT gate passes (a requirement exists) but the DETAILED_DESIGN
      // gate fails — no approved preliminary review — so the whole jump is blocked.
      prisma.designProject.findUnique.mockResolvedValue(
        project({ requirements: [{ id: 'r1' }], reviews: [] }),
      );
      await expect(
        service.updateProjectStatus('project-1', 'DETAILED_DESIGN', user),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.designProject.update).not.toHaveBeenCalled();
    });

    it('treats the latest closed review as the gate signal (a later rejection re-blocks)', async () => {
      prisma.designProject.findUnique.mockResolvedValue(
        project({
          status: 'CONCEPT',
          requirements: [{ id: 'r1' }],
          reviews: [
            {
              reviewType: 'PRELIMINARY_DESIGN_REVIEW',
              status: 'CLOSED',
              outcome: 'APPROVED',
              closedAt: new Date('2026-01-01'),
            },
            {
              reviewType: 'PRELIMINARY_DESIGN_REVIEW',
              status: 'CLOSED',
              outcome: 'REJECTED',
              closedAt: new Date('2026-02-01'),
            },
          ],
        }),
      );
      await expect(
        service.updateProjectStatus('project-1', 'DETAILED_DESIGN', user),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('accepts an APPROVED_WITH_CONDITIONS review as passing the gate', async () => {
      prisma.designProject.findUnique.mockResolvedValue(
        project({
          status: 'CONCEPT',
          requirements: [{ id: 'r1' }],
          reviews: [
            {
              reviewType: 'PRELIMINARY_DESIGN_REVIEW',
              status: 'CLOSED',
              outcome: 'APPROVED_WITH_CONDITIONS',
              closedAt: new Date('2026-02-01'),
            },
          ],
        }),
      );
      prisma.designProject.update.mockResolvedValue({});
      await service.updateProjectStatus('project-1', 'DETAILED_DESIGN', user);
      expect(prisma.designProject.update).toHaveBeenCalled();
    });

    it('requires every document to have a revision submitted for approval before INTERNAL_REVIEW', async () => {
      prisma.designProject.findUnique.mockResolvedValue(
        project({
          status: 'DETAILED_DESIGN',
          documents: [{ revisions: [{ status: 'DRAFT' }] }],
        }),
      );
      await expect(
        service.updateProjectStatus('project-1', 'INTERNAL_REVIEW', user),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('blocks INTERNAL_REVIEW when no documents are registered', async () => {
      prisma.designProject.findUnique.mockResolvedValue(
        project({ status: 'DETAILED_DESIGN', documents: [] }),
      );
      await expect(
        service.updateProjectStatus('project-1', 'INTERNAL_REVIEW', user),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('does not gate off-ladder transitions such as ON_HOLD', async () => {
      // An empty project would fail every ladder gate, but ON_HOLD is off-ladder.
      prisma.designProject.findUnique.mockResolvedValue(project());
      prisma.designProject.update.mockResolvedValue({});
      await service.updateProjectStatus('project-1', 'ON_HOLD', user);
      expect(prisma.designProject.update).toHaveBeenCalledWith({
        where: { id: 'project-1' },
        data: { status: 'ON_HOLD' },
      });
    });

    it('does not gate a move backwards down the ladder (rework)', async () => {
      prisma.designProject.findUnique.mockResolvedValue(
        project({ status: 'DETAILED_DESIGN' }),
      );
      prisma.designProject.update.mockResolvedValue({});
      await service.updateProjectStatus('project-1', 'CONCEPT', user);
      expect(prisma.designProject.update).toHaveBeenCalled();
    });

    it('keeps the production-release gate head-only', async () => {
      prisma.designProject.findUnique.mockResolvedValue(
        project({
          status: 'CUSTOMER_APPROVAL',
          documents: [{ revisions: [{ status: 'RELEASED' }] }],
        }),
      );
      access.assertHead.mockRejectedValue(new ForbiddenException());
      await expect(
        service.updateProjectStatus(
          'project-1',
          'RELEASED_FOR_PRODUCTION',
          user,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.designProject.update).not.toHaveBeenCalled();
    });

    it('keeps the production-release readiness checks (released revisions required)', async () => {
      prisma.designProject.findUnique.mockResolvedValue(
        project({
          status: 'CUSTOMER_APPROVAL',
          documents: [{ revisions: [{ status: 'PENDING_APPROVAL' }] }],
        }),
      );
      await expect(
        service.updateProjectStatus(
          'project-1',
          'RELEASED_FOR_PRODUCTION',
          user,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('releases for production when every release criterion is met', async () => {
      prisma.designProject.findUnique.mockResolvedValue(
        project({
          status: 'CUSTOMER_APPROVAL',
          documents: [{ revisions: [{ status: 'RELEASED' }] }],
          requirements: [{ required: true, status: 'VERIFIED' }],
          milestones: [{ status: 'COMPLETED' }],
          changes: [{ status: 'CLOSED' }],
        }),
      );
      prisma.designProject.update.mockResolvedValue({});
      await service.updateProjectStatus(
        'project-1',
        'RELEASED_FOR_PRODUCTION',
        user,
      );
      expect(access.assertHead).toHaveBeenCalled();
      expect(prisma.designProject.update).toHaveBeenCalledWith({
        where: { id: 'project-1' },
        data: { status: 'RELEASED_FOR_PRODUCTION' },
      });
    });

    it('throws NotFound when the project does not exist', async () => {
      prisma.designProject.findUnique.mockResolvedValue(null);
      await expect(
        service.updateProjectStatus('missing', 'CONCEPT', user),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('updateRequestStatus', () => {
    it('accepts an OPEN request', async () => {
      prisma.designRequest.findUnique.mockResolvedValue({
        id: 'req-1',
        status: 'OPEN',
      });
      prisma.designRequest.update.mockResolvedValue({});
      await service.updateRequestStatus('req-1', 'ACCEPTED', user);
      expect(prisma.designRequest.update).toHaveBeenCalledWith({
        where: { id: 'req-1' },
        data: { status: 'ACCEPTED' },
      });
    });

    it('refuses to set CONVERTED manually (only project creation converts a request)', async () => {
      prisma.designRequest.findUnique.mockResolvedValue({
        id: 'req-1',
        status: 'OPEN',
      });
      await expect(
        service.updateRequestStatus('req-1', 'CONVERTED', user),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.designRequest.update).not.toHaveBeenCalled();
    });

    it('refuses to transition a terminal (CONVERTED) request', async () => {
      prisma.designRequest.findUnique.mockResolvedValue({
        id: 'req-1',
        status: 'CONVERTED',
      });
      await expect(
        service.updateRequestStatus('req-1', 'CLOSED', user),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('lets an ACCEPTED request be rejected or closed but not re-accepted', async () => {
      prisma.designRequest.findUnique.mockResolvedValue({
        id: 'req-1',
        status: 'ACCEPTED',
      });
      await expect(
        service.updateRequestStatus('req-1', 'ACCEPTED', user),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws NotFound when the request does not exist', async () => {
      prisma.designRequest.findUnique.mockResolvedValue(null);
      await expect(
        service.updateRequestStatus('missing', 'ACCEPTED', user),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
