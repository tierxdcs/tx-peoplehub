import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  NonConformanceReportStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { GrnAccessService } from './grn-access.service';
import { DispositionNcrDto } from './dto/non-conformance-report.dto';
import { NonConformanceReportEntity } from './entities/non-conformance-report.entity';

const NCR_INCLUDE = {
  item: { select: { itemCode: true, name: true } },
  grn: { select: { grnNumber: true } },
  raisedBy: { select: { firstName: true, lastName: true } },
  dispositionedBy: { select: { firstName: true, lastName: true } },
} satisfies Prisma.NonConformanceReportInclude;

type NcrWithRelations = Prisma.NonConformanceReportGetPayload<{
  include: typeof NCR_INCLUDE;
}>;

/**
 * Non-Conformance Reports (Stores Phase 2). NCRs are created automatically by
 * the QC gate; this service handles reads and the disposition workflow. Never
 * touches stock — the rejected quantity never entered stock.
 */
@Injectable()
export class NonConformanceReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: GrnAccessService,
  ) {}

  async list(
    user: AuthenticatedUser,
    opts: { status?: NonConformanceReportStatus; grnId?: string } = {},
  ): Promise<NonConformanceReportEntity[]> {
    void user; // company-wide read
    const where: Prisma.NonConformanceReportWhereInput = {};
    if (opts.status) where.status = opts.status;
    if (opts.grnId) where.grnId = opts.grnId;
    const rows = await this.prisma.nonConformanceReport.findMany({
      where,
      include: NCR_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => this.toEntity(r));
  }

  async get(id: string): Promise<NonConformanceReportEntity> {
    const row = await this.prisma.nonConformanceReport.findUnique({
      where: { id },
      include: NCR_INCLUDE,
    });
    if (!row) throw new NotFoundException('Non-conformance report not found');
    return this.toEntity(row);
  }

  /** OPEN → DISPOSITIONED. QC Inspector / Production Manager+ / SA. */
  async disposition(
    id: string,
    dto: DispositionNcrDto,
    user: AuthenticatedUser,
  ): Promise<NonConformanceReportEntity> {
    await this.access.assertCanDispositionNcr(user);
    const ncr = await this.prisma.nonConformanceReport.findUnique({
      where: { id },
    });
    if (!ncr) throw new NotFoundException('Non-conformance report not found');
    if (ncr.status !== NonConformanceReportStatus.OPEN) {
      throw new BadRequestException(
        `Only an OPEN non-conformance report can be dispositioned (current: ${ncr.status})`,
      );
    }
    await this.prisma.nonConformanceReport.update({
      where: { id },
      data: {
        status: NonConformanceReportStatus.DISPOSITIONED,
        disposition: dto.disposition,
        dispositionNotes: dto.dispositionNotes ?? null,
        dispositionedById: user.id,
        dispositionedAt: new Date(),
      },
    });
    return this.get(id);
  }

  /** DISPOSITIONED → CLOSED. QC Inspector / Production Manager+ / SA. */
  async close(
    id: string,
    user: AuthenticatedUser,
  ): Promise<NonConformanceReportEntity> {
    await this.access.assertCanDispositionNcr(user);
    const ncr = await this.prisma.nonConformanceReport.findUnique({
      where: { id },
    });
    if (!ncr) throw new NotFoundException('Non-conformance report not found');
    if (ncr.status !== NonConformanceReportStatus.DISPOSITIONED) {
      throw new BadRequestException(
        `Only a DISPOSITIONED non-conformance report can be closed (current: ${ncr.status})`,
      );
    }
    await this.prisma.nonConformanceReport.update({
      where: { id },
      data: { status: NonConformanceReportStatus.CLOSED },
    });
    return this.get(id);
  }

  private toEntity(n: NcrWithRelations): NonConformanceReportEntity {
    return new NonConformanceReportEntity({
      id: n.id,
      ncrNumber: n.ncrNumber,
      status: n.status,
      grnId: n.grnId,
      grnNumber: n.grn?.grnNumber ?? null,
      grnLineId: n.grnLineId,
      itemId: n.itemId,
      itemCode: n.item?.itemCode ?? null,
      itemName: n.item?.name ?? null,
      rejectedQuantity: n.rejectedQuantity.toString(),
      rejectionReason: n.rejectionReason,
      disposition: n.disposition,
      dispositionNotes: n.dispositionNotes,
      raisedById: n.raisedById,
      raisedByName: n.raisedBy
        ? `${n.raisedBy.firstName} ${n.raisedBy.lastName}`.trim()
        : null,
      dispositionedById: n.dispositionedById,
      dispositionedByName: n.dispositionedBy
        ? `${n.dispositionedBy.firstName} ${n.dispositionedBy.lastName}`.trim()
        : null,
      dispositionedAt: n.dispositionedAt
        ? n.dispositionedAt.toISOString()
        : null,
      createdAt: n.createdAt.toISOString(),
      updatedAt: n.updatedAt.toISOString(),
    });
  }
}
