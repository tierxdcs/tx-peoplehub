import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, StatutoryConfig, StatutoryConfigType } from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { CreateStatutoryConfigDto } from './dto/create-statutory-config.dto';
import { UpdateStatutoryConfigDto } from './dto/update-statutory-config.dto';
import { StatutoryConfigEntity } from './entities/statutory-config.entity';

/**
 * The COMPLETE set of configData fields per configType — every field is
 * required, and anything outside the set is rejected. Enforced here rather
 * than at the schema level (Prisma has no discriminated-JSON support) or via
 * class-validator (a JSON blob's required shape depends on a sibling
 * field's value, which class-validator can't express declaratively).
 *
 * Treating this as an allow-list rather than just a minimum is deliberate:
 * configData is free-form JSON, so an invented key sits in a saved config
 * looking every bit as authoritative as a real one while no computation ever
 * reads it. A hand-typed `monthOverrides` on a Professional Tax row is the
 * case that motivated this — it looked like a live February-differential rule
 * and silently did nothing.
 *
 * Note that PF's `epsRate` and `adminCharge` ARE stored and required but are
 * not yet read by any computation; they are reserved for the EPS/admin-charge
 * split and should not be taken as active until that lands.
 */
/**
 * The state whose Professional Tax rules apply to the company's own payroll —
 * every unit is in Karnataka (see core/documents/letterhead.ts). Used as the
 * fallback when an employee's free-text work location is not itself a
 * configured PT state, which is the normal case.
 */
export const COMPANY_PT_STATE = 'Karnataka';

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
  [StatutoryConfigType.SALARY_STRUCTURE]: [
    'basicGrossRate',
    'hraGrossRate',
    'conveyanceMonthly',
    'annualInsurance',
    'incentiveGrossMonths',
  ],
};

/**
 * The per-slab value key for the two slab-based config types. PT slabs carry a
 * flat rupee `amount`; TDS slabs carry a fractional `rate`. Mixing them up
 * yields a silent zero, so the shape is validated rather than trusted.
 */
const SLAB_VALUE_FIELD: Partial<
  Record<StatutoryConfigType, 'amount' | 'rate'>
