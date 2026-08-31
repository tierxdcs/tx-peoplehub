import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { DesignService } from './design.service';

describe('DesignService engineering change controls', () => {
  const prisma: any = {
    designChange: { findUnique: jest.fn(), update: jest.fn() },
    designChangeImpact: { findUnique: jest.fn(), update: jest.fn() },
  };
  const access: any = {
    assertUser: jest.fn(),
    assertHead: jest.fn(),
    accessFor: jest.fn(),
  };
  const pushEvents: any = {
    approvalRequired: jest.fn(),
    designReviewRejected: jest.fn(),
  };
  const service = new DesignService(prisma, access, {} as any, pushEvents);
  const user: any = { id: 'employee-1', role: 'EMPLOYEE' };

  beforeEach(() => jest.clearAllMocks());

  it('does not send a change for approval until every impact is assessed', async () => {
    prisma.designChange.findUnique.mockResolvedValue({
      id: 'change-1',
      status: 'IMPACT_ASSESSMENT',
      impacts: [{ status: 'PENDING' }],
      affectedItems: [{ disposition: 'USE_AS_IS' }],
      acknowledgements: [{ status: 'PENDING' }],
      project: {},
    });
    await expect(
      service.submitChangeApproval('change-1', user),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.designChange.update).not.toHaveBeenCalled();
    // No approval push for a submission that was refused — a Design Head must
    // never be told an ECR is waiting when nothing was written.
    expect(pushEvents.approvalRequired).not.toHaveBeenCalled();
  });

  it('asks the Design Head for approval, excluding a requester who is one', async () => {
    prisma.designChange.findUnique.mockResolvedValue({
      id: 'change-1',
      status: 'IMPACT_ASSESSMENT',
      impacts: [{ status: 'COMPLETED' }],
      affectedItems: [{ disposition: 'USE_AS_IS' }],
      acknowledgements: [{ status: 'PENDING' }],
      project: {},
    });
    prisma.designChange.update.mockResolvedValue({
      id: 'change-1',
      changeNumber: 'ECR-2026-0004',
      title: 'Swap the latch',
      requestedById: 'employee-1',
      status: 'PENDING_APPROVAL',
    });
    await service.submitChangeApproval('change-1', user);
    expect(pushEvents.approvalRequired).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'design-change',
        audience: { pool: 'DESIGN_HEAD' },
        reference: 'ECR-2026-0004 — Swap the latch',
        recordId: 'change-1',
        url: '/design/changes/change-1',
        // The requester cannot approve their own ECR, so they are excluded from
        // the pool rather than pushed an approval they would be refused.
        actorId: 'employee-1',
      }),
    );
  });

  it('allows only the assigned owner or Design Head to assess an impact', async () => {
    prisma.designChangeImpact.findUnique.mockResolvedValue({
      id: 'impact-1',
      ownerId: 'employee-2',
      change: { status: 'IMPACT_ASSESSMENT' },
    });
    access.accessFor.mockResolvedValue({ isDesignHead: false });
    await expect(
      service.completeImpact(
        'impact-1',
        { hasImpact: false, assessment: 'No impact' },
        user,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('blocks closure until every downstream function acknowledges implementation', async () => {
    prisma.designChange.findUnique.mockResolvedValue({
      id: 'change-1',
      status: 'IMPLEMENTING',
      impacts: [],
      affectedItems: [],
      acknowledgements: [{ status: 'PENDING' }],
      project: {},
    });
    await expect(
      service.closeChange(
        'change-1',
        { implementationNote: 'Installed' },
        user,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.designChange.update).not.toHaveBeenCalled();
  });
});
