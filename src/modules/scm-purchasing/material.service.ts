import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MaterialIndentStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { SalesNumberingService } from '../sales/common/sales-numbering.service';
import { InventoryService } from '../bom/inventory.service';
import { GrnAccessService } from './grn-access.service';
import { CreateMaterialIndentDto } from './dto/material-indent.dto';
import { CreateMaterialIssueDto } from './dto/material-issue-note.dto';
import { MaterialIndentEntity } from './entities/material-indent.entity';
import { MaterialIssueNoteEntity } from './entities/material-issue-note.entity';

const INDENT_INCLUDE = {
  item: { select: { itemCode: true, name: true } },
  projectKickoff: { select: { projectName: true } },
  raisedBy: { select: { firstName: true, lastName: true } },
  issueNotes: {
    orderBy: { issuedAt: 'asc' as const },
    include: {
      item: { select: { itemCode: true, name: true } },
      storeLocation: { select: { name: true } },
      issuedBy: { select: { firstName: true, lastName: true } },
    },
  },
} satisfies Prisma.MaterialIndentInclude;

type IndentWithRelations = Prisma.MaterialIndentGetPayload<{
  include: typeof INDENT_INCLUDE;
}>;
type IssueNoteRow = IndentWithRelations['issueNotes'][number];

/**
 * Material Indent + Issue (Stores Phase 3). Production raises indents; Stores
 * issues against them. Each issue generates a reservation-aware STOCK_OUT via
 * InventoryService (the single availability implementation). Indent status is
 * DERIVED from cumulative issued vs requested — it is never stored on the row
 * as an independently-set value (the column exists only as a materialized cache
 * kept in sync on each issue, and reads always recompute for display).
 */
