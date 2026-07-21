import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { LeadStatus, Prisma, Role } from '@prisma/client';
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
import { LeadAttachmentEntity } from './entities/lead-attachment.entity';
import { OpportunityEntity } from './entities/opportunity.entity';
import { AttachLeadFileDto } from './dto/attach-lead-file.dto';
import {
  SalesAccessService,
  isSuperAdmin,
} from './common/sales-access.service';
import { SalesNumberingService } from './common/sales-numbering.service';

type LeadWithCreator = Prisma.LeadGetPayload<{
  include: {
    enquiryCreator: { select: { firstName: true; lastName: true } };
    owner: { select: { firstName: true; lastName: true } };
    businessUnit: { select: { name: true; colorHex: true } };
  };
}>;

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
          enquiryCreatorId: user.id,
          businessUnitId: dto.businessUnitId,
        },
        include: {
          enquiryCreator: { select: { firstName: true, lastName: true } },
          owner: { select: { firstName: true, lastName: true } },
          businessUnit: { select: { name: true, colorHex: true } },
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
        include: {
          enquiryCreator: { select: { firstName: true, lastName: true } },
          owner: { select: { firstName: true, lastName: true } },
          businessUnit: { select: { name: true, colorHex: true } },
        },
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
        businessUnitId: dto.businessUnitId,
        priority: dto.priority,
        source: dto.source,
        status: dto.status,
        disqualifiedReason:
          dto.status === LeadStatus.DISQUALIFIED
            ? dto.disqualifiedReason
            : dto.disqualifiedReason,
      },
      include: {
        enquiryCreator: { select: { firstName: true, lastName: true } },
        owner: { select: { firstName: true, lastName: true } },
        businessUnit: { select: { name: true, colorHex: true } },
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
          enquiryCreatorId: lead.enquiryCreatorId,
          businessUnitId: lead.businessUnitId,
        },
        include: {
          enquiryCreator: { select: { firstName: true, lastName: true } },
          owner: { select: { firstName: true, lastName: true } },
          businessUnit: { select: { name: true, colorHex: true } },
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

  // ── Attachments ─────────────────────────────────────────────────────

  /**
   * The Sales "Lead Attachments" DEFAULT folder (VERTICAL-scoped) that lead
   * files live in — resolved by name so the frontend can target it for the
   * Vault upload. Any Sales-vertical user can read it, matching lead-read
   * access. Returns just the id.
   */
  async attachmentsFolderId(user: AuthenticatedUser): Promise<{ folderId: string }> {
    await this.access.assertSalesAccess(user);
    const folder = await this.prisma.vaultFolder.findFirst({
      where: { name: 'Lead Attachments', type: 'DEFAULT' },
      select: { id: true },
    });
    if (!folder) {
      throw new NotFoundException(
        'The "Lead Attachments" folder is not provisioned — run the seed.',
      );
    }
    return { folderId: folder.id };
  }

  /** ACTIVE attachments on a lead — any Sales-vertical user (read scope). */
  async listAttachments(
    leadId: string,
    user: AuthenticatedUser,
  ): Promise<LeadAttachmentEntity[]> {
    await this.access.assertSalesAccess(user);
    await this.findRawOrThrow(leadId);
    const rows = await this.prisma.leadAttachment.findMany({
      where: { leadId },
      orderBy: { createdAt: 'desc' },
      include: {
        uploadedBy: { select: { firstName: true, lastName: true } },
        vaultFile: { select: { name: true, currentVersionId: true } },
      },
    });
    const versions = await this.loadVersions(
      rows.map((r) => r.vaultFile.currentVersionId),
    );
    return rows.map((r) => this.toAttachmentEntity(r, versions));
  }

  /**
   * Batch-load the file-version metadata (mime/size/preview) for a set of
   * currentVersionIds. VaultFile has no relation back to its current version
   * (deliberate, to avoid an FK cycle — see schema), so we resolve it here.
   */
  private async loadVersions(
    ids: (string | null)[],
  ): Promise<
    Map<
      string,
      {
        mimeType: string;
        sizeBytes: bigint;
        previewStatus: import('@prisma/client').PreviewStatus;
      }
    >
  > {
    const present = ids.filter((x): x is string => !!x);
    if (present.length === 0) return new Map();
    const versions = await this.prisma.vaultFileVersion.findMany({
      where: { id: { in: present } },
      select: { id: true, mimeType: true, sizeBytes: true, previewStatus: true },
    });
    return new Map(versions.map((v) => [v.id, v]));
  }

  /**
   * Link a confirmed VaultFile to a lead (write-scoped to the lead's owner).
   * The browser uploads the file through the Vault flow first; here we just
   * validate it exists + is ACTIVE, isn't already linked, and record it.
   */
  async attachFile(
    leadId: string,
    dto: AttachLeadFileDto,
    user: AuthenticatedUser,
  ): Promise<LeadAttachmentEntity> {
    await this.access.assertSalesAccess(user);
    const lead = await this.findRawOrThrow(leadId);
    await this.access.assertCanAccessOwned(user, lead.ownerId);

    const file = await this.prisma.vaultFile.findUnique({
      where: { id: dto.vaultFileId },
      select: { id: true, status: true },
    });
    if (!file || file.status !== 'ACTIVE') {
      throw new BadRequestException(
        'File not found or its upload has not been confirmed',
      );
    }
    const existing = await this.prisma.leadAttachment.findFirst({
      where: { leadId, vaultFileId: dto.vaultFileId },
      select: { id: true },
    });
    if (existing) {
      throw new BadRequestException('That file is already attached to this lead');
    }

    const created = await this.prisma.leadAttachment.create({
      data: { leadId, vaultFileId: dto.vaultFileId, uploadedById: user.id },
      include: {
        uploadedBy: { select: { firstName: true, lastName: true } },
        vaultFile: { select: { name: true, currentVersionId: true } },
      },
    });
    const versions = await this.loadVersions([created.vaultFile.currentVersionId]);
    return this.toAttachmentEntity(created, versions);
  }

  /**
   * Unlink an attachment from a lead (owner-scoped). Removes only the link row;
   * the VaultFile itself is left in the Vault (deleting it is a Vault concern).
   */
  async removeAttachment(
    leadId: string,
    attachmentId: string,
    user: AuthenticatedUser,
  ): Promise<void> {
    await this.access.assertSalesAccess(user);
    const lead = await this.findRawOrThrow(leadId);
    await this.access.assertCanAccessOwned(user, lead.ownerId);
    const row = await this.prisma.leadAttachment.findUnique({
      where: { id: attachmentId },
      select: { id: true, leadId: true },
    });
    if (!row || row.leadId !== leadId) {
      throw new NotFoundException('Attachment not found');
    }
    await this.prisma.leadAttachment.delete({ where: { id: attachmentId } });
  }

  private toAttachmentEntity(
    row: {
      id: string;
      leadId: string;
      vaultFileId: string;
      uploadedById: string;
      createdAt: Date;
      uploadedBy: { firstName: string; lastName: string } | null;
      vaultFile: { name: string; currentVersionId: string | null };
    },
    versions: Map<
      string,
      {
        mimeType: string;
        sizeBytes: bigint;
        previewStatus: import('@prisma/client').PreviewStatus;
      }
    >,
  ): LeadAttachmentEntity {
    const v = row.vaultFile.currentVersionId
      ? versions.get(row.vaultFile.currentVersionId)
      : undefined;
    return new LeadAttachmentEntity({
      id: row.id,
      leadId: row.leadId,
      vaultFileId: row.vaultFileId,
      fileName: row.vaultFile.name,
      mimeType: v?.mimeType ?? null,
      sizeBytes: v ? v.sizeBytes.toString() : null,
      previewStatus: v?.previewStatus ?? null,
      uploadedById: row.uploadedById,
      uploadedByName: row.uploadedBy
        ? `${row.uploadedBy.firstName} ${row.uploadedBy.lastName}`
        : null,
      createdAt: row.createdAt.toISOString(),
    });
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

  private async findRawOrThrow(id: string): Promise<LeadWithCreator> {
    const lead = await this.prisma.lead.findUnique({
      where: { id },
      include: {
        enquiryCreator: { select: { firstName: true, lastName: true } },
        owner: { select: { firstName: true, lastName: true } },
        businessUnit: { select: { name: true, colorHex: true } },
      },
    });
    if (!lead) {
      throw new NotFoundException('Lead not found');
    }
    return lead;
  }

  private toEntity(lead: LeadWithCreator): LeadEntity {
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
      ownerName:
        `${lead.owner.firstName} ${lead.owner.lastName}`.trim(),
      enquiryCreatorId: lead.enquiryCreatorId,
      enquiryCreatorName:
        `${lead.enquiryCreator.firstName} ${lead.enquiryCreator.lastName}`.trim(),
      businessUnitId: lead.businessUnitId,
      businessUnitName: lead.businessUnit?.name ?? '',
      businessUnitColorHex: lead.businessUnit?.colorHex ?? '#64748B',
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
    owner: { firstName: string; lastName: string };
    enquiryCreatorId: string;
    enquiryCreator: { firstName: string; lastName: string };
    businessUnitId: string;
    businessUnit: { name: string; colorHex: string };
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
      ownerName: `${o.owner.firstName} ${o.owner.lastName}`.trim(),
      enquiryCreatorId: o.enquiryCreatorId,
      enquiryCreatorName:
        `${o.enquiryCreator.firstName} ${o.enquiryCreator.lastName}`.trim(),
      businessUnitId: o.businessUnitId,
      businessUnitName: o.businessUnit?.name ?? '',
      businessUnitColorHex: o.businessUnit?.colorHex ?? '#64748B',
      lostReason: o.lostReason,
      createdAt: o.createdAt,
      updatedAt: o.updatedAt,
    });
  }
}
