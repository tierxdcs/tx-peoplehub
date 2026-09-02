import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';

export const PIPELINE_ENTRY_TYPES = [
  'leads',
  'opportunities',
  'bids',
  'orders',
  'bom-intakes',
] as const;

export type PipelineEntryType = (typeof PIPELINE_ENTRY_TYPES)[number];

@Injectable()
export class PipelineAdminDeleteService {
  constructor(private readonly prisma: PrismaService) {}

  async remove(type: PipelineEntryType, id: string) {
    try {
      switch (type) {
        case 'leads':
          await this.prisma.lead.delete({ where: { id } });
          break;
        case 'opportunities':
          await this.prisma.opportunity.delete({ where: { id } });
          break;
        case 'bids':
          await this.prisma.bid.delete({ where: { id } });
          break;
        case 'orders':
          await this.prisma.order.delete({ where: { id } });
          break;
        case 'bom-intakes':
          await this.prisma.customerBomIntake.delete({ where: { id } });
          break;
      }
      return { deleted: true };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        throw new NotFoundException('Sales pipeline entry not found');
      }
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2003'
      ) {
        throw new ConflictException(
          'This entry has protected downstream records and cannot be hard-deleted. Remove or reverse those dependent records first.',
        );
      }
      throw error;
    }
  }
}
