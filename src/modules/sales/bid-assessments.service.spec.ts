import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { BidAssessmentStatus, Role } from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { BidAssessmentsService } from './bid-assessments.service';
import { SalesAccessService } from './common/sales-access.service';

describe('BidAssessmentsService', () => {
  let service: BidAssessmentsService;
  let prisma: any;
  let access: any;

  const rep: AuthenticatedUser = {
    id: 'emp-1',
    email: 'e@x.com',
    role: Role.EMPLOYEE,
    verticalId: 'v-sales',
  };
  const superAdmin: AuthenticatedUser = {
    id: 'sa-1',
    email: 'sa@x.com',
    role: Role.SUPER_ADMIN,
    verticalId: null,
  };

  beforeEach(async () => {
    prisma = {
      opportunity: { findUnique: jest.fn() },
      employee: { findUnique: jest.fn() },
      bidAssessmentQuestion: { findMany: jest.fn() },
      bidDecisionAssessment: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      $transaction: jest.fn(),
    };
    access = {
      assertSalesAccess: jest.fn().mockResolvedValue(undefined),
      assertCanAccessOwned: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BidAssessmentsService,
        { provide: PrismaService, useValue: prisma },
        { provide: SalesAccessService, useValue: access },
      ],
    }).compile();

    service = module.get(BidAssessmentsService);
  });

  describe('submit', () => {
    beforeEach(() => {
      prisma.opportunity.findUnique.mockResolvedValue({
        id: 'opp-1',
        ownerId: 'emp-1',
      });
      prisma.bidDecisionAssessment.findFirst.mockResolvedValue(null);
      prisma.bidAssessmentQuestion.findMany.mockResolvedValue([
        { id: 'q1', text: 'Budget confirmed?' },
        { id: 'q2', text: 'Feasible?' },
      ]);
      prisma.bidDecisionAssessment.create.mockImplementation(
        ({ data }: any) => ({
          id: 'a1',
          opportunityId: data.opportunityId,
          submittedById: data.submittedById,
          status: data.status,
          reviewedById: null,
          reviewedAt: null,
          reviewerComments: null,
          responses: data.responses.create.map((r: any, i: number) => ({
            id: `r${i}`,
            ...r,
          })),
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      );
    });

    it('snapshots question text onto each response', async () => {
      const result = await service.submit(
        'opp-1',
        {
          answers: [
            { questionId: 'q1', answerValue: 'true' },
            { questionId: 'q2', answerValue: '4' },
          ],
        },
        rep,
      );
      expect(result.status).toBe(BidAssessmentStatus.PENDING_REVIEW);
      const snapshots = result.responses?.map((r) => r.questionTextSnapshot);
      expect(snapshots).toEqual(['Budget confirmed?', 'Feasible?']);
    });

    it('rejects when an active question is left unanswered', async () => {
      await expect(
        service.submit(
          'opp-1',
          { answers: [{ questionId: 'q1', answerValue: 'true' }] },
          rep,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects an answer to an unknown/inactive question', async () => {
      await expect(
        service.submit(
          'opp-1',
          {
            answers: [
              { questionId: 'q1', answerValue: 'true' },
              { questionId: 'q2', answerValue: '4' },
              { questionId: 'ghost', answerValue: 'x' },
            ],
          },
          rep,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('blocks a second submission while one is already pending', async () => {
      prisma.bidDecisionAssessment.findFirst.mockResolvedValue({ id: 'a0' });
      await expect(
        service.submit(
          'opp-1',
          { answers: [{ questionId: 'q1', answerValue: 'true' }] },
          rep,
        ),
      ).rejects.toThrow(/already awaiting review/);
    });
  });

  describe('review routing', () => {
    beforeEach(() => {
      prisma.bidDecisionAssessment.findUnique.mockResolvedValue({
        id: 'a1',
        opportunityId: 'opp-1',
        submittedById: 'emp-1',
        status: BidAssessmentStatus.PENDING_REVIEW,
        reviewedById: null,
        reviewedAt: null,
        reviewerComments: null,
        responses: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      prisma.bidDecisionAssessment.update.mockImplementation(
        ({ data }: any) => ({
          id: 'a1',
          opportunityId: 'opp-1',
          submittedById: 'emp-1',
          status: data.status,
          reviewedById: data.reviewedById,
          reviewedAt: data.reviewedAt,
          reviewerComments: data.reviewerComments,
          responses: [],
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      );
    });

    it('lets the designated Sales Head approve', async () => {
      const head: AuthenticatedUser = {
        id: 'head-1',
        email: 'h@x.com',
        role: Role.MANAGER,
        verticalId: 'v-sales',
      };
      prisma.employee.findUnique.mockResolvedValue({ isSalesHead: true });

      const result = await service.approve('a1', {}, head);
      expect(result.status).toBe(BidAssessmentStatus.APPROVED);
      expect(result.reviewedById).toBe('head-1');
    });

    it('lets SUPER_ADMIN approve (fallback/override) without a Sales Head lookup', async () => {
      const result = await service.approve('a1', {}, superAdmin);
      expect(result.status).toBe(BidAssessmentStatus.APPROVED);
      expect(prisma.employee.findUnique).not.toHaveBeenCalled();
    });

    it('forbids a non-head, non-superadmin from reviewing', async () => {
      prisma.employee.findUnique.mockResolvedValue({ isSalesHead: false });
      await expect(service.approve('a1', {}, rep)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('requires comments on rejection', async () => {
      await expect(
        service.reject('a1', { reviewerComments: '  ' }, superAdmin),
      ).rejects.toThrow(/reviewerComments are required/);
    });

    it('rejects reviewing an already-decided assessment', async () => {
      prisma.bidDecisionAssessment.findUnique.mockResolvedValue({
        id: 'a1',
        status: BidAssessmentStatus.APPROVED,
        responses: [],
      });
      await expect(service.approve('a1', {}, superAdmin)).rejects.toThrow(
        /PENDING_REVIEW/,
      );
    });
  });

  describe('latestApprovedFor', () => {
    it('is true only when the most-recent assessment is APPROVED', async () => {
      prisma.bidDecisionAssessment.findFirst.mockResolvedValue({
        status: BidAssessmentStatus.APPROVED,
      });
      expect(await service.latestApprovedFor('opp-1')).toBe(true);
    });

    it('is false when the most-recent assessment is REJECTED (even if an older one was approved)', async () => {
      prisma.bidDecisionAssessment.findFirst.mockResolvedValue({
        status: BidAssessmentStatus.REJECTED,
      });
      expect(await service.latestApprovedFor('opp-1')).toBe(false);
    });

    it('is false when there is no assessment at all', async () => {
      prisma.bidDecisionAssessment.findFirst.mockResolvedValue(null);
      expect(await service.latestApprovedFor('opp-1')).toBe(false);
    });
  });
});
