import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { PaginatedResult } from '../../common/dto/pagination.dto';
import { CreateProductDto } from './dto/create-product.dto';
import { ProductListQueryDto } from './dto/product-list-query.dto';
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
        select: {
          rolledUpCostSnapshot: true,
          costSnapshotAt: true,
          isCostComplete: true,
        },
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
        // Priced at 0 on a manufactured product = "cost not known yet", so let
        // the released BOM cost fill it in. A real price entered here stands.
        autoPricedFromBomCost: Number(dto.unitPrice) === 0,
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
    query: ProductListQueryDto,
    user: AuthenticatedUser,
  ): Promise<PaginatedResult<ProductEntity>> {
    const showCost = await this.canViewCost(user);
    if (!showCost) await this.access.assertSalesAccess(user);
    const search = query.search?.trim();
    const where: Prisma.ProductWhereInput = search
      ? {
          OR: [
            { sku: { contains: search, mode: 'insensitive' } },
            { name: { contains: search, mode: 'insensitive' } },
          ],
        }
      : {};
    const [items, total] = await this.prisma.$transaction([
      this.prisma.product.findMany({
        where,
        skip: query.skip,
        take: query.limit,
        orderBy: { createdAt: 'desc' },
        include: PRODUCT_INCLUDE,
      }),
      this.prisma.product.count({ where }),
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
    const existingProduct = await this.findRawOrThrow(id);
    if (dto.sku !== undefined && dto.sku !== existingProduct.sku) {
      const skuOwner = await this.prisma.product.findUnique({
        where: { sku: dto.sku },
        select: { id: true },
      });
      if (skuOwner) {
        throw new ConflictException(
          `A product with SKU ${dto.sku} already exists`,
        );
      }
    }
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
        sku: dto.sku,
        name: dto.name,
        description: dto.description,
        // A price in the payload is a human pricing decision and takes the
        // product off automatic pricing — unless they entered 0, which is not a
        // price but a product still waiting for its cost.
        ...(dto.unitPrice !== undefined
          ? {
              unitPrice: new Prisma.Decimal(dto.unitPrice),
              autoPricedFromBomCost: Number(dto.unitPrice) === 0,
            }
          : {}),
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

  async remove(
    id: string,
    user: AuthenticatedUser,
  ): Promise<{ id: string; deleted: true }> {
    const canDelete =
      user.role === Role.SUPER_ADMIN ||
      (user.role === Role.MANAGER && (await this.access.isSalesStaff(user)));
    if (!canDelete) {
      throw new ForbiddenException(
        'Only Sales Managers or CEO/SuperAdmin may delete products',
      );
    }

    await this.findRawOrThrow(id);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const referenceChecks = await Promise.all([
          tx.bidLineItem.count({ where: { productId: id } }),
          tx.orderLineItem.count({ where: { productId: id } }),
          tx.salesInvoiceLine.count({ where: { productId: id } }),
          tx.customerBomIntake.count({ where: { productId: id } }),
          tx.designRequest.count({ where: { productId: id } }),
          tx.designProject.count({ where: { productId: id } }),
          tx.kickoffBomSelection.count({ where: { productId: id } }),
          tx.qmsInspectionPlan.count({ where: { productId: id } }),
          tx.qmsInspection.count({ where: { productId: id } }),
          tx.qmsNonConformance.count({ where: { productId: id } }),
          tx.qmsCustomerComplaint.count({ where: { productId: id } }),
        ]);
        const labels = [
          'bid lines',
          'order lines',
          'invoice lines',
          'customer BOM intake',
          'design requests',
          'design projects',
          'kickoff BOM snapshots',
          'quality plans',
          'quality inspections',
          'quality NCRs',
          'customer complaints',
        ];
        const usedBy = referenceChecks
          .map((count, index) => (count ? `${labels[index]} (${count})` : null))
          .filter(Boolean);
        if (usedBy.length) {
          throw new ConflictException(
            `This product cannot be deleted because it is used by: ${usedBy.join(', ')}. Mark it inactive instead to preserve history.`,
          );
        }
        await tx.product.delete({ where: { id } });
        return { id, deleted: true as const };
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2003'
      ) {
        throw new ConflictException(
          'This product cannot be deleted because it is referenced elsewhere in the system. Mark it inactive instead.',
        );
      }
      throw error;
    }
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
    const isCostComplete = product.item?.boms[0]?.isCostComplete ?? false;
    const target = product.targetMarginPercent;
    const suggested = suggestedSellingPrice(
      isCostComplete ? snapshot : null,
      target,
    );
    const actualMargin = actualMarginPercent(
      isCostComplete ? snapshot : null,
      product.unitPrice,
    );
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
      // Not cost-gated: whoever can see the price needs to know whether it is
      // theirs to own or one the system maintains.
      autoPricedFromBomCost: product.autoPricedFromBomCost,
      ...(includeCost
        ? {
            targetMarginPercent: target?.toString() ?? null,
            rolledUpCostSnapshot: snapshot?.toString() ?? null,
            costSnapshotAt: product.item?.boms[0]?.costSnapshotAt ?? null,
            isCostComplete,
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
