import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import {
  PaginatedResult,
  PaginationQueryDto,
} from '../../common/dto/pagination.dto';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ProductEntity } from './entities/product.entity';
import { SalesAccessService } from './common/sales-access.service';
import { FinanceAccessService } from '../finance/finance-access.service';
import { actualMarginPercent, suggestedSellingPrice } from './product-margin';

/**
 * Product catalog is shared master data (not owner-scoped): any Sales-vertical
 * user may read it; create/edit is restricted to MANAGER and above at the
 * controller layer. All monetary values are Decimal, serialized to string.
 */
/** Shared include so every ProductEntity carries its BU name for list display. */
const PRODUCT_INCLUDE = {
  businessUnit: { select: { name: true, colorHex: true } },
  item: {
    select: {
      boms: {
        where: { status: 'RELEASED' as const },
        orderBy: { revisionNumber: 'desc' as const },
        take: 1,
        select: { rolledUpCostSnapshot: true, costSnapshotAt: true },
      },
    },
  },
} as const;

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: SalesAccessService,
    private readonly financeAccess: FinanceAccessService,
  ) {}

  async create(
    dto: CreateProductDto,
    user: AuthenticatedUser,
  ): Promise<ProductEntity> {
    await this.access.assertSalesAccess(user);
    if (
      dto.targetMarginPercent !== undefined &&
      user.role !== Role.SUPER_ADMIN
    ) {
      throw new ForbiddenException(
        'Only CEO/SuperAdmin or Finance may set target margin',
      );
    }
    const existing = await this.prisma.product.findUnique({
      where: { sku: dto.sku },
    });
    if (existing) {
      throw new ConflictException(
        `A product with SKU ${dto.sku} already exists`,
      );
    }
    if (dto.itemId) await this.assertItemExists(dto.itemId);
    await this.assertBusinessUnitAssignable(dto.businessUnitId);
    const created = await this.prisma.product.create({
      data: {
        sku: dto.sku,
        name: dto.name,
        description: dto.description ?? null,
        unitPrice: new Prisma.Decimal(dto.unitPrice),
        unitOfMeasure: dto.unitOfMeasure,
        hsnCode: dto.hsnCode ?? null,
        isActive: dto.isActive ?? true,
        itemId: dto.itemId ?? null,
        businessUnitId: dto.businessUnitId,
        autoAssignedBusinessUnit: dto.autoAssignedBusinessUnit ?? false,
        targetMarginPercent:
          dto.targetMarginPercent != null
            ? new Prisma.Decimal(dto.targetMarginPercent)
            : null,
      },
      include: PRODUCT_INCLUDE,
    });
    return this.toEntity(created, user.role === Role.SUPER_ADMIN);
  }

  async findAll(
    query: PaginationQueryDto,
    user: AuthenticatedUser,
  ): Promise<PaginatedResult<ProductEntity>> {
    const showCost = await this.canViewCost(user);
    if (!showCost) await this.access.assertSalesAccess(user);
    const [items, total] = await this.prisma.$transaction([
      this.prisma.product.findMany({
        skip: query.skip,
        take: query.limit,
        orderBy: { createdAt: 'desc' },
        include: PRODUCT_INCLUDE,
      }),
      this.prisma.product.count(),
    ]);
    return {
      items: items.map((p) => this.toEntity(p, showCost)),
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  async findOne(id: string, user: AuthenticatedUser): Promise<ProductEntity> {
    const showCost = await this.canViewCost(user);
    if (!showCost) await this.access.assertSalesAccess(user);
    return this.toEntity(await this.findRawOrThrow(id), showCost);
  }

  async update(
    id: string,
    dto: UpdateProductDto,
    user: AuthenticatedUser,
  ): Promise<ProductEntity> {
    const showCost = await this.canViewCost(user);
    const isSalesManager =
      user.role === Role.SUPER_ADMIN ||
      (user.role === Role.MANAGER && (await this.access.isSalesStaff(user)));
    if (!isSalesManager) {
      const keys = Object.keys(dto).filter(
        (key) => dto[key as keyof UpdateProductDto] !== undefined,
      );
      if (!showCost || keys.some((key) => key !== 'targetMarginPercent')) {
        throw new ForbiddenException(
          'Only Sales Managers may edit product data; Finance may update target margin only',
        );
      }
    }
    if (dto.targetMarginPercent !== undefined && !showCost) {
      throw new ForbiddenException(
        'Only CEO/SuperAdmin or Finance may set target margin',
      );
    }
    await this.findRawOrThrow(id);
    if (dto.itemId) await this.assertItemExists(dto.itemId);
    // A businessUnitId in the payload is a deliberate manual choice: validate it
    // (allowing an already-active unit) and clear the auto-assigned flag so
    // later name/description edits never overwrite this human decision.
    if (dto.businessUnitId !== undefined) {
      await this.assertBusinessUnitAssignable(dto.businessUnitId);
    }
    const updated = await this.prisma.product.update({
      where: { id },
      data: {
        name: dto.name,
        description: dto.description,
        unitPrice:
          dto.unitPrice !== undefined
            ? new Prisma.Decimal(dto.unitPrice)
            : undefined,
        unitOfMeasure: dto.unitOfMeasure,
        hsnCode: dto.hsnCode,
        isActive: dto.isActive,
        // Omit → unchanged; null → unlink; id → link (validated above).
        ...(dto.itemId !== undefined ? { itemId: dto.itemId } : {}),
        ...(dto.businessUnitId !== undefined
          ? {
              businessUnitId: dto.businessUnitId,
              autoAssignedBusinessUnit: false,
            }
          : {}),
        ...(dto.targetMarginPercent !== undefined
          ? {
              targetMarginPercent:
                dto.targetMarginPercent === null
                  ? null
                  : new Prisma.Decimal(dto.targetMarginPercent),
            }
          : {}),
      },
      include: PRODUCT_INCLUDE,
    });
    return this.toEntity(updated, showCost);
  }

  private async findRawOrThrow(
    id: string,
  ): Promise<Prisma.ProductGetPayload<{ include: typeof PRODUCT_INCLUDE }>> {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: PRODUCT_INCLUDE,
    });
    if (!product) {
      throw new NotFoundException('Product not found');
    }
    return product;
  }

  /** Validate a linked Item Master item exists (BOMs are keyed on Item). */
  private async assertItemExists(itemId: string): Promise<void> {
    const item = await this.prisma.item.findUnique({
      where: { id: itemId },
      select: { id: true },
    });
    if (!item) {
      throw new NotFoundException('Linked item not found in the Item Master');
    }
  }

  /**
   * Validate a business unit exists and is active before assigning it. A
   * deactivated unit is rejected for new assignments (it's hidden from the
   * dropdown) — products already tagged with it keep it, since those aren't
   * re-validated here.
   */
  private async assertBusinessUnitAssignable(id: string): Promise<void> {
    const bu = await this.prisma.businessUnit.findUnique({
      where: { id },
      select: { isActive: true },
    });
    if (!bu) throw new NotFoundException('Business unit not found');
    if (!bu.isActive) {
      throw new ConflictException(
        'That business unit is inactive and cannot be assigned',
      );
    }
  }

  private toEntity(
    product: Prisma.ProductGetPayload<{ include: typeof PRODUCT_INCLUDE }>,
    includeCost = false,
  ): ProductEntity {
    const snapshot = product.item?.boms[0]?.rolledUpCostSnapshot ?? null;
    const target = product.targetMarginPercent;
    const suggested = suggestedSellingPrice(snapshot, target);
    const actualMargin = actualMarginPercent(snapshot, product.unitPrice);
    return new ProductEntity({
      id: product.id,
      sku: product.sku,
      name: product.name,
      description: product.description,
      unitPrice: product.unitPrice.toString(),
      unitOfMeasure: product.unitOfMeasure,
      hsnCode: product.hsnCode,
      isActive: product.isActive,
      itemId: product.itemId,
      businessUnitId: product.businessUnitId,
      businessUnitName: product.businessUnit?.name ?? null,
      businessUnitColorHex: product.businessUnit?.colorHex ?? null,
      autoAssignedBusinessUnit: product.autoAssignedBusinessUnit,
      ...(includeCost
        ? {
            targetMarginPercent: target?.toString() ?? null,
            rolledUpCostSnapshot: snapshot?.toString() ?? null,
            costSnapshotAt: product.item?.boms[0]?.costSnapshotAt ?? null,
            suggestedUnitPrice: suggested?.toString() ?? null,
            actualMarginPercent: actualMargin?.toString() ?? null,
          }
        : {}),
      createdAt: product.createdAt,
      updatedAt: product.updatedAt,
    });
  }

  private async canViewCost(user: AuthenticatedUser): Promise<boolean> {
    if (user.role === Role.SUPER_ADMIN) return true;
    return (await this.financeAccess.accessFor(user)).isFinanceUser;
  }
}
