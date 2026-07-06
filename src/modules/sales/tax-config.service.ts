import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, SalesTaxType, TaxConfig } from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { CreateTaxConfigDto } from './dto/create-tax-config.dto';
import { TaxConfigEntity } from './entities/tax-config.entity';

/**
 * Versioned, effective-dated GST rates — same pattern as
 * StatutoryConfigService. GST percentages are never hardcoded in bid/order
 * computation; every rate is looked up here by taxType + effective date.
 * Unlike StatutoryConfig this table MAY be seeded/populated for the demo
 * since the compliance stakes are lower (a wrong bid rate is correctable
 * before invoicing), but rates still carry a sourceNote for traceability.
 */
@Injectable()
export class TaxConfigService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateTaxConfigDto): Promise<TaxConfigEntity> {
    const effectiveFrom = new Date(dto.effectiveFrom);
    const effectiveTo = dto.effectiveTo ? new Date(dto.effectiveTo) : null;
    if (effectiveTo && effectiveTo < effectiveFrom) {
      throw new BadRequestException(
        'effectiveTo cannot be before effectiveFrom',
      );
    }
    await this.assertNoOverlap(dto.taxType, effectiveFrom, effectiveTo);

    const created = await this.prisma.taxConfig.create({
      data: {
        taxType: dto.taxType,
        rate: new Prisma.Decimal(dto.rate),
        effectiveFrom,
        effectiveTo,
        sourceNote: dto.sourceNote,
      },
    });
    return this.toEntity(created);
  }

  async findAll(): Promise<TaxConfigEntity[]> {
    const rows = await this.prisma.taxConfig.findMany({
      orderBy: [{ taxType: 'asc' }, { effectiveFrom: 'desc' }],
    });
    return rows.map((r) => this.toEntity(r));
  }

  /** The rate of `taxType` effective on `asOf`, or null if none configured. */
  async findEffective(
    taxType: SalesTaxType,
    asOf: Date,
  ): Promise<TaxConfig | null> {
    return this.prisma.taxConfig.findFirst({
      where: {
        taxType,
        effectiveFrom: { lte: asOf },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: asOf } }],
      },
      orderBy: { effectiveFrom: 'desc' },
    });
  }

  private async assertNoOverlap(
    taxType: SalesTaxType,
    effectiveFrom: Date,
    effectiveTo: Date | null,
  ): Promise<void> {
    const overlapping = await this.prisma.taxConfig.findFirst({
      where: {
        taxType,
        effectiveFrom: effectiveTo ? { lte: effectiveTo } : undefined,
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: effectiveFrom } }],
      },
    });
    if (overlapping) {
      throw new BadRequestException(
        `An existing ${taxType} rate already covers part of this effective-date range`,
      );
    }
  }

  private toEntity(config: TaxConfig): TaxConfigEntity {
    return new TaxConfigEntity({
      id: config.id,
      taxType: config.taxType,
      rate: config.rate.toString(),
      effectiveFrom: config.effectiveFrom,
      effectiveTo: config.effectiveTo,
      sourceNote: config.sourceNote,
    });
  }
}
