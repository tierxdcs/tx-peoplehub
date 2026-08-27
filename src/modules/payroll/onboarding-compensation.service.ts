import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, StatutoryConfigType } from '@prisma/client';
import { StatutoryConfigService } from './statutory-config.service';

type Money = Prisma.Decimal;

export interface OnboardingCompensationBreakdown {
  branch: 'PF_CAPPED' | 'PF_UNCAPPED';
  monthlyCtc: string;
  annualCtc: string;
  grossMonthly: string;
  basicMonthly: string;
  hraMonthly: string;
  conveyanceMonthly: string;
  otherAllowanceMonthly: string;
  professionalTaxMonthly: string;
  employeePfMonthly: string;
  employeeEsiMonthly: string | null;
  employerPfMonthly: string;
  employerEsiMonthly: string | null;
  totalDeductionsMonthly: string;
  netSalaryMonthly: string;
  totalAnnualisedSalary: string;
  insuranceAnnual: string;
  incentiveAnnual: string;
  employerPfAnnual: string;
  totalCompanyContributionsAnnual: string;
  totalEmolumentsAnnual: string;
}

@Injectable()
export class OnboardingCompensationService {
  constructor(private readonly statutory: StatutoryConfigService) {}

  async calculate(
    monthlyCtcInput: number | string,
    asOf: Date,
  ): Promise<OnboardingCompensationBreakdown> {
    const monthlyCtc = new Prisma.Decimal(monthlyCtcInput);
    if (!monthlyCtc.isPositive()) {
      throw new BadRequestException('Monthly CTC must be greater than zero');
    }
    const [structureRow, pfRow, esiRow, ptRow] = await Promise.all([
      this.statutory.findEffective(StatutoryConfigType.SALARY_STRUCTURE, asOf),
      this.statutory.findEffective(StatutoryConfigType.PF, asOf),
      this.statutory.findEffective(StatutoryConfigType.ESI, asOf),
      this.statutory.findEffective(
        StatutoryConfigType.PROFESSIONAL_TAX,
        asOf,
        'Karnataka',
      ),
    ]);
    const missing = [
      !structureRow && 'Salary Structure',
      !pfRow && 'PF',
      !esiRow && 'ESI',
      !ptRow && 'Professional Tax (Karnataka)',
    ].filter(Boolean);
    if (missing.length) {
      throw new BadRequestException(
        `Statutory Config is missing an effective ${missing.join(', ')} configuration for ${asOf.toISOString().slice(0, 10)}`,
      );
    }

    const structure = structureRow!.configData as {
      basicGrossRate: number;
      hraGrossRate: number;
      conveyanceMonthly: number;
      annualInsurance: number;
      incentiveGrossMonths: number;
    };
    const pf = pfRow!.configData as {
      employeeRate: number;
      employerRate: number;
      wageCeiling: number;
    };
    const esi = esiRow!.configData as {
      employeeRate: number;
      employerRate: number;
      wageThreshold: number;
    };
    const pt = ptRow!.configData as {
      slabs: Array<{ slabFrom: number; slabTo: number | null; amount: number }>;
    };

    const annualTarget = monthlyCtc.times(12);
    const insurance = new Prisma.Decimal(structure.annualInsurance);
    const baseAnnualGrossMonths = new Prisma.Decimal(12).plus(
      structure.incentiveGrossMonths,
    );
    const cappedEmployerPfAnnual = new Prisma.Decimal(pf.wageCeiling)
      .times(pf.employerRate)
      .times(12);
    let gross = annualTarget
      .minus(cappedEmployerPfAnnual)
      .minus(insurance)
      .dividedBy(baseAnnualGrossMonths);
    let branch: 'PF_CAPPED' | 'PF_UNCAPPED' = 'PF_CAPPED';
    if (gross.times(structure.basicGrossRate).lte(pf.wageCeiling)) {
      branch = 'PF_UNCAPPED';
      gross = annualTarget
        .minus(insurance)
        .dividedBy(
          baseAnnualGrossMonths.plus(
            new Prisma.Decimal(12)
              .times(pf.employerRate)
              .times(structure.basicGrossRate),
          ),
        );
    }
    if (!gross.isPositive()) {
      throw new BadRequestException(
        'Monthly CTC is too low for the configured fixed insurance and contribution rules',
      );
    }

    // Round displayed/stored salary components to paise, then make Other
    // Allowance the exact balancing remainder so components always equal Gross.
    gross = gross.toDecimalPlaces(2);
    const basic = gross.times(structure.basicGrossRate).toDecimalPlaces(2);
    const hra = gross.times(structure.hraGrossRate).toDecimalPlaces(2);
    const conveyance = new Prisma.Decimal(
      structure.conveyanceMonthly,
    ).toDecimalPlaces(2);
    const other = gross.minus(basic).minus(hra).minus(conveyance);
    if (other.isNegative()) {
      throw new BadRequestException(
        'Configured Basic, HRA and Conveyance exceed monthly Gross',
      );
    }

    const pfBase = Prisma.Decimal.min(
      basic,
      new Prisma.Decimal(pf.wageCeiling),
    );
    const employeePf = pfBase.times(pf.employeeRate).toDecimalPlaces(2);
    const employerPf = pfBase.times(pf.employerRate).toDecimalPlaces(2);
    const esiApplies = gross.lte(esi.wageThreshold);
    const employeeEsi = esiApplies
      ? gross.times(esi.employeeRate).toDecimalPlaces(2)
      : null;
    const employerEsi = esiApplies
      ? gross.times(esi.employerRate).toDecimalPlaces(2)
      : null;
    const slab = pt.slabs.find(
      (item) =>
        gross.gte(item.slabFrom) &&
        (item.slabTo === null || gross.lte(item.slabTo)),
    );
    const professionalTax = new Prisma.Decimal(slab?.amount ?? 0);
    const deductions = employeePf.plus(employeeEsi ?? 0).plus(professionalTax);
    const incentive = gross.times(structure.incentiveGrossMonths);
    const employerPfAnnual = employerPf.times(12);
    const contributions = employerPfAnnual.plus(insurance).plus(incentive);

    const money = (value: Money) => value.toDecimalPlaces(2).toString();
    return {
      branch,
      monthlyCtc: money(monthlyCtc),
      annualCtc: money(annualTarget),
      grossMonthly: money(gross),
      basicMonthly: money(basic),
      hraMonthly: money(hra),
      conveyanceMonthly: money(conveyance),
      otherAllowanceMonthly: money(other),
      professionalTaxMonthly: money(professionalTax),
      employeePfMonthly: money(employeePf),
      employeeEsiMonthly: employeeEsi ? money(employeeEsi) : null,
      employerPfMonthly: money(employerPf),
      employerEsiMonthly: employerEsi ? money(employerEsi) : null,
      totalDeductionsMonthly: money(deductions),
      netSalaryMonthly: money(gross.minus(deductions)),
      totalAnnualisedSalary: money(gross.times(12)),
      insuranceAnnual: money(insurance),
      incentiveAnnual: money(incentive),
      employerPfAnnual: money(employerPfAnnual),
      totalCompanyContributionsAnnual: money(contributions),
      totalEmolumentsAnnual: money(gross.times(12).plus(contributions)),
    };
  }
}