> = {
  [StatutoryConfigType.PROFESSIONAL_TAX]: 'amount',
  [StatutoryConfigType.TDS_SLAB]: 'rate',
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

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

  async update(
    id: string,
    dto: UpdateStatutoryConfigDto,
  ): Promise<StatutoryConfigEntity> {
    const existing = await this.prisma.statutoryConfig.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException('Statutory config version not found');
    }
    if (existing.configType !== dto.configType) {
      throw new BadRequestException(
        'Config type cannot be changed; add a new version instead',
      );
    }
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
      id,
    );
    const updated = await this.prisma.statutoryConfig.update({
      where: { id },
      data: {
        state: dto.state ?? null,
        effectiveFrom,
        effectiveTo,
        configData: dto.configData as Prisma.InputJsonValue,
        sourceNote: dto.sourceNote,
      },
    });
    return this.toEntity(updated);
  }

  /**
   * The Professional Tax row that applies to a given work location.
   *
   * PT is legally keyed by the STATE of employment, but Employee carries only
   * a free-text `workLocation` ("Hybrid", "Unit 1 - Peenya"), which never
   * equals a state name — so looking the row up by workLocation alone finds
   * nothing and PT silently comes out as zero. Try workLocation first (so a
   * genuinely multi-state setup can still configure a row per location), then
   * fall back to the state the company operates in.
   */
  async findProfessionalTax(
    workLocation: string | null,
    asOf: Date,
  ): Promise<StatutoryConfig | null> {
    const byLocation = workLocation
      ? await this.findEffective(
          StatutoryConfigType.PROFESSIONAL_TAX,
          asOf,
          workLocation,
        )
      : null;
    return (
      byLocation ??
      this.findEffective(
        StatutoryConfigType.PROFESSIONAL_TAX,
        asOf,
        COMPANY_PT_STATE,
      )
    );
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
    const allowed = REQUIRED_FIELDS[configType];
    const missing = allowed.filter((field) => !(field in configData));
    if (missing.length > 0) {
      throw new BadRequestException(
        `configData for ${configType} is missing required field(s): ${missing.join(', ')}`,
      );
    }
    const unknown = Object.keys(configData).filter(
      (field) => !allowed.includes(field),
    );
    if (unknown.length > 0) {
      throw new BadRequestException(
        `configData for ${configType} has unknown field(s): ${unknown.join(', ')}. ` +
          `Only ${allowed.join(', ')} are read — remove the rest so a setting no ` +
          'computation looks at is never mistaken for an active rule.',
      );
    }

    const slabValueField = SLAB_VALUE_FIELD[configType];
    if (slabValueField) {
      this.validateSlabs(configType, configData.slabs, slabValueField);
      return;
    }
    for (const field of allowed) {
      if (!isFiniteNumber(configData[field])) {
        throw new BadRequestException(
          `configData.${field} for ${configType} must be a finite number`,
        );
      }
    }
  }

  /**
   * Slab arrays drive every PT and TDS figure, and a malformed one fails
   * silently rather than loudly — a gap at the top of the ladder makes a high
   * earner's deduction zero, and a slab keyed `rate` where `amount` is read
   * computes nothing at all. So the ladder is checked at save time: ascending,
   * non-overlapping, and open-ended at the top so every income finds a slab.
   */
  private validateSlabs(
    configType: StatutoryConfigType,
    value: unknown,
    valueField: 'amount' | 'rate',
  ): void {
    const reject = (reason: string): never => {
      throw new BadRequestException(
        `configData.slabs for ${configType} ${reason}`,
      );
    };
    if (!Array.isArray(value) || value.length === 0) {
      reject('must be a non-empty array');
    }
    const slabs = value as unknown[];
    const slabFields = ['slabFrom', 'slabTo', valueField];
    let previousTo: number | null = null;

    for (let i = 0; i < slabs.length; i += 1) {
      const at = `entry ${i + 1}`;
      const slab = slabs[i];
      if (typeof slab !== 'object' || slab === null || Array.isArray(slab)) {
        reject(`${at} must be an object`);
      }
      const fields = slab as Record<string, unknown>;
      const missing = slabFields.filter((f) => !(f in fields));
      if (missing.length > 0) {
        reject(`${at} is missing ${missing.join(', ')}`);
      }
      const extra = Object.keys(fields).filter((f) => !slabFields.includes(f));
      if (extra.length > 0) {
        reject(
          `${at} has unknown field(s): ${extra.join(', ')} (expected ${slabFields.join(', ')})`,
        );
      }
      if (!isFiniteNumber(fields.slabFrom) || fields.slabFrom < 0) {
        reject(`${at} slabFrom must be a number of 0 or more`);
      }
      if (!isFiniteNumber(fields[valueField]) || fields[valueField] < 0) {
        reject(`${at} ${valueField} must be a number of 0 or more`);
      }
      const slabFrom = fields.slabFrom as number;
      const slabTo = fields.slabTo;
      if (slabTo !== null && !isFiniteNumber(slabTo)) {
        reject(`${at} slabTo must be a number, or null for the top slab`);
      }
      if (isFiniteNumber(slabTo) && slabTo < slabFrom) {
        reject(`${at} has slabTo below its slabFrom`);
      }
      if (previousTo === null && i > 0) {
        reject(
          `${at} follows an open-ended slab — only the last slab may have a null slabTo`,
        );
      }
      if (previousTo !== null && slabFrom < previousTo) {
        reject(`${at} overlaps the slab before it`);
      }
      previousTo = isFiniteNumber(slabTo) ? slabTo : null;
    }

    if (previousTo !== null) {
      reject(
        'must end in an open-ended slab (slabTo: null) so every income above the ' +
          'top boundary still matches one',
      );
    }
  }

  private async assertNoOverlap(
    configType: StatutoryConfigType,
    state: string | null,
    effectiveFrom: Date,
    effectiveTo: Date | null,
    excludeId?: string,
  ): Promise<void> {
    const overlapping = await this.prisma.statutoryConfig.findFirst({
      where: {
        ...(excludeId ? { id: { not: excludeId } } : {}),
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
