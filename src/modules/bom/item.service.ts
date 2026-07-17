import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { BomAccessService } from './bom-access.service';
import { CreateItemDto, UpdateItemDto } from './dto/bom.dto';
import { ItemEntity } from './entities/bom.entity';

type ItemRow = Prisma.ItemGetPayload<Record<string, never>>;

/**
 * Item Master. BOM lines and stock records reference items here rather than
 * free-text names. Items are never hard-deleted when referenced — set
 * isActive=false instead (enforced in remove()).
 */
@Injectable()
export class ItemService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: BomAccessService,
  ) {}

  async list(
    user: AuthenticatedUser,
    opts: { search?: string; activeOnly?: boolean } = {},
  ): Promise<ItemEntity[]> {
    await this.access.assertCanReadItems(user);
    const where: Prisma.ItemWhereInput = {};
    if (opts.activeOnly) where.isActive = true;
    if (opts.search) {
      where.OR = [
        { itemCode: { contains: opts.search, mode: 'insensitive' } },
        { name: { contains: opts.search, mode: 'insensitive' } },
      ];
    }
    const rows = await this.prisma.item.findMany({
      where,
      orderBy: { itemCode: 'asc' },
    });
    return rows.map((r) => this.toEntity(r));
  }

  async get(id: string, user: AuthenticatedUser): Promise<ItemEntity> {
    await this.access.assertCanReadItems(user);
    const row = await this.prisma.item.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Item not found');
    return this.toEntity(row);
  }

  async create(dto: CreateItemDto, user: AuthenticatedUser): Promise<ItemEntity> {
    await this.access.assertCanManageItems(user);
    const existing = await this.prisma.item.findUnique({
      where: { itemCode: dto.itemCode },
      select: { id: true },
    });
    if (existing) throw new ConflictException('An item with this code already exists');
    const row = await this.prisma.item.create({
      data: {
        itemCode: dto.itemCode,
        name: dto.name,
        description: dto.description ?? null,
        itemType: dto.itemType,
        baseUnitOfMeasure: dto.baseUnitOfMeasure,
        isActive: dto.isActive ?? true,
        defaultWastagePercent:
          dto.defaultWastagePercent != null
            ? new Prisma.Decimal(dto.defaultWastagePercent)
            : null,
        drawingSpecReference: dto.drawingSpecReference ?? null,
        standardLeadTimeDays: dto.standardLeadTimeDays ?? null,
      },
    });
    return this.toEntity(row);
  }

  async update(
    id: string,
    dto: UpdateItemDto,
    user: AuthenticatedUser,
  ): Promise<ItemEntity> {
    await this.access.assertCanManageItems(user);
    const existing = await this.prisma.item.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Item not found');

    const data: Prisma.ItemUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.itemType !== undefined) data.itemType = dto.itemType;
    if (dto.baseUnitOfMeasure !== undefined) data.baseUnitOfMeasure = dto.baseUnitOfMeasure;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    if (dto.defaultWastagePercent !== undefined) {
      data.defaultWastagePercent =
        dto.defaultWastagePercent === null
          ? null
          : new Prisma.Decimal(dto.defaultWastagePercent);
    }
    if (dto.drawingSpecReference !== undefined) {
      data.drawingSpecReference = dto.drawingSpecReference;
    }
    if (dto.standardLeadTimeDays !== undefined) {
      data.standardLeadTimeDays = dto.standardLeadTimeDays;
    }

    // If deactivating, that's always allowed; there is no hard-delete path.
    const row = await this.prisma.item.update({ where: { id }, data });
    return this.toEntity(row);
  }

  /**
   * There is no hard delete. This endpoint exists only to make the "never
   * hard-delete a referenced item" rule explicit: it flips isActive=false, and
   * refuses (400) rather than deleting.
   */
  async deactivate(id: string, user: AuthenticatedUser): Promise<ItemEntity> {
    await this.access.assertCanManageItems(user);
    const existing = await this.prisma.item.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Item not found');
    if (!existing.isActive) {
      throw new BadRequestException('Item is already inactive');
    }
    const row = await this.prisma.item.update({
      where: { id },
      data: { isActive: false },
    });
    return this.toEntity(row);
  }

  private toEntity(r: ItemRow): ItemEntity {
    return new ItemEntity({
      id: r.id,
      itemCode: r.itemCode,
      name: r.name,
      description: r.description,
      itemType: r.itemType,
      baseUnitOfMeasure: r.baseUnitOfMeasure,
      isActive: r.isActive,
      defaultWastagePercent: r.defaultWastagePercent
        ? r.defaultWastagePercent.toString()
        : null,
      drawingSpecReference: r.drawingSpecReference,
      standardLeadTimeDays: r.standardLeadTimeDays,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    });
  }
}
