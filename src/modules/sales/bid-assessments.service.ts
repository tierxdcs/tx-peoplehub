import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  BidAssessmentStatus,
  BidDecisionAssessment,
  BidAssessmentResponse,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import {
  PaginatedResult,
  PaginationQueryDto,
} from '../../common/dto/pagination.dto';
import { SubmitBidAssessmentDto } from './dto/submit-bid-assessment.dto';
import { ReviewBidAssessmentDto } from './dto/review-bid-assessment.dto';
import {
  BidAssessmentResponseEntity,
  BidDecisionAssessmentEntity,
} from './entities/bid-assessment.entity';
import {
  SalesAccessService,
  isSuperAdmin,
} from './common/sales-access.service';

type AssessmentWithResponses = BidDecisionAssessment & {
  responses: BidAssessmentResponse[];
};

/**
 * Bid/No-Bid decision gate. A Sales rep submits a questionnaire for an
 * Opportunity; the designated Sales Head (or SUPER_ADMIN, both as fallback
 * when no head is designated and as a standing override) approves/rejects.
 * Only the most-recent assessment per Opportunity gates Bid creation
 * (BidsService reads `latestApprovedFor`).
 */
@Injectable()
export class BidAssessmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: SalesAccessService,
  ) {}

  /**
   * Submit a new assessment for an Opportunity. Owner-scoped (same write rule
   * as editing the Opportunity). Snapshots each active question's current
   * text onto its response, so later wording edits never rewrite history. A
   * fresh row every time — resubmitting after a rejection does not reopen the
   * old record.
   */
  async submit(
    opportunityId: string,
    dto: SubmitBidAssessmentDto,
    user: AuthenticatedUser,
  ): Promise<BidDecisionAssessmentEntity> {
    await this.access.assertSalesAccess(user);

    const opportunity = await this.prisma.opportunity.findUnique({
      where: { id: opportunityId },
    });
    if (!opportunity) {
      throw new NotFoundException('Opportunity not found');
    }
    // Submitting is a write against the opportunity — owner/hierarchy scope.
    await this.access.assertCanAccessOwned(user, opportunity.ownerId);

    // Block a duplicate while one is already awaiting review — the rep should
    // wait for the decision (or it should be reviewed) rather than stacking
    // pending submissions.
    const pending = await this.prisma.bidDecisionAssessment.findFirst({
      where: { opportunityId, status: BidAssessmentStatus.PENDING_REVIEW },
    });
    if (pending) {
      throw new BadRequestException(
        'An assessment for this opportunity is already awaiting review',
      );
    }

    const activeQuestions = await this.prisma.bidAssessmentQuestion.findMany({
      where: { isActive: true },
      orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
    });
    if (activeQuestions.length === 0) {
      throw new BadRequestException(
        'No active assessment questions are configured; ask an Admin to add some',
      );
    }

    // Every active question must be answered; reject unknown/inactive ids.
    const answerByQuestion = new Map(
      dto.answers.map((a) => [a.questionId, a.answerValue]),
    );
    const activeIds = new Set(activeQuestions.map((q) => q.id));
    const unknown = dto.answers.filter((a) => !activeIds.has(a.questionId));
    if (unknown.length > 0) {
      throw new BadRequestException(
        'One or more answers reference an unknown or inactive question',
      );
    }
    const unanswered = activeQuestions.filter(
      (q) => !answerByQuestion.has(q.id),
    );
    if (unanswered.length > 0) {
      throw new BadRequestException(
        `All active questions must be answered; missing ${unanswered.length} answer(s)`,
      );
    }

    const created = await this.prisma.bidDecisionAssessment.create({
      data: {
        opportunityId,
        submittedById: user.id,
        status: BidAssessmentStatus.PENDING_REVIEW,
        responses: {
          create: activeQuestions.map((q) => ({
            questionId: q.id,
            questionTextSnapshot: q.text,
            answerValue: answerByQuestion.get(q.id) as string,
          })),
        },
      },
      include: { responses: true },
    });
    return this.toEntity(created);
  }

  /**
   * Assessments awaiting the caller's review. The designated Sales Head sees
   * all PENDING_REVIEW assessments; SUPER_ADMIN always does (fallback +
   * override). Anyone else gets a 403 — this is a reviewer-only queue.
   */
  async findPendingApproval(
    query: PaginationQueryDto,
    user: AuthenticatedUser,
  ): Promise<PaginatedResult<BidDecisionAssessmentEntity>> {
    await this.assertCanReview(user);

    const where: Prisma.BidDecisionAssessmentWhereInput = {
      status: BidAssessmentStatus.PENDING_REVIEW,
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.bidDecisionAssessment.findMany({
        where,
        include: { responses: true },
        skip: query.skip,
        take: query.limit,
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.bidDecisionAssessment.count({ where }),
    ]);
    return {
      items: items.map((a) => this.toEntity(a)),
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  async findOne(
    id: string,
    user: AuthenticatedUser,
  ): Promise<BidDecisionAssessmentEntity> {
    await this.access.assertSalesAccess(user);
    const assessment = await this.findRawOrThrow(id);
    return this.toEntity(assessment);
  }

  /**
   * All assessments for an opportunity, most-recent first — the UI reads
   * [0] to derive the gate state (submit / pending / rejected+comments /
   * approved). Vertical-wide read: any Sales staff may view.
   */
  async findForOpportunity(
    opportunityId: string,
    user: AuthenticatedUser,
  ): Promise<BidDecisionAssessmentEntity[]> {
    await this.access.assertSalesAccess(user);
    const rows = await this.prisma.bidDecisionAssessment.findMany({
      where: { opportunityId },
      include: { responses: true },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((a) => this.toEntity(a));
  }

  async approve(
    id: string,
    dto: ReviewBidAssessmentDto,
    user: AuthenticatedUser,
  ): Promise<BidDecisionAssessmentEntity> {
    return this.review(id, BidAssessmentStatus.APPROVED, dto, user);
  }

  async reject(
    id: string,
    dto: ReviewBidAssessmentDto,
    user: AuthenticatedUser,
  ): Promise<BidDecisionAssessmentEntity> {
    if (!dto.reviewerComments || !dto.reviewerComments.trim()) {
      throw new BadRequestException(
        'reviewerComments are required when rejecting an assessment',
      );
    }
    return this.review(id, BidAssessmentStatus.REJECTED, dto, user);
  }

  private async review(
    id: string,
    decision:
      typeof BidAssessmentStatus.APPROVED | typeof BidAssessmentStatus.REJECTED,
    dto: ReviewBidAssessmentDto,
    user: AuthenticatedUser,
  ): Promise<BidDecisionAssessmentEntity> {
    await this.assertCanReview(user);
    const assessment = await this.findRawOrThrow(id);
    if (assessment.status !== BidAssessmentStatus.PENDING_REVIEW) {
      throw new BadRequestException(
        `Only a PENDING_REVIEW assessment can be reviewed (current status: ${assessment.status})`,
      );
    }

    const updated = await this.prisma.bidDecisionAssessment.update({
      where: { id },
      data: {
        status: decision,
        reviewedById: user.id,
        reviewedAt: new Date(),
        reviewerComments: dto.reviewerComments ?? null,
      },
      include: { responses: true },
    });
    return this.toEntity(updated);
  }

  /**
   * The gate BidsService calls: is the MOST RECENT assessment for this
   * opportunity APPROVED? A later PENDING/REJECTED submission supersedes an
   * older APPROVED one, so we look only at the newest row.
   */
  async latestApprovedFor(opportunityId: string): Promise<boolean> {
    const latest = await this.prisma.bidDecisionAssessment.findFirst({
      where: { opportunityId },
      orderBy: { createdAt: 'desc' },
    });
    return latest?.status === BidAssessmentStatus.APPROVED;
  }

  /**
   * A reviewer is the currently-designated Sales Head, or SUPER_ADMIN
   * (standing override, and the fallback when no head is designated). When
   * no Sales Head exists, routing falls through to SUPER_ADMIN so the
   * process is never fully blocked.
   */
  private async assertCanReview(user: AuthenticatedUser): Promise<void> {
    if (isSuperAdmin(user)) {
      return;
    }
    const me = await this.prisma.employee.findUnique({
      where: { id: user.id },
      select: { isSalesHead: true },
    });
    if (me?.isSalesHead) {
      return;
    }
    throw new ForbiddenException(
      'Only the designated Sales Head or a SUPER_ADMIN may review Bid/No-Bid assessments',
    );
  }

  private async findRawOrThrow(id: string): Promise<AssessmentWithResponses> {
    const assessment = await this.prisma.bidDecisionAssessment.findUnique({
      where: { id },
      include: { responses: true },
    });
    if (!assessment) {
      throw new NotFoundException('Bid assessment not found');
    }
    return assessment;
  }

  private toEntity(
    assessment: AssessmentWithResponses,
  ): BidDecisionAssessmentEntity {
    return new BidDecisionAssessmentEntity({
      id: assessment.id,
      opportunityId: assessment.opportunityId,
      submittedById: assessment.submittedById,
      status: assessment.status,
      reviewedById: assessment.reviewedById,
      reviewedAt: assessment.reviewedAt,
      reviewerComments: assessment.reviewerComments,
      responses: assessment.responses.map(
        (r) =>
          new BidAssessmentResponseEntity({
            id: r.id,
            questionId: r.questionId,
            questionTextSnapshot: r.questionTextSnapshot,
            answerValue: r.answerValue,
          }),
      ),
      createdAt: assessment.createdAt,
      updatedAt: assessment.updatedAt,
    });
  }
}
