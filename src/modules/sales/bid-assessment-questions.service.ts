import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  BidAssessmentQuestion,
  BidAssessmentQuestionType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { CreateBidAssessmentQuestionDto } from './dto/create-bid-assessment-question.dto';
import { UpdateBidAssessmentQuestionDto } from './dto/update-bid-assessment-question.dto';
import { BidAssessmentQuestionEntity } from './entities/bid-assessment-question.entity';

/**
 * Admin CRUD for the configurable Bid/No-Bid questionnaire — same
 * extensible-table pattern as Vertical/LeaveType. Questions are deactivated
 * (isActive = false), never hard-deleted, so answered assessments keep a
 * valid questionId reference; the answer text itself is snapshotted onto
 * each response regardless.
 */
@Injectable()
export class BidAssessmentQuestionsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    dto: CreateBidAssessmentQuestionDto,
  ): Promise<BidAssessmentQuestionEntity> {
    this.validateOptions(dto.type, dto.options);

    const created = await this.prisma.bidAssessmentQuestion.create({
      data: {
        text: dto.text,
        type: dto.type,
        options: this.optionsForStorage(dto.type, dto.options),
        displayOrder: dto.displayOrder ?? 0,
        isActive: dto.isActive ?? true,
      },
    });
    return this.toEntity(created);
  }

  /**
   * List questions. By default returns only active ones ordered for display
   * (this is what a rep filling in the form sees); pass includeInactive to
   * get the full set for Admin management.
   */
  async findAll(
    includeInactive = false,
  ): Promise<BidAssessmentQuestionEntity[]> {
    const rows = await this.prisma.bidAssessmentQuestion.findMany({
      where: includeInactive ? {} : { isActive: true },
      orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map((r) => this.toEntity(r));
  }

  async update(
    id: string,
    dto: UpdateBidAssessmentQuestionDto,
  ): Promise<BidAssessmentQuestionEntity> {
    const existing = await this.findRawOrThrow(id);

    // Validate the resulting type/options combination (the type may be
    // changing in the same request).
    const nextType = dto.type ?? existing.type;
    const nextOptions =
      dto.options !== undefined
        ? dto.options
        : ((existing.options as string[] | null) ?? undefined);
    this.validateOptions(nextType, nextOptions ?? undefined);

    const updated = await this.prisma.bidAssessmentQuestion.update({
      where: { id },
      data: {
        text: dto.text,
        type: dto.type,
        options:
          dto.type !== undefined || dto.options !== undefined
            ? this.optionsForStorage(nextType, nextOptions ?? undefined)
            : undefined,
        displayOrder: dto.displayOrder,
        isActive: dto.isActive,
      },
    });
    return this.toEntity(updated);
  }

  /** SELECT requires a non-empty options array; other types must not carry options. */
  private validateOptions(
    type: BidAssessmentQuestionType,
    options?: string[],
  ): void {
    if (type === BidAssessmentQuestionType.SELECT) {
      if (!options || options.length === 0) {
        throw new BadRequestException(
          'A SELECT question requires a non-empty options array',
        );
      }
    } else if (options && options.length > 0) {
      throw new BadRequestException(
        `options are only valid for SELECT questions, not ${type}`,
      );
    }
  }

  private optionsForStorage(
    type: BidAssessmentQuestionType,
    options?: string[],
  ): Prisma.InputJsonValue | typeof Prisma.JsonNull {
    return type === BidAssessmentQuestionType.SELECT && options
      ? options
      : Prisma.JsonNull;
  }

  private async findRawOrThrow(id: string): Promise<BidAssessmentQuestion> {
    const question = await this.prisma.bidAssessmentQuestion.findUnique({
      where: { id },
    });
    if (!question) {
      throw new NotFoundException('Bid assessment question not found');
    }
    return question;
  }

  private toEntity(
    question: BidAssessmentQuestion,
  ): BidAssessmentQuestionEntity {
    return new BidAssessmentQuestionEntity({
      id: question.id,
      text: question.text,
      type: question.type,
      options: (question.options as string[] | null) ?? null,
      displayOrder: question.displayOrder,
      isActive: question.isActive,
      createdAt: question.createdAt,
      updatedAt: question.updatedAt,
    });
  }
}
