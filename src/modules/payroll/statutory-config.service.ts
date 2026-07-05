import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, StatutoryConfig, StatutoryConfigType } from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { CreateStatutoryConfigDto } from './dto/create-statutory-config.dto';
import { StatutoryConfigEntity } from './entities/statutory-config.entity';

/**
 * Required configData fields per configType. Enforced here rather than at
 * the schema level (Prisma has no discriminated-JSON support) or via
 * class-validator (a JSON blob's required shape depends on a sibling
 * field's value, which class-validator can't express declaratively).
 */
const REQUIRED_FIELDS: Record<StatutoryConfigType, string[]> = {
  [StatutoryConfigType.PF]: [
    'employeeRate',
    'employerRate',
    'epsRate',
    'wageCeiling',
    'adminCharge',
  ],
  [StatutoryConfigType.ESI]: ['employeeRate', 'employerRate', 'wageThreshold'],
  [StatutoryConfigType.PROFESSIONAL_TAX]: ['slabs'],
  [StatutoryConfigType.TDS_SLAB]: ['slabs'],
  [StatutoryConfigType.STANDARD_DEDUCTION]: ['amount'],
};

@Injectable()
export class StatutoryConfigService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateStatutoryConfigDto): Promise<StatutoryConfigEntity> {
    if (dto.configType === StatutoryConfigType.PROFESSIONAL_TAX && !dto.state) {
      throw new BadRequestException(
        'state is required for PROFESSIONAL_TAX config',
      );
    }
    this.validateConfigDataShape(dto.configType, dto.configData);

    const effectiveFrom = new Date(dto.effectiveFrom);
    const effectiveTo = dto.effectiveTo ? new Date(dto.effectiveTo) : null;
    if (effectiveTo && effectiveTo < effectiveFrom) {
      throw new BadRequestException(
        'effectiveTo cannot be before effectiveFrom',
      );
    }

    await this.assertNoOverlap(
      dto.configType,
      dto.state ?? null,
      effectiveFrom,
      effectiveTo,
    );

    const created = await this.prisma.statutoryConfig.create({
      data: {
        configType: dto.configType,
        state: dto.state ?? null,
        effectiveFrom,
        effectiveTo,
        configData: dto.configData as Prisma.InputJsonValue,
        sourceNote: dto.sourceNote,
      },
    });
    return this.toEntity(created);
  }

  async findAll(): Promise<StatutoryConfigEntity[]> {
    const rows = await this.prisma.statutoryConfig.findMany({
      orderBy: [{ configType: 'asc' }, { effectiveFrom: 'desc' }],
    });
    return rows.map((r) => this.toEntity(r));
  }

  /**
   * The config row of `configType` (and `state`, for PROFESSIONAL_TAX)
   * effective on `asOf`. Used by PayrollComputationService — this is the
   * single lookup that must find nothing on a fresh install (no seeded
   * rates), which is what makes processRun()'s missing-config guard fire.
   */
  async findEffective(
    configType: StatutoryConfigType,
    asOf: Date,
    state?: string | null,
  ): Promise<StatutoryConfig | null> {
    return this.prisma.statutoryConfig.findFirst({
      where: {
        configType,
        ...(configType === StatutoryConfigType.PROFESSIONAL_TAX
          ? { state }
          : {}),
        effectiveFrom: { lte: asOf },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: asOf } }],
      },
      orderBy: { effectiveFrom: 'desc' },
    });
  }

  private validateConfigDataShape(
    configType: StatutoryConfigType,
    configData: Record<string, unknown>,
  ): void {
    const required = REQUIRED_FIELDS[configType];
    const missing = required.filter((field) => !(field in configData));
    if (missing.length > 0) {
      throw new BadRequestException(
        `configData for ${configType} is missing required field(s): ${missing.join(', ')}`,
      );
    }
  }

  private async assertNoOverlap(
    configType: StatutoryConfigType,
    state: string | null,
    effectiveFrom: Date,
    effectiveTo: Date | null,
  ): Promise<void> {
    const overlapping = await this.prisma.statutoryConfig.findFirst({
      where: {
        configType,
        state,
        effectiveFrom: effectiveTo ? { lte: effectiveTo } : undefined,
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: effectiveFrom } }],
      },
    });
    if (overlapping) {
      throw new BadRequestException(
        `An existing ${configType} config${state ? ` for ${state}` : ''} already covers part of this effective-date range`,
      );
    }
  }

  private toEntity(config: StatutoryConfig): StatutoryConfigEntity {
    return new StatutoryConfigEntity({
      id: config.id,
      configType: config.configType,
      state: config.state,
      effectiveFrom: config.effectiveFrom,
      effectiveTo: config.effectiveTo,
      configData: config.configData as Record<string, unknown>,
      sourceNote: config.sourceNote,
    });
  }
}
