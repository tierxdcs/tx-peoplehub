import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, StatutoryConfigType } from '@prisma/client';
import {
  COMPANY_PT_STATE,
  StatutoryConfigService,
} from './statutory-config.service';

type Money = Prisma.Decimal;

type PfBranch = 'PF_CAPPED' | 'PF_UNCAPPED';

export interface OnboardingCompensationBreakdown {
  branch: PfBranch;
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
  employerEsiAnnual: string | null;
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
        COMPANY_PT_STATE,
      ),
    ]);
    const missing = [
      !structureRow && 'Salary Structure',
      !pfRow && 'PF',
      !esiRow && 'ESI',
      !ptRow && `Professional Tax (${COMPANY_PT_STATE})`,
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

    // Back-solve monthly Gross from the target CTC. CTC is
    //   12·gross + incentiveGrossMonths·gross + employerPfAnnual
    //     + employerEsiAnnual + insurance
    // and BOTH employer contributions depend on gross itself, each with its
    // own step: employer PF stops growing once Basic passes the PF wage
    // ceiling, and employer ESI vanishes once gross passes the ESI threshold.
    // That gives four closed-form solutions — one per (PF branch × ESI
    // applies) pair. Solve each and keep the first whose own assumptions hold
    // for the gross it produces, which is what makes the round-trip exact.
    const solveGross = (branch: PfBranch, esiApplies: boolean): Money => {
      let numerator = annualTarget.minus(insurance);
      let divisor = baseAnnualGrossMonths;
      if (branch === 'PF_CAPPED') {
        numerator = numerator.minus(cappedEmployerPfAnnual);
      } else {
        divisor = divisor.plus(
          new Prisma.Decimal(12)
            .times(pf.employerRate)
            .times(structure.basicGrossRate),
        );
      }
      if (esiApplies) {
        divisor = divisor.plus(new Prisma.Decimal(12).times(esi.employerRate));
      }
      return numerator.dividedBy(divisor);
    };

    if (annualTarget.minus(insurance).lte(0)) {
      throw new BadRequestException(
        'Monthly CTC is too low for the configured fixed insurance and contribution rules',
      );
    }

    // ESI-applies candidates are tried first: just above the ESI threshold
    // there is a band of target CTCs (worth up to one year of employer ESI on
    // a threshold gross) that BOTH readings balance exactly, and in that band
    // the employee should stay inside the ESI net rather than be engineered
    // out of it by taking the higher-gross solution.
    const candidates: Array<{ branch: PfBranch; esiApplies: boolean }> = [
      { branch: 'PF_UNCAPPED', esiApplies: true },
      { branch: 'PF_CAPPED', esiApplies: true },
      { branch: 'PF_UNCAPPED', esiApplies: false },
      { branch: 'PF_CAPPED', esiApplies: false },
    ];

    let solution: {
      branch: PfBranch;
      esiApplies: boolean;
      gross: Money;
      basic: Money;
    } | null = null;
    for (const candidate of candidates) {
      const raw = solveGross(candidate.branch, candidate.esiApplies);
      if (!raw.isPositive()) continue;
      // Test each assumption against the ROUNDED gross and Basic, because
      // those are the figures every downstream reader sees:
      // composeCtcBreakdown re-derives ESI applicability from the rounded
      // components, and would otherwise print an employer ESI the CTC was
      // never solved for — the exact drift this branch selection prevents.
      const gross = raw.toDecimalPlaces(2);
      const basic = gross.times(structure.basicGrossRate).toDecimalPlaces(2);
      const pfHolds =
        candidate.branch === 'PF_UNCAPPED'
          ? basic.lte(pf.wageCeiling)
          : basic.gt(pf.wageCeiling);
      const esiHolds = candidate.esiApplies === gross.lte(esi.wageThreshold);
      if (pfHolds && esiHolds) {
        solution = { ...candidate, gross, basic };
        break;
      }
    }
    if (!solution) {
      // Unreachable for any gross that rounds clear of the ESI threshold: of
      // the two ESI readings one always holds on the unrounded solve. Only a
      // solve landing in the half-paisa window straddling the threshold can
      // fail both rounded re-tests, so pin gross to the threshold itself —
      // where ESI applies and every downstream reader agrees.
      const gross = new Prisma.Decimal(esi.wageThreshold);
      const basic = gross.times(structure.basicGrossRate).toDecimalPlaces(2);
      solution = {
        branch: basic.lte(pf.wageCeiling) ? 'PF_UNCAPPED' : 'PF_CAPPED',
        esiApplies: true,
        gross,
        basic,
      };
    }

    // Components are rounded to paise, then Other Allowance is made the exact
    // balancing remainder so they always add back up to Gross.
    const { branch, gross, basic } = solution;
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
    // Taken from the chosen solution rather than re-derived, so the ESI the
    // CTC was solved for is exactly the ESI that gets charged.
    const esiApplies = solution.esiApplies;
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
    // Employer ESI is a real cost to company and is printed in the offer's
    // Grand Total, so it has to be counted here too — omitting it made the
    // printed CTC exceed the CTC actually offered.
    const employerEsiAnnual = employerEsi ? employerEsi.times(12) : null;
    const contributions = employerPfAnnual
      .plus(employerEsiAnnual ?? 0)
      .plus(insurance)
      .plus(incentive);

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
      employerEsiAnnual: employerEsiAnnual ? money(employerEsiAnnual) : null,
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
