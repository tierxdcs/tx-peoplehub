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
    const created = await this.prisma.product.create({
      data: {
        sku: dto.sku,
        name: dto.name,
        description: dto.description ?? null,
        unitPrice: new Prisma.Decimal(dto.unitPrice),
        unitOfMeasure: dto.unitOfMeasure,
        hsnCode: dto.hsnCode ?? null,
        isActive: dto.isActive ?? true,
      },
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
      },
    });
    return this.toEntity(updated);
  }

  private async findRawOrThrow(id: string): Promise<Product> {
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product) {
      throw new NotFoundException('Product not found');
    }
    return product;
  }

  private toEntity(product: Product): ProductEntity {
    return new ProductEntity({
      id: product.id,
      sku: product.sku,
      name: product.name,
      description: product.description,
      unitPrice: product.unitPrice.toString(),
      unitOfMeasure: product.unitOfMeasure,
      hsnCode: product.hsnCode,
      isActive: product.isActive,
      createdAt: product.createdAt,
      updatedAt: product.updatedAt,
    });
  }
}
