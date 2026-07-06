import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { BidAssessmentQuestionType, Prisma } from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { BidAssessmentQuestionsService } from './bid-assessment-questions.service';

describe('BidAssessmentQuestionsService', () => {
  let service: BidAssessmentQuestionsService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      bidAssessmentQuestion: {
        create: jest.fn().mockImplementation(({ data }: any) => ({
          id: 'q1',
          options: data.options === Prisma.JsonNull ? null : data.options,
          displayOrder: data.displayOrder,
          isActive: data.isActive,
          text: data.text,
          type: data.type,
          createdAt: new Date(),
          updatedAt: new Date(),
        })),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BidAssessmentQuestionsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(BidAssessmentQuestionsService);
  });

  it('requires options for a SELECT question', async () => {
    await expect(
      service.create({
        text: 'Competitive situation?',
        type: BidAssessmentQuestionType.SELECT,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects options on a non-SELECT question', async () => {
    await expect(
      service.create({
        text: 'Budget confirmed?',
        type: BidAssessmentQuestionType.BOOLEAN,
        options: ['yes', 'no'],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('stores options for a valid SELECT question', async () => {
    const result = await service.create({
      text: 'Competitive situation?',
      type: BidAssessmentQuestionType.SELECT,
      options: ['Sole vendor', 'Crowded'],
    });
    expect(result.options).toEqual(['Sole vendor', 'Crowded']);
  });

  it('defaults active-only listing but supports includeInactive', async () => {
    prisma.bidAssessmentQuestion.findMany.mockResolvedValue([]);
    await service.findAll();
    expect(
      prisma.bidAssessmentQuestion.findMany.mock.calls[0][0].where,
    ).toEqual({ isActive: true });
    await service.findAll(true);
    expect(
      prisma.bidAssessmentQuestion.findMany.mock.calls[1][0].where,
    ).toEqual({});
  });
});
