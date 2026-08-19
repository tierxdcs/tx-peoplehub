import { Injectable, NotFoundException } from '@nestjs/common';
import { SalaryStructure } from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { CreateSalaryStructureDto } from './dto/create-salary-structure.dto';
import { CreateSalaryStructureFromCtcDto } from './dto/create-salary-structure-from-ctc.dto';
import { SalaryStructureEntity } from './entities/salary-structure.entity';
import {
  OnboardingCompensationBreakdown,
  OnboardingCompensationService,
} from './onboarding-compensation.service';

@Injectable()
export class SalaryStructuresService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly onboardingCompensation: OnboardingCompensationService,
  ) {}

  /**
   * Effective-dated history is append-only — a change creates a new row
   * rather than editing a prior one, so past payroll runs remain
   * reproducible against the structure that was actually current then.
   */
  async create(
    dto: CreateSalaryStructureDto,
    createdById: string,
  ): Promise<SalaryStructureEntity> {
    const employee = await this.prisma.employee.findUnique({
      where: { id: dto.employeeId },
    });
    if (!employee) {
      throw new NotFoundException('Employee not found');
    }

    const created = await this.prisma.salaryStructure.create({
      data: {
        employeeId: dto.employeeId,
        effectiveFrom: new Date(dto.effectiveFrom),
        basic: dto.basic,
        hra: dto.hra,
        specialAllowance: dto.specialAllowance ?? 0,
        otherAllowances: dto.otherAllowances ?? null,
        variablePay: dto.variablePay ?? null,
        ctcAnnual: dto.ctcAnnual,
        createdById,
      },
    });
    return this.toEntity(created);
  }

  /**
   * Read-only reverse-solve of a target monthly CTC into its full component
   * breakdown, for a live preview before saving a revision. Delegates to the
   * SAME calculator onboarding uses — there is no second implementation.
   */
  previewCtc(
    monthlyCtc: number,
    effectiveDate: string,
  ): Promise<OnboardingCompensationBreakdown> {
    return this.onboardingCompensation.calculate(
      monthlyCtc,
      new Date(effectiveDate),
    );
  }

  /**
   * Salary hike/promotion via CTC-only input. Reverse-solves the target CTC
   * server-side (never trusting client-sent component amounts) and appends a
   * new effective-dated row — history is preserved exactly as `create` does.
   * The calc→column mapping mirrors onboarding (employees.service onboard):
   * the Special Allowance slot carries the fixed Conveyance component and
   * variablePay carries the annual incentive.
   */
  async createFromCtc(
    dto: CreateSalaryStructureFromCtcDto,
    createdById: string,
  ): Promise<SalaryStructureEntity> {
    const employee = await this.prisma.employee.findUnique({
      where: { id: dto.employeeId },
    });
    if (!employee) {
      throw new NotFoundException('Employee not found');
    }

    const calc = await this.onboardingCompensation.calculate(
      dto.monthlyCtc,
      new Date(dto.effectiveDate),
    );

    const created = await this.prisma.salaryStructure.create({
      data: {
        employeeId: dto.employeeId,
        effectiveFrom: new Date(dto.effectiveDate),
        basic: calc.basicMonthly,
        hra: calc.hraMonthly,
        specialAllowance: calc.conveyanceMonthly,
        otherAllowances: calc.otherAllowanceMonthly,
        variablePay: calc.incentiveAnnual,
        ctcAnnual: calc.annualCtc,
        createdById,
      },
    });
    return this.toEntity(created);
  }

  /** The row with the latest effectiveFrom <= asOf, or null if none exists yet. */
  async getCurrent(
    employeeId: string,
    asOf: Date = new Date(),
  ): Promise<SalaryStructure | null> {
    return this.prisma.salaryStructure.findFirst({
      where: { employeeId, effectiveFrom: { lte: asOf } },
      orderBy: { effectiveFrom: 'desc' },
    });
  }

  /** Same lookup as getCurrent, shaped as the public entity (or null). */
  async getCurrentEntity(
    employeeId: string,
    asOf: Date = new Date(),
  ): Promise<SalaryStructureEntity | null> {
    const current = await this.getCurrent(employeeId, asOf);
    return current ? this.toEntity(current) : null;
  }

  /** Full effective-dated history for one employee, most recent first. */
  async getHistory(employeeId: string): Promise<SalaryStructureEntity[]> {
    const rows = await this.prisma.salaryStructure.findMany({
      where: { employeeId },
      orderBy: { effectiveFrom: 'desc' },
    });
    return rows.map((r) => this.toEntity(r));
  }

  async getCurrentOrThrow(
    employeeId: string,
    asOf: Date = new Date(),
  ): Promise<SalaryStructure> {
    const current = await this.getCurrent(employeeId, asOf);
    if (!current) {
      throw new NotFoundException(
        `No salary structure on file for employee ${employeeId} effective on or before ${asOf.toISOString()}`,
      );
    }
    return current;
  }

  private toEntity(structure: SalaryStructure): SalaryStructureEntity {
    return new SalaryStructureEntity({
      id: structure.id,
      employeeId: structure.employeeId,
      effectiveFrom: structure.effectiveFrom,
      basic: structure.basic.toString(),
      hra: structure.hra.toString(),
      specialAllowance: structure.specialAllowance.toString(),
      otherAllowances: structure.otherAllowances?.toString() ?? null,
      variablePay: structure.variablePay?.toString() ?? null,
      ctcAnnual: structure.ctcAnnual.toString(),
    });
  }
}
