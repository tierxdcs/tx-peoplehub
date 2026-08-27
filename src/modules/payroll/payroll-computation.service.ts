import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Employee,
  LeaveRequestStatus,
  PayrollRun,
  Prisma,
  StatutoryConfig,
  StatutoryConfigType,
} from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { endOfMonth } from '../../common/utils/date.util';
import { SalaryStructuresService } from './salary-structures.service';
import { StatutoryConfigService } from './statutory-config.service';
import {
  CtcBreakdownEntity,
  CtcBreakdownRow,
} from './entities/ctc-breakdown.entity';

export interface RequiredConfigs {
  pf: StatutoryConfig;
  esi: StatutoryConfig;
  tdsSlab: StatutoryConfig;
  standardDeduction: StatutoryConfig;
  /** Keyed by the exact Employee.workLocation string — see the TODO below. */
  professionalTaxByState: Map<string, StatutoryConfig>;
}

export interface PayslipComputation {
  employeeId: string;
  grossEarnings: Prisma.Decimal;
  basicPaid: Prisma.Decimal;
  hraPaid: Prisma.Decimal;
  specialAllowancePaid: Prisma.Decimal;
  otherAllowancesPaid: Prisma.Decimal;
  pfEmployee: Prisma.Decimal;
  pfEmployer: Prisma.Decimal;
  esiEmployee: Prisma.Decimal | null;
  esiEmployer: Prisma.Decimal | null;
  professionalTax: Prisma.Decimal | null;
  tdsDeducted: Prisma.Decimal;
  unpaidLeaveDeduction: Prisma.Decimal;
  netPay: Prisma.Decimal;
  statutoryConfigSnapshot: Record<string, unknown>;
}

/**
 * Structural computation engine — see the Payroll module's plan/README for
 * the "structural, not computational" framing. Every rate comes from a
 * StatutoryConfig row; nothing here hardcodes a real PF/ESI/TDS rate or
 * threshold. Each calculate* method is deliberately thin and carries a
 * TODO(payroll-compliance-review) naming exactly what a CA/payroll
 * specialist must verify before this is trusted for real salaries.
 */
