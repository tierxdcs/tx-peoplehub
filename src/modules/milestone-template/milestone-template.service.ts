import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OrderLineDeliveryType, Prisma } from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import {
  CreateMilestoneTemplateDto,
  UpdateMilestoneTemplateDto,
} from './dto/milestone-template.dto';

/**
 * Admin-managed standard-milestone catalogue, keyed by delivery flow type. The
 * kickoff milestone dropdown is built from these (union of the flow types on
 * the kickoff's order lines) — see ProjectKickoffService.milestoneTemplates.
 * Deactivation is soft (isActive=false): the row is retained but excluded from
 * the dropdown. Milestones store a free-text name, never a link to this row, so
 * editing/deactivating a template never changes milestones already created.
 */
@Injectable()
export class MilestoneTemplateService {
  constructor(private readonly prisma: PrismaService) {}

  /** All templates for admin management (both active and inactive), ordered. */
  list() {
    return this.prisma.milestoneTemplate.findMany({
      orderBy: [{ flowType: 'asc' }, { displayOrder: 'asc' }, { name: 'asc' }],
    });
  }

  async create(dto: CreateMilestoneTemplateDto) {
    const name = dto.name.trim();
    if (!name) throw new BadRequestException('Name is required');
    try {
      return await this.prisma.milestoneTemplate.create({
        data: {
          flowType: dto.flowType,
          name,
          displayOrder:
            dto.displayOrder ?? (await this.nextOrder(dto.flowType)),
        },
      });
    } catch (err) {
      throw this.rethrowDuplicate(err);
    }
  }

  async update(id: string, dto: UpdateMilestoneTemplateDto) {
    const current = await this.prisma.milestoneTemplate.findUnique({
      where: { id },
    });
    if (!current) throw new NotFoundException('Milestone template not found');
    const name = dto.name?.trim();
    if (dto.name !== undefined && !name)
      throw new BadRequestException('Name cannot be blank');
    try {
      return await this.prisma.milestoneTemplate.update({
        where: { id },
        data: {
          ...(name !== undefined ? { name } : {}),
          ...(dto.displayOrder !== undefined
            ? { displayOrder: dto.displayOrder }
            : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        },
      });
    } catch (err) {
      throw this.rethrowDuplicate(err);
    }
  }

  /** The next displayOrder for a flow type (max + 1, or 1 when empty). */
  private async nextOrder(flowType: OrderLineDeliveryType): Promise<number> {
    const last = await this.prisma.milestoneTemplate.findFirst({
      where: { flowType },
      orderBy: { displayOrder: 'desc' },
      select: { displayOrder: true },
    });
    return (last?.displayOrder ?? 0) + 1;
  }

  private rethrowDuplicate(err: unknown): Error {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002'
    ) {
      return new ConflictException(
        'A template with this name already exists for this flow type',
      );
    }
    return err as Error;
  }
}
