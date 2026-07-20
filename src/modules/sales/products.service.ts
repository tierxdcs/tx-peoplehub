import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Product } from '@prisma/client';
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

/**
 * Product catalog is shared master data (not owner-scoped): any Sales-vertical
 * user may read it; create/edit is restricted to MANAGER and above at the
 * controller layer. All monetary values are Decimal, serialized to string.
 */
/** Shared include so every ProductEntity carries its BU name for list display. */
const PRODUCT_INCLUDE = {
  businessUnit: { select: { name: true, colorHex: true } },
} as const;

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: SalesAccessService,
  ) {}

  async create(
    dto: CreateProductDto,
    user: AuthenticatedUser,
  ): Promise<ProductEntity> {
    await this.access.assertSalesAccess(user);
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
      },
      include: PRODUCT_INCLUDE,
    });
    return this.toEntity(created);
  }

  async findAll(
    query: PaginationQueryDto,
    user: AuthenticatedUser,
  ): Promise<PaginatedResult<ProductEntity>> {
    await this.access.assertSalesAccess(user);
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
      items: items.map((p) => this.toEntity(p)),
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  async findOne(id: string, user: AuthenticatedUser): Promise<ProductEntity> {
    await this.access.assertSalesAccess(user);
    return this.toEntity(await this.findRawOrThrow(id));
  }

  async update(
    id: string,
    dto: UpdateProductDto,
    user: AuthenticatedUser,
  ): Promise<ProductEntity> {
    await this.access.assertSalesAccess(user);
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
      },
      include: PRODUCT_INCLUDE,
    });
    return this.toEntity(updated);
  }

  private async findRawOrThrow(
    id: string,
  ): Promise<Product & { businessUnit: { name: string; colorHex: string } | null }> {
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
    product: Product & {
      businessUnit?: { name: string; colorHex: string } | null;
    },
  ): ProductEntity {
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
      createdAt: product.createdAt,
      updatedAt: product.updatedAt,
    });
  }
}