@Injectable()
export class MaterialService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: GrnAccessService,
    private readonly numbering: SalesNumberingService,
    private readonly inventory: InventoryService,
  ) {}

  // ── Indents ──────────────────────────────────────────────────────────
  async listIndents(
    user: AuthenticatedUser,
    opts: { status?: MaterialIndentStatus; projectKickoffId?: string } = {},
  ): Promise<MaterialIndentEntity[]> {
    void user; // company-wide read
    const where: Prisma.MaterialIndentWhereInput = {};
    if (opts.status) where.status = opts.status;
    if (opts.projectKickoffId) where.projectKickoffId = opts.projectKickoffId;
    const rows = await this.prisma.materialIndent.findMany({
      where,
      include: INDENT_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => this.toIndentEntity(r));
  }

  async getIndent(id: string): Promise<MaterialIndentEntity> {
    return this.toIndentEntity(await this.findIndentOrThrow(id));
  }

  async createIndent(
    dto: CreateMaterialIndentDto,
    user: AuthenticatedUser,
  ): Promise<MaterialIndentEntity> {
    await this.access.assertCanReceiveGoods(user); // Production-vertical/SA
    const requested = new Prisma.Decimal(dto.requestedQuantity);
    if (requested.lessThanOrEqualTo(0)) {
      throw new BadRequestException('Requested quantity must be positive');
    }

    const [item, kickoff] = await Promise.all([
      this.prisma.item.findUnique({
        where: { id: dto.itemId },
        select: { id: true, isActive: true },
      }),
      dto.projectKickoffId
        ? this.prisma.projectKickoff.findUnique({
            where: { id: dto.projectKickoffId },
            select: { id: true },
          })
        : Promise.resolve(null),
    ]);
    if (!item) throw new NotFoundException('Item not found');
    if (!item.isActive) throw new BadRequestException('Item is inactive');
    if (dto.projectKickoffId && !kickoff) {
      throw new NotFoundException('Project kickoff not found');
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const indentNumber = await this.numbering.nextNumber(
        'IND',
        'material_indent',
        new Date().getUTCFullYear(),
        tx,
      );
      return tx.materialIndent.create({
        data: {
          indentNumber,
          status: MaterialIndentStatus.OPEN,
          projectKickoffId: dto.projectKickoffId ?? null,
          itemId: dto.itemId,
          requestedQuantity: requested,
          requiredByDate: dto.requiredByDate
            ? new Date(dto.requiredByDate)
            : null,
          notes: dto.notes ?? null,
          raisedById: user.id,
        },
      });
    });
    return this.getIndent(created.id);
  }

  async cancelIndent(
    id: string,
    user: AuthenticatedUser,
  ): Promise<MaterialIndentEntity> {
    await this.access.assertCanReceiveGoods(user);
    const indent = await this.findIndentOrThrow(id);
    if (indent.issueNotes.length > 0) {
      throw new BadRequestException(
        'Cannot cancel an indent that already has issued material',
      );
    }
    if (indent.status === MaterialIndentStatus.CANCELLED) {
      throw new BadRequestException('Indent is already cancelled');
    }
    await this.prisma.materialIndent.update({
      where: { id },
      data: { status: MaterialIndentStatus.CANCELLED },
    });
    return this.getIndent(id);
  }

  // ── Issues ───────────────────────────────────────────────────────────
  async listIssues(
    user: AuthenticatedUser,
    opts: { materialIndentId?: string } = {},
  ): Promise<MaterialIssueNoteEntity[]> {
    void user; // company-wide read
    const where: Prisma.MaterialIssueNoteWhereInput = {};
    if (opts.materialIndentId) where.materialIndentId = opts.materialIndentId;
    const rows = await this.prisma.materialIssueNote.findMany({
      where,
      include: {
        item: { select: { itemCode: true, name: true } },
        storeLocation: { select: { name: true } },
        issuedBy: { select: { firstName: true, lastName: true } },
      },
      orderBy: { issuedAt: 'desc' },
    });
    return rows.map((r) => this.toIssueEntity(r));
  }

  /**
   * Issue material against an indent. Generates a reservation-aware STOCK_OUT
   * (reusing InventoryService), supports short issue, and re-derives the
   * indent's status from cumulative issued vs requested. All atomic.
   */
  async createIssue(
    dto: CreateMaterialIssueDto,
    user: AuthenticatedUser,
  ): Promise<MaterialIssueNoteEntity> {
    await this.access.assertCanReceiveGoods(user); // Production-vertical/SA
    const qty = new Prisma.Decimal(dto.issuedQuantity);
    if (qty.lessThanOrEqualTo(0)) {
      throw new BadRequestException('Issued quantity must be positive');
    }

    const indent = await this.findIndentOrThrow(dto.materialIndentId);
    if (indent.status === MaterialIndentStatus.CANCELLED) {
      throw new BadRequestException('Cannot issue against a cancelled indent');
    }
    if (indent.status === MaterialIndentStatus.FULLY_ISSUED) {
      throw new BadRequestException('Indent is already fully issued');
    }

    const alreadyIssued = this.sumIssued(indent.issueNotes);
    const outstanding = indent.requestedQuantity.minus(alreadyIssued);
    if (qty.greaterThan(outstanding)) {
      throw new BadRequestException(
        `Issue of ${qty} exceeds the outstanding indent quantity (${outstanding})`,
      );
    }

    const store = await this.prisma.storeLocation.findUnique({
      where: { id: dto.storeLocationId },
      select: { id: true },
    });
    if (!store) throw new NotFoundException('Store location not found');

    const created = await this.prisma.$transaction(async (tx) => {
      // Reservation-aware STOCK_OUT via the single shared implementation.
      await this.inventory.issueStockOutTx(tx, {
        itemId: indent.itemId,
        storeLocationId: dto.storeLocationId,
        quantity: qty,
        reason: `Material issue against indent ${indent.indentNumber}`,
        actorId: user.id,
        kickoffId: indent.projectKickoffId,
      });

      const minNumber = await this.numbering.nextNumber(
        'MIN',
        'material_issue_note',
        new Date().getUTCFullYear(),
        tx,
      );
      const note = await tx.materialIssueNote.create({
        data: {
          minNumber,
          materialIndentId: indent.id,
          itemId: indent.itemId,
          storeLocationId: dto.storeLocationId,
          issuedQuantity: qty,
          binLocation: dto.binLocation ?? null,
          notes: dto.notes ?? null,
          issuedById: user.id,
        },
      });

      // Re-derive the indent status from cumulative issued vs requested.
      const totalIssued = alreadyIssued.plus(qty);
      const derived = totalIssued.greaterThanOrEqualTo(indent.requestedQuantity)
        ? MaterialIndentStatus.FULLY_ISSUED
        : MaterialIndentStatus.PARTIALLY_ISSUED;
      await tx.materialIndent.update({
        where: { id: indent.id },
        data: { status: derived },
      });

      return note;
    });

    return this.getIssue(created.id);
  }

  async getIssue(id: string): Promise<MaterialIssueNoteEntity> {
    const row = await this.prisma.materialIssueNote.findUnique({
      where: { id },
      include: {
        item: { select: { itemCode: true, name: true } },
        storeLocation: { select: { name: true } },
        issuedBy: { select: { firstName: true, lastName: true } },
      },
    });
    if (!row) throw new NotFoundException('Material issue note not found');
    return this.toIssueEntity(row);
  }

  // ── Helpers ──────────────────────────────────────────────────────────
  private async findIndentOrThrow(id: string): Promise<IndentWithRelations> {
    const row = await this.prisma.materialIndent.findUnique({
      where: { id },
      include: INDENT_INCLUDE,
    });
    if (!row) throw new NotFoundException('Material indent not found');
    return row;
  }

  private sumIssued(notes: { issuedQuantity: Prisma.Decimal }[]): Prisma.Decimal {
    return notes.reduce(
      (s, n) => s.plus(n.issuedQuantity),
      new Prisma.Decimal(0),
    );
  }

  /**
   * Status derived from issue history (not read off the row). CANCELLED is a
   * terminal administrative state and takes precedence.
   */
  private deriveStatus(
    indent: IndentWithRelations,
    issued: Prisma.Decimal,
  ): MaterialIndentStatus {
    if (indent.status === MaterialIndentStatus.CANCELLED) {
      return MaterialIndentStatus.CANCELLED;
    }
    if (issued.lessThanOrEqualTo(0)) return MaterialIndentStatus.OPEN;
    if (issued.greaterThanOrEqualTo(indent.requestedQuantity)) {
      return MaterialIndentStatus.FULLY_ISSUED;
    }
    return MaterialIndentStatus.PARTIALLY_ISSUED;
  }

  private toIndentEntity(indent: IndentWithRelations): MaterialIndentEntity {
    const issued = this.sumIssued(indent.issueNotes);
    const outstanding = Prisma.Decimal.max(
      indent.requestedQuantity.minus(issued),
      new Prisma.Decimal(0),
    );
    return new MaterialIndentEntity({
      id: indent.id,
      indentNumber: indent.indentNumber,
      status: this.deriveStatus(indent, issued),
      projectKickoffId: indent.projectKickoffId,
      projectName: indent.projectKickoff?.projectName ?? null,
      itemId: indent.itemId,
      itemCode: indent.item?.itemCode ?? null,
      itemName: indent.item?.name ?? null,
      requestedQuantity: indent.requestedQuantity.toString(),
      issuedQuantity: issued.toString(),
      outstandingQuantity: outstanding.toString(),
      requiredByDate: indent.requiredByDate
        ? indent.requiredByDate.toISOString()
        : null,
      notes: indent.notes,
      raisedById: indent.raisedById,
      raisedByName: indent.raisedBy
        ? `${indent.raisedBy.firstName} ${indent.raisedBy.lastName}`.trim()
        : null,
      issueNotes: indent.issueNotes.map((n) => this.toIssueEntity(n)),
      createdAt: indent.createdAt.toISOString(),
      updatedAt: indent.updatedAt.toISOString(),
    });
  }

  private toIssueEntity(n: IssueNoteRow): MaterialIssueNoteEntity {
    return new MaterialIssueNoteEntity({
      id: n.id,
      minNumber: n.minNumber,
      materialIndentId: n.materialIndentId,
      itemId: n.itemId,
      itemCode: n.item?.itemCode ?? null,
      itemName: n.item?.name ?? null,
      storeLocationId: n.storeLocationId,
      storeLocationName: n.storeLocation?.name ?? null,
      issuedQuantity: n.issuedQuantity.toString(),
      binLocation: n.binLocation,
      notes: n.notes,
      issuedById: n.issuedById,
      issuedByName: n.issuedBy
        ? `${n.issuedBy.firstName} ${n.issuedBy.lastName}`.trim()
        : null,
      issuedAt: n.issuedAt.toISOString(),
      createdAt: n.createdAt.toISOString(),
    });
  }
}