@Injectable()
export class PayrollComputationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly salaryStructures: SalaryStructuresService,
    private readonly statutoryConfig: StatutoryConfigService,
  ) {}

  /**
   * Loads every StatutoryConfig row this run will need, for every active
   * employee, BEFORE computing anything for anyone. Throws a single
   * BadRequestException naming everything missing — this is what makes a
   * fresh install (no seeded rates) fail loudly at process-time rather
   * than silently producing payslips with zero statutory deductions.
   */
  async loadRequiredConfigs(
    asOf: Date,
    employees: Employee[],
  ): Promise<RequiredConfigs> {
    const missing: string[] = [];

    const [pf, esi, tdsSlab, standardDeduction] = await Promise.all([
      this.statutoryConfig.findEffective(StatutoryConfigType.PF, asOf),
      this.statutoryConfig.findEffective(StatutoryConfigType.ESI, asOf),
      this.statutoryConfig.findEffective(StatutoryConfigType.TDS_SLAB, asOf),
      this.statutoryConfig.findEffective(
        StatutoryConfigType.STANDARD_DEDUCTION,
        asOf,
      ),
    ]);
    if (!pf)
      missing.push(`PF config effective on ${asOf.toISOString().slice(0, 10)}`);
    if (!esi)
      missing.push(
        `ESI config effective on ${asOf.toISOString().slice(0, 10)}`,
      );
    if (!tdsSlab)
      missing.push(
        `TDS_SLAB config effective on ${asOf.toISOString().slice(0, 10)}`,
      );
    if (!standardDeduction) {
      missing.push(
        `STANDARD_DEDUCTION config effective on ${asOf.toISOString().slice(0, 10)}`,
      );
    }

    // TODO(payroll-compliance-review): Professional Tax is legally keyed
    // by the employee's state of employment, but Employee has no proper
    // state field today — only a free-text workLocation (e.g. "Bangalore
    // HQ"). This treats workLocation itself as the state lookup key, which
    // only works if StatutoryConfig.state is populated with the exact
    // same string. Confirm whether a dedicated state field is needed
    // before relying on this for real payroll.
    const states = [
      ...new Set(
        employees.map((e) => e.workLocation).filter((w): w is string => !!w),
      ),
    ];
    const professionalTaxByState = new Map<string, StatutoryConfig>();
    for (const state of states) {
      const config = await this.statutoryConfig.findEffective(
        StatutoryConfigType.PROFESSIONAL_TAX,
        asOf,
        state,
      );
      if (!config) {
        missing.push(
          `PROFESSIONAL_TAX config for state "${state}" effective on ${asOf.toISOString().slice(0, 10)}`,
        );
        continue;
      }
      professionalTaxByState.set(state, config);
    }

    if (missing.length > 0) {
      throw new BadRequestException(
        `Payroll run cannot be processed — missing StatutoryConfig: ${missing.join('; ')}. ` +
          'This table is deliberately not seeded; see StatutoryConfig schema comment.',
      );
    }

    return {
      pf: pf as StatutoryConfig,
      esi: esi as StatutoryConfig,
      tdsSlab: tdsSlab as StatutoryConfig,
      standardDeduction: standardDeduction as StatutoryConfig,
      professionalTaxByState,
    };
  }

  async computeForEmployee(
    employee: Employee,
    run: PayrollRun,
    configs: RequiredConfigs,
  ): Promise<PayslipComputation> {
    const periodStart = new Date(Date.UTC(run.year, run.month - 1, 1));
    const periodEnd = endOfMonth(periodStart);

    const structure = await this.salaryStructures.getCurrentOrThrow(
      employee.id,
      periodEnd,
    );

    const basic = structure.basic;
    const hra = structure.hra;
    const specialAllowance = structure.specialAllowance;
    const otherAllowances = structure.otherAllowances ?? new Prisma.Decimal(0);
    const grossEarnings = basic
      .plus(hra)
      .plus(specialAllowance)
      .plus(otherAllowances);

    const daysInMonth = periodEnd.getUTCDate();
    const unpaidDays = await this.sumUnpaidLeaveDays(
      employee.id,
      periodStart,
      periodEnd,
    );
    const unpaidLeaveDeduction = unpaidDays.equals(0)
      ? new Prisma.Decimal(0)
      : grossEarnings.dividedBy(daysInMonth).times(unpaidDays);

    const pf = this.calculatePf(basic, configs.pf);
    const esi = this.calculateEsi(grossEarnings, configs.esi);
    const professionalTax = this.calculateProfessionalTax(
      grossEarnings,
      employee.workLocation,
      configs.professionalTaxByState,
    );
    const tdsDeducted = this.calculateTds(
      grossEarnings,
      configs.tdsSlab,
      configs.standardDeduction,
    );

    const netPay = grossEarnings
      .minus(pf.employee)
      .minus(esi?.employee ?? 0)
      .minus(professionalTax ?? 0)
      .minus(tdsDeducted)
      .minus(unpaidLeaveDeduction);

    return {
      employeeId: employee.id,
      grossEarnings,
      basicPaid: basic,
      hraPaid: hra,
      specialAllowancePaid: specialAllowance,
      otherAllowancesPaid: otherAllowances,
      pfEmployee: pf.employee,
      pfEmployer: pf.employer,
      esiEmployee: esi?.employee ?? null,
      esiEmployer: esi?.employer ?? null,
      professionalTax,
      tdsDeducted,
      unpaidLeaveDeduction,
      netPay,
      statutoryConfigSnapshot: this.buildSnapshot(employee, configs),
    };
  }

  /**
   * The fully-derived CTC breakdown (offer-letter view) for an employee's
   * CURRENT salary structure. Reuses the exact PF/ESI/PT rate logic the
   * payroll engine uses, so the two can never disagree. Reads only — nothing
   * is stored. TDS is intentionally not computed (surfaced as a note); Net
   * Take Home is therefore "before TDS", matching the offer-letter format.
   *
   * Unlike a payroll run, a missing StatutoryConfig here is NOT fatal: the
   * dependent rows show "—" and their names are collected into `warnings`,
   * so HR can still see the earning-side breakdown before rates are set up.
   */
  async computeCtcBreakdown(
    employeeId: string,
    asOf: Date = new Date(),
  ): Promise<CtcBreakdownEntity> {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
    });
    if (!employee) {
      throw new NotFoundException('Employee not found');
    }

    // Current structure (latest effectiveFrom <= asOf). Throws if none — an
    // employee with no salary on file has no breakdown to show.
    const structure = await this.salaryStructures.getCurrentOrThrow(
      employeeId,
      asOf,
    );

    const basic = structure.basic;
    const hra = structure.hra;
    const specialAllowance = structure.specialAllowance;
    const otherAllowances = structure.otherAllowances ?? new Prisma.Decimal(0);
    const variablePayAnnual = structure.variablePay ?? new Prisma.Decimal(0);
    const grossMonthly = basic
      .plus(hra)
      .plus(specialAllowance)
      .plus(otherAllowances);

    const warnings: string[] = [];

    // Load the statutory rows this breakdown needs. Each is optional here —
    // a null means "not configured yet", handled per-row below.
    const [pfConfig, esiConfig, ptConfig] = await Promise.all([
      this.statutoryConfig.findEffective(StatutoryConfigType.PF, asOf),
      this.statutoryConfig.findEffective(StatutoryConfigType.ESI, asOf),
      employee.workLocation
        ? this.statutoryConfig.findEffective(
            StatutoryConfigType.PROFESSIONAL_TAX,
            asOf,
            employee.workLocation,
          )
        : Promise.resolve(null),
    ]);

    const pf = pfConfig ? this.calculatePf(basic, pfConfig) : null;
    if (!pfConfig) warnings.push('PF');

    const esi = esiConfig ? this.calculateEsi(grossMonthly, esiConfig) : null;
    if (!esiConfig) warnings.push('ESI');

    let professionalTax: Prisma.Decimal | null = null;
    if (!employee.workLocation) {
      warnings.push('Professional Tax (no work location on file)');
    } else if (!ptConfig) {
      warnings.push(`Professional Tax (${employee.workLocation})`);
    } else {
      professionalTax = this.calculateProfessionalTax(
        grossMonthly,
        employee.workLocation,
        new Map([[employee.workLocation, ptConfig]]),
      );
    }

    // Direct Components — the typed earning components + gross sub-total.
    const directComponents: CtcBreakdownRow[] = [
      this.monthlyRow('Basic Salary', basic),
      this.monthlyRow('House Rent Allowance (HRA)', hra),
      this.monthlyRow('Special Allowance', specialAllowance),
    ];
    if (otherAllowances.gt(0)) {
      directComponents.push(
        this.monthlyRow('Other Allowances', otherAllowances),
      );
    }
    directComponents.push(
      this.monthlyRow('Sub Total – Gross Salary', grossMonthly, true),
    );

    // Deductions from Employee Side. Salary Before Taxes = gross − (PF + ESI
    // + PT); TDS is shown as a note only, so Net Take Home is "before TDS".
    const employeePf = pf?.employee ?? null;
    const employeeEsi = esi?.employee ?? null;
    const salaryBeforeTaxesMonthly = grossMonthly
      .minus(employeePf ?? 0)
      .minus(employeeEsi ?? 0)
      .minus(professionalTax ?? 0);

    const employeeDeductions: CtcBreakdownRow[] = [
      this.monthlyRow('Gross Salary', grossMonthly),
      this.monthlyRowOrDash('Employee PF', employeePf),
      this.monthlyRowOrDash('Employee ESI', employeeEsi),
      this.monthlyRowOrDash('Professional Tax (PT)', professionalTax),
      this.monthlyRow('Salary Before Taxes', salaryBeforeTaxesMonthly, true),
      {
        label: 'TDS (As Applicable)',
        perMonth: null,
        perAnnum: null,
        note: 'As per Income Tax Act',
      },
      {
        ...this.monthlyRow(
          'Net Take Home Salary',
          salaryBeforeTaxesMonthly,
          true,
        ),
        note: 'Before TDS',
      },
    ];

    // Other Indirect Benefits — employer-side contributions + variable pay.
    const employerPf = pf?.employer ?? null;
    const employerEsi = esi?.employer ?? null;
    const indirectMonthlyTotal = (employerPf ?? new Prisma.Decimal(0)).plus(
      employerEsi ?? 0,
    );
    // variablePay is stored ANNUAL; show its monthly as annual/12.
    const variablePayMonthly = variablePayAnnual.dividedBy(12);

    const indirectBenefits: CtcBreakdownRow[] = [
      this.monthlyRowOrDash('Employer Contribution to PF', employerPf),
      this.monthlyRowOrDash('Employer ESI', employerEsi),
      variablePayAnnual.gt(0)
        ? {
            label: 'Variable Pay',
            perMonth: this.money(variablePayMonthly),
            perAnnum: this.money(variablePayAnnual),
          }
        : this.monthlyRowOrDash('Variable Pay', null),
      {
        label: 'Sub Total – Indirect Benefits',
        perMonth: this.money(indirectMonthlyTotal),
        perAnnum: this.money(
          indirectMonthlyTotal.times(12).plus(variablePayAnnual),
        ),
        emphasize: true,
      },
    ];

    // Grand Total (CTC) = gross + employer contributions (monthly ×12) +
    // annual variable pay. This is the TRUE computed CTC — it may differ from
    // the manually-entered SalaryStructure.ctcAnnual, which is a reference
    // figure only.
    const ctcMonthly = grossMonthly.plus(indirectMonthlyTotal);
    const ctcAnnual = ctcMonthly.times(12).plus(variablePayAnnual);
    const grandTotal: CtcBreakdownRow = {
      label: 'Total Cost to Company (CTC)',
      perMonth: this.money(ctcMonthly),
      perAnnum: this.money(ctcAnnual),
      emphasize: true,
    };

    return new CtcBreakdownEntity({
      employeeId,
      effectiveFrom: structure.effectiveFrom,
      directComponents,
      employeeDeductions,
      indirectBenefits,
      grandTotal,
      warnings,
    });
  }

  private money(value: Prisma.Decimal): string {
    return value.toDecimalPlaces(2).toString();
  }

  /** A row with the same monthly value shown per-month and ×12 per-annum. */
  private monthlyRow(
    label: string,
    monthly: Prisma.Decimal,
    emphasize = false,
  ): CtcBreakdownRow {
    return {
      label,
      perMonth: this.money(monthly),
      perAnnum: this.money(monthly.times(12)),
      emphasize,
    };
  }

  /** Same as monthlyRow, but a null amount renders as "—" (not configured). */
  private monthlyRowOrDash(
    label: string,
    monthly: Prisma.Decimal | null,
  ): CtcBreakdownRow {
    if (monthly === null) {
      return { label, perMonth: null, perAnnum: null };
    }
    return this.monthlyRow(label, monthly);
  }

  /** Sum of numberOfDays across approved UL requests overlapping the period. */
  private async sumUnpaidLeaveDays(
    employeeId: string,
    periodStart: Date,
    periodEnd: Date,
  ): Promise<Prisma.Decimal> {
    const unpaidRequests = await this.prisma.leaveRequest.findMany({
      where: {
        employeeId,
        status: LeaveRequestStatus.APPROVED,
        leaveType: { code: 'UL' },
        startDate: { lte: periodEnd },
        endDate: { gte: periodStart },
      },
      select: { numberOfDays: true },
    });
    return unpaidRequests.reduce(
      (sum, r) => sum.plus(r.numberOfDays),
      new Prisma.Decimal(0),
    );
  }

  // TODO(payroll-compliance-review): wage base should be Basic + Dearness
  // Allowance per the Nov 2025 Labour Codes redefinition — this schema has
  // no DA field yet, so wage base is Basic only. Confirm whether DA needs
  // to be added to SalaryStructure before this is used for real payroll.
  // Also confirm EPS split and admin-charge application against the
  // current EPFO circular — configData's shape here is a placeholder.
  private calculatePf(
    wageBase: Prisma.Decimal,
    config: StatutoryConfig,
  ): { employee: Prisma.Decimal; employer: Prisma.Decimal } {
    const data = config.configData as {
      employeeRate: number;
      employerRate: number;
      wageCeiling: number;
    };
    const cappedWage = wageBase.gt(data.wageCeiling)
      ? new Prisma.Decimal(data.wageCeiling)
      : wageBase;
    return {
      employee: cappedWage.times(data.employeeRate),
      employer: cappedWage.times(data.employerRate),
    };
  }

  // TODO(payroll-compliance-review): does not implement the ESI
  // contribution-period continuation rule (an employee who crosses the
  // wage threshold mid-contribution-period must keep contributing for the
  // rest of that period) — this only checks the current month's gross
  // against the threshold. Confirm against the current ESIC circular.
  private calculateEsi(
    grossEarnings: Prisma.Decimal,
    config: StatutoryConfig,
  ): { employee: Prisma.Decimal; employer: Prisma.Decimal } | null {
    const data = config.configData as {
      employeeRate: number;
      employerRate: number;
      wageThreshold: number;
    };
    if (grossEarnings.gt(data.wageThreshold)) {
      return null;
    }
    return {
      employee: grossEarnings.times(data.employeeRate),
      employer: grossEarnings.times(data.employerRate),
    };
  }

  // TODO(payroll-compliance-review): confirm slab boundaries/amounts
  // against the specific state's Professional Tax Act — see the
  // workLocation-as-state-key limitation noted in loadRequiredConfigs.
  private calculateProfessionalTax(
    grossEarnings: Prisma.Decimal,
    workLocation: string | null,
    configByState: Map<string, StatutoryConfig>,
  ): Prisma.Decimal | null {
    if (!workLocation) {
      return null;
    }
    const config = configByState.get(workLocation);
    if (!config) {
      return null;
    }
    const data = config.configData as {
      slabs: Array<{ slabFrom: number; slabTo: number | null; amount: number }>;
    };
    const slab = data.slabs.find(
      (s) =>
        grossEarnings.gte(s.slabFrom) &&
        (s.slabTo === null || grossEarnings.lte(s.slabTo)),
    );
    return slab ? new Prisma.Decimal(slab.amount) : new Prisma.Decimal(0);
  }

  // TODO(payroll-compliance-review): this is a structural sketch only —
  // annualizedIncome is a crude gross*12 projection (no mid-year joiner
  // pro-ration, no other-income declarations, no Section 87A-style rebate
  // handling), and slab application assumes a simple progressive model.
  // Confirm the actual Income Tax Act 2025 computation (post the 1961 Act
  // replacement, TDS section 392) before this is used for real payroll.
  private calculateTds(
    grossEarnings: Prisma.Decimal,
    tdsSlabConfig: StatutoryConfig,
    standardDeductionConfig: StatutoryConfig,
  ): Prisma.Decimal {
    const slabData = tdsSlabConfig.configData as {
      slabs: Array<{ slabFrom: number; slabTo: number | null; rate: number }>;
    };
    const deductionData = standardDeductionConfig.configData as {
      amount: number;
    };

    const annualizedIncome = grossEarnings.times(12);
    const taxableIncome = annualizedIncome
      .minus(deductionData.amount)
      .clampedTo(new Prisma.Decimal(0), annualizedIncome);

    let annualTax = new Prisma.Decimal(0);
    for (const slab of slabData.slabs) {
      const slabFrom = new Prisma.Decimal(slab.slabFrom);
      const slabTo =
        slab.slabTo === null ? taxableIncome : new Prisma.Decimal(slab.slabTo);
      if (taxableIncome.lte(slabFrom)) {
        continue;
      }
      const amountInSlab = Prisma.Decimal.min(taxableIncome, slabTo).minus(
        slabFrom,
      );
      if (amountInSlab.lte(0)) {
        continue;
      }
      annualTax = annualTax.plus(amountInSlab.times(slab.rate));
    }

    return annualTax.dividedBy(12);
  }

  private buildSnapshot(
    employee: Employee,
    configs: RequiredConfigs,
  ): Record<string, unknown> {
    const pt = employee.workLocation
      ? configs.professionalTaxByState.get(employee.workLocation)
      : undefined;
    return {
      pf: configs.pf,
      esi: configs.esi,
      tdsSlab: configs.tdsSlab,
      standardDeduction: configs.standardDeduction,
      professionalTax: pt ?? null,
    };
  }
}
