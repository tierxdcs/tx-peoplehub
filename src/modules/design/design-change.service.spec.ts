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
  const service = new DesignService(prisma, access, {} as any);
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
    await expect(service.submitChangeApproval('change-1', user)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.designChange.update).not.toHaveBeenCalled();
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
      service.closeChange('change-1', { implementationNote: 'Installed' }, user),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.designChange.update).not.toHaveBeenCalled();
  });
});
