import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Lead, LeadStatus, Prisma, Role } from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import {
  PaginatedResult,
  PaginationQueryDto,
} from '../../common/dto/pagination.dto';
import { CreateLeadDto } from './dto/create-lead.dto';
import { UpdateLeadDto } from './dto/update-lead.dto';
import { ConvertLeadDto } from './dto/convert-lead.dto';
import { LeadEntity } from './entities/lead.entity';
import { OpportunityEntity } from './entities/opportunity.entity';
import {
  SalesAccessService,
  isSuperAdmin,
} from './common/sales-access.service';
import { SalesNumberingService } from './common/sales-numbering.service';

@Injectable()
export class LeadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: SalesAccessService,
    private readonly numbering: SalesNumberingService,
  ) {}

  async create(
    dto: CreateLeadDto,
    user: AuthenticatedUser,
  ): Promise<LeadEntity> {
    await this.access.assertSalesAccess(user);
    const ownerId = await this.resolveOwnerId(dto.ownerId, user);

    const created = await this.prisma.$transaction(async (tx) => {
      const leadNumber = await this.numbering.nextNumber(
        'LD',
        'lead',
        new Date().getUTCFullYear(),
        tx,
      );
      return tx.lead.create({
        data: {
          leadNumber,
          companyName: dto.companyName,
          contactName: dto.contactName,
          email: dto.email ?? null,
          phone: dto.phone ?? null,
          requirement: dto.requirement,
          priority: dto.priority ?? undefined,
          source: dto.source ?? undefined,
          ownerId,
        },
      });
    });
    return this.toEntity(created);
  }

  async findAll(
    query: PaginationQueryDto,
    user: AuthenticatedUser,
  ): Promise<PaginatedResult<LeadEntity>> {
    await this.access.assertSalesAccess(user);
    // Vertical-wide read: any Sales-vertical staff may view all Leads. The
    // module gate above already restricts who reaches this endpoint; no
    // per-owner filter on reads (writes remain owner-scoped).
    const where: Prisma.LeadWhereInput = {};

    const [items, total] = await this.prisma.$transaction([
      this.prisma.lead.findMany({
        where,
        skip: query.skip,
        take: query.limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.lead.count({ where }),
    ]);
    return {
      items: items.map((l) => this.toEntity(l)),
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  async findOne(id: string, user: AuthenticatedUser): Promise<LeadEntity> {
    await this.access.assertSalesAccess(user);
    // Vertical-wide read — any Sales-vertical staff may view any Lead.
    const lead = await this.findRawOrThrow(id);
    return this.toEntity(lead);
  }

  async update(
    id: string,
    dto: UpdateLeadDto,
    user: AuthenticatedUser,
  ): Promise<LeadEntity> {
    await this.access.assertSalesAccess(user);
    const lead = await this.findRawOrThrow(id);
    await this.access.assertCanAccessOwned(user, lead.ownerId);

    if (lead.status === LeadStatus.CONVERTED) {
      throw new BadRequestException('A converted lead can no longer be edited');
    }
    if (dto.status === LeadStatus.CONVERTED) {
      throw new BadRequestException(
        'Use POST /leads/:id/convert to convert a lead, not a status edit',
      );
    }
    if (dto.status === LeadStatus.DISQUALIFIED && !dto.disqualifiedReason) {
      throw new BadRequestException(
        'disqualifiedReason is required when disqualifying a lead',
      );
    }

    const updated = await this.prisma.lead.update({
      where: { id },
      data: {
        companyName: dto.companyName,
        contactName: dto.contactName,
        email: dto.email,
        phone: dto.phone,
        requirement: dto.requirement,
        priority: dto.priority,
        source: dto.source,
        status: dto.status,
        disqualifiedReason:
          dto.status === LeadStatus.DISQUALIFIED
            ? dto.disqualifiedReason
            : dto.disqualifiedReason,
      },
    });
    return this.toEntity(updated);
  }

  /**
   * Convert a QUALIFIED lead into an Opportunity. Creates a Customer from
   * the lead's company when no customerId is supplied. All writes happen in
   * one transaction so a partial conversion can't leave a lead marked
   * CONVERTED with no opportunity.
   */
  async convert(
    id: string,
    dto: ConvertLeadDto,
    user: AuthenticatedUser,
  ): Promise<OpportunityEntity> {
    await this.access.assertSalesAccess(user);
    const lead = await this.findRawOrThrow(id);
    await this.access.assertCanAccessOwned(user, lead.ownerId);

    if (lead.status === LeadStatus.CONVERTED) {
      throw new BadRequestException('Lead has already been converted');
    }
    if (lead.status === LeadStatus.DISQUALIFIED) {
      throw new BadRequestException('A disqualified lead cannot be converted');
    }
    if (lead.status !== LeadStatus.QUALIFIED) {
      throw new BadRequestException(
        'Only a QUALIFIED lead can be converted to an opportunity',
      );
    }

    if (dto.customerId) {
      const customer = await this.prisma.customer.findUnique({
        where: { id: dto.customerId },
      });
      if (!customer) {
        throw new NotFoundException('customerId does not reference a customer');
      }
    } else if (!dto.billingAddress) {
      throw new BadRequestException(
        'billingAddress is required when no existing customerId is provided',
      );
    }

    const opportunity = await this.prisma.$transaction(async (tx) => {
      const customerId =
        dto.customerId ??
        (
          await tx.customer.create({
            data: {
              name: lead.companyName,
              billingAddress: dto.billingAddress as Prisma.InputJsonValue,
              shippingAddress: dto.billingAddress as Prisma.InputJsonValue,
              ownerId: lead.ownerId,
              contacts: {
                create: {
                  name: lead.contactName,
                  email: lead.email,
                  phone: lead.phone,
                  isPrimary: true,
                },
              },
            },
          })
        ).id;

      const created = await tx.opportunity.create({
        data: {
          leadId: lead.id,
          customerId,
          name: dto.opportunityName,
          estimatedValue: new Prisma.Decimal(dto.estimatedValue),
          expectedCloseDate: new Date(dto.expectedCloseDate),
          ownerId: lead.ownerId,
        },
      });

      await tx.lead.update({
        where: { id: lead.id },
        data: {
          status: LeadStatus.CONVERTED,
          convertedToOpportunityId: created.id,
        },
      });
      return created;
    });

    return this.toOpportunityEntity(opportunity);
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

  private async findRawOrThrow(id: string): Promise<Lead> {
    const lead = await this.prisma.lead.findUnique({ where: { id } });
    if (!lead) {
      throw new NotFoundException('Lead not found');
    }
    return lead;
  }

  private toEntity(lead: Lead): LeadEntity {
    return new LeadEntity({
      id: lead.id,
      leadNumber: lead.leadNumber,
      companyName: lead.companyName,
      contactName: lead.contactName,
      email: lead.email,
      phone: lead.phone,
      requirement: lead.requirement,
      priority: lead.priority,
      source: lead.source,
      status: lead.status,
      ownerId: lead.ownerId,
      disqualifiedReason: lead.disqualifiedReason,
      convertedToOpportunityId: lead.convertedToOpportunityId,
      createdAt: lead.createdAt,
      updatedAt: lead.updatedAt,
    });
  }

  private toOpportunityEntity(o: {
    id: string;
    leadId: string | null;
    customerId: string | null;
    name: string;
    stage: OpportunityEntity['stage'];
    estimatedValue: Prisma.Decimal;
    expectedCloseDate: Date;
    ownerId: string;
    lostReason: string | null;
    createdAt: Date;
    updatedAt: Date;
  }): OpportunityEntity {
    return new OpportunityEntity({
      id: o.id,
      leadId: o.leadId,
      customerId: o.customerId,
      name: o.name,
      stage: o.stage,
      estimatedValue: o.estimatedValue.toString(),
      expectedCloseDate: o.expectedCloseDate,
      ownerId: o.ownerId,
      lostReason: o.lostReason,
      createdAt: o.createdAt,
      updatedAt: o.updatedAt,
    });
  }
}
