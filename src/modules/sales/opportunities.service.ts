import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OpportunityStage, Prisma, Role } from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import {
  PaginatedResult,
  PaginationQueryDto,
} from '../../common/dto/pagination.dto';
import { CreateOpportunityDto } from './dto/create-opportunity.dto';
import { UpdateOpportunityDto } from './dto/update-opportunity.dto';
import { OpportunityEntity } from './entities/opportunity.entity';
import {
  SalesAccessService,
  isSuperAdmin,
} from './common/sales-access.service';

type OpportunityWithCreator = Prisma.OpportunityGetPayload<{
  include: {
    enquiryCreator: { select: { firstName: true; lastName: true } };
    owner: { select: { firstName: true; lastName: true } };
    businessUnit: { select: { name: true; colorHex: true } };
  };
}>;

@Injectable()
export class OpportunitiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: SalesAccessService,
  ) {}

  async create(
    dto: CreateOpportunityDto,
    user: AuthenticatedUser,
  ): Promise<OpportunityEntity> {
    await this.access.assertSalesAccess(user);
    const ownerId = await this.resolveOwnerId(dto.ownerId, user);

    if (dto.customerId) {
      const customer = await this.prisma.customer.findUnique({
        where: { id: dto.customerId },
      });
      if (!customer) {
        throw new NotFoundException('customerId does not reference a customer');
      }
    }

    const created = await this.prisma.opportunity.create({
      data: {
        name: dto.name,
        estimatedValue: new Prisma.Decimal(dto.estimatedValue),
        expectedCloseDate: new Date(dto.expectedCloseDate),
        customerId: dto.customerId ?? null,
        ownerId,
        enquiryCreatorId: user.id,
        businessUnitId: dto.businessUnitId,
      },
      include: {
        enquiryCreator: { select: { firstName: true, lastName: true } },
        owner: { select: { firstName: true, lastName: true } },
        businessUnit: { select: { name: true, colorHex: true } },
      },
    });
    return this.toEntity(created);
  }

  async findAll(
    query: PaginationQueryDto,
    user: AuthenticatedUser,
  ): Promise<PaginatedResult<OpportunityEntity>> {
    await this.access.assertSalesAccess(user);
    // Vertical-wide read: any Sales-vertical staff may view all Opportunities.
    const where: Prisma.OpportunityWhereInput = {};

    const [items, total] = await this.prisma.$transaction([
      this.prisma.opportunity.findMany({
        where,
        include: {
          enquiryCreator: { select: { firstName: true, lastName: true } },
          owner: { select: { firstName: true, lastName: true } },
          businessUnit: { select: { name: true, colorHex: true } },
        },
        skip: query.skip,
        take: query.limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.opportunity.count({ where }),
    ]);
    return {
      items: items.map((o) => this.toEntity(o)),
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  async findOne(
    id: string,
    user: AuthenticatedUser,
  ): Promise<OpportunityEntity> {
    await this.access.assertSalesAccess(user);
    // Vertical-wide read — any Sales-vertical staff may view any Opportunity.
    const opp = await this.findRawOrThrow(id);
    return this.toEntity(opp);
  }

  async update(
    id: string,
    dto: UpdateOpportunityDto,
    user: AuthenticatedUser,
  ): Promise<OpportunityEntity> {
    await this.access.assertSalesAccess(user);
    const opp = await this.findRawOrThrow(id);
    await this.access.assertCanAccessOwned(user, opp.ownerId);

    if (dto.stage === OpportunityStage.CLOSED_LOST && !dto.lostReason) {
      throw new BadRequestException(
        'lostReason is required when moving an opportunity to CLOSED_LOST',
      );
    }
    if (dto.customerId) {
      const customer = await this.prisma.customer.findUnique({
        where: { id: dto.customerId },
      });
      if (!customer) {
        throw new NotFoundException('customerId does not reference a customer');
      }
    }

    const updated = await this.prisma.opportunity.update({
      where: { id },
      data: {
        name: dto.name,
        stage: dto.stage,
        estimatedValue:
          dto.estimatedValue !== undefined
            ? new Prisma.Decimal(dto.estimatedValue)
            : undefined,
        expectedCloseDate: dto.expectedCloseDate
          ? new Date(dto.expectedCloseDate)
          : undefined,
        customerId: dto.customerId,
        lostReason:
          dto.stage === OpportunityStage.CLOSED_LOST
            ? dto.lostReason
            : undefined,
      },
      include: {
        enquiryCreator: { select: { firstName: true, lastName: true } },
        owner: { select: { firstName: true, lastName: true } },
        businessUnit: { select: { name: true, colorHex: true } },
      },
    });
    return this.toEntity(updated);
  }

  private async resolveOwnerId(
    requestedOwnerId: string | undefined,
    user: AuthenticatedUser,
  ): Promise<string> {
    if (!requestedOwnerId || requestedOwnerId === user.id) {
      return user.id;
    }
    if (user.role !== Role.MANAGER && !isSuperAdmin(user)) {
      throw new ForbiddenException(
        'Only a Sales Manager or SUPER_ADMIN may assign a record to another owner',
      );
    }
    const owner = await this.prisma.employee.findUnique({
      where: { id: requestedOwnerId },
    });
    if (!owner) {
      throw new NotFoundException('Assigned owner not found');
    }
    return requestedOwnerId;
  }

  private async findRawOrThrow(id: string): Promise<OpportunityWithCreator> {
    const opp = await this.prisma.opportunity.findUnique({
      where: { id },
      include: {
        enquiryCreator: { select: { firstName: true, lastName: true } },
        owner: { select: { firstName: true, lastName: true } },
        businessUnit: { select: { name: true, colorHex: true } },
      },
    });
    if (!opp) {
      throw new NotFoundException('Opportunity not found');
    }
    return opp;
  }

  private toEntity(o: OpportunityWithCreator): OpportunityEntity {
    return new OpportunityEntity({
      id: o.id,
      leadId: o.leadId,
      customerId: o.customerId,
      name: o.name,
      stage: o.stage,
      estimatedValue: o.estimatedValue.toString(),
      expectedCloseDate: o.expectedCloseDate,
      ownerId: o.ownerId,
      enquiryCreatorId: o.enquiryCreatorId,
      enquiryCreatorName:
        `${o.enquiryCreator.firstName} ${o.enquiryCreator.lastName}`.trim(),
      ownerName: `${o.owner.firstName} ${o.owner.lastName}`.trim(),
      businessUnitId: o.businessUnitId,
      businessUnitName: o.businessUnit.name,
      businessUnitColorHex: o.businessUnit.colorHex,
      lostReason: o.lostReason,
      createdAt: o.createdAt,
      updatedAt: o.updatedAt,
    });
  }
}
