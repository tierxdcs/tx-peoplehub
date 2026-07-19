import { BadRequestException } from '@nestjs/common';
import { DesignService } from './design.service';

describe('DesignService phase 4 controls', () => {
  const prisma: any = {
    designReview: { findUnique: jest.fn(), update: jest.fn() },
    designChange: { findUnique: jest.fn() },
    designChangeReport: { findFirst: jest.fn() },
  };
  const access: any = { assertUser: jest.fn(), assertHead: jest.fn() };
  const service = new DesignService(prisma, access, {} as any);
  const user: any = { id: 'employee-1', role: 'EMPLOYEE' };

  beforeEach(() => jest.clearAllMocks());

  it('requires reusable templates to contain requirements and milestones', async () => {
    await expect(
      service.createTemplate(
        { name: 'Empty', requirements: [], milestones: [] },
        user,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('blocks design-review closure while an action is unverified', async () => {
    prisma.designReview.findUnique.mockResolvedValue({
      status: 'PENDING_CLOSURE',
      minutes: 'Reviewed',
      decision: 'Proceed',
      attendees: [],
      actions: [{ status: 'COMPLETED' }],
    });
    await expect(service.closeReview('review-1', user)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.designReview.update).not.toHaveBeenCalled();
  });

  it('does not generate a report for an unapproved engineering change', async () => {
    prisma.designChangeReport.findFirst.mockResolvedValue(null);
    prisma.designChange.findUnique.mockResolvedValue({
      status: 'IMPACT_ASSESSMENT',
      impacts: [],
      affectedItems: [],
      acknowledgements: [],
      project: {},
    });
    await expect(
      service.generateChangeReport({ changeId: 'change-1' }, user),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
