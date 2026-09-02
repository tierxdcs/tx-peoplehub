import { Prisma, StatutoryConfigType } from '@prisma/client';
import { OnboardingCompensationService } from './onboarding-compensation.service';

describe('OnboardingCompensationService', () => {
  const config = {
    findEffective: jest.fn(),
  };
  const service = new OnboardingCompensationService(config as any);

  beforeEach(() => {
    config.findEffective.mockImplementation(
      (type: StatutoryConfigType, _date: Date, state?: string) => {
        const configData =
          type === StatutoryConfigType.SALARY_STRUCTURE
            ? {
                basicGrossRate: 0.6,
                hraGrossRate: 0.32,
                conveyanceMonthly: 500,
                annualInsurance: 8940,
                incentiveGrossMonths: 1,
              }
            : type === StatutoryConfigType.PF
              ? { employeeRate: 0.12, employerRate: 0.13, wageCeiling: 15000 }
              : type === StatutoryConfigType.ESI
                ? {
                    employeeRate: 0.0075,
                    employerRate: 0.0325,
                    wageThreshold: 21000,
                  }
                : state === 'Karnataka'
                  ? {
                      slabs: [
                        { slabFrom: 0, slabTo: 24999.99, amount: 0 },
                        { slabFrom: 25000, slabTo: null, amount: 200 },
                      ],
                    }
                  : null;
        return Promise.resolve(configData ? ({ configData } as any) : null);
      },
    );
  });

  it('reproduces the confirmed ₹35,195 monthly CTC sample', async () => {
    const result = await service.calculate(35195, new Date('2026-08-19'));

    expect(result).toMatchObject({
      branch: 'PF_CAPPED',
      grossMonthly: '30000',
      basicMonthly: '18000',
      hraMonthly: '9600',
      conveyanceMonthly: '500',
      otherAllowanceMonthly: '1900',
      professionalTaxMonthly: '200',
      employeePfMonthly: '1800',
      employeeEsiMonthly: null,
      totalDeductionsMonthly: '2000',
      netSalaryMonthly: '28000',
      employerPfAnnual: '23400',
      insuranceAnnual: '8940',
      incentiveAnnual: '30000',
      totalEmolumentsAnnual: '422340',
    });
  });

  it('uses uncapped Basic for PF and applies ESI on a lower CTC', async () => {
    const result = await service.calculate(20000, new Date('2026-08-19'));
    const basic = new Prisma.Decimal(result.basicMonthly);

    expect(result.branch).toBe('PF_UNCAPPED');
    expect(basic.lt(15000)).toBe(true);
    expect(result.employeePfMonthly).toBe(
      basic.times(0.12).toDecimalPlaces(2).toString(),
    );
    expect(result.employeeEsiMonthly).not.toBeNull();
    expect(result.employerEsiMonthly).not.toBeNull();
  });

  it('fails honestly when an effective config is missing', async () => {
    config.findEffective.mockResolvedValueOnce(null);
    await expect(
      service.calculate(35195, new Date('2026-08-19')),
    ).rejects.toThrow('Statutory Config is missing');
  });

  describe('employer ESI inside the back-solve', () => {
    const asOf = new Date('2026-09-01');

    // A structure with no fixed insurance and no incentive month, so the CTC
    // this service solves is exactly the CTC the offer letter prints
    // (gross + employer PF + employer ESI). Under the arbitrary structure used
    // above, annualInsurance is a company cost the printed breakdown has no
    // row for, which would mask the property under test.
    beforeEach(() => {
      config.findEffective.mockImplementation(
        (type: StatutoryConfigType, _date: Date, state?: string) => {
          const configData =
            type === StatutoryConfigType.SALARY_STRUCTURE
              ? {
                  basicGrossRate: 0.5,
                  hraGrossRate: 0.2,
                  conveyanceMonthly: 0,
                  annualInsurance: 0,
                  incentiveGrossMonths: 0,
                }
              : type === StatutoryConfigType.PF
                ? { employeeRate: 0.12, employerRate: 0.12, wageCeiling: 15000 }
                : type === StatutoryConfigType.ESI
                  ? {
                      employeeRate: 0.0075,
                      employerRate: 0.0325,
                      wageThreshold: 21000,
                    }
                  : state === 'Karnataka'
                    ? {
                        slabs: [
                          { slabFrom: 0, slabTo: 24999.99, amount: 0 },
                          { slabFrom: 25000, slabTo: null, amount: 200 },
                        ],
                      }
                    : null;
          return Promise.resolve(configData ? ({ configData } as any) : null);
        },
      );
    });

    /** The CTC the offer letter's Grand Total actually prints. */
    const printedCtcAnnual = (result: {
      grossMonthly: string;
      employerPfMonthly: string;
      employerEsiMonthly: string | null;
      incentiveAnnual: string;
    }) =>
      new Prisma.Decimal(result.grossMonthly)
        .plus(result.employerPfMonthly)
        .plus(result.employerEsiMonthly ?? 0)
        .times(12)
        .plus(result.incentiveAnnual)
        .toString();

    it('counts employer ESI as a company cost, so the printed CTC equals the CTC offered', async () => {
      // Regression: employer ESI was left out of the solve but printed in the
      // Grand Total, so a ₹22,000/month offer printed ₹2,72,094/annum against
      // an agreed ₹2,64,000 — over-committing a whole year of employer ESI.
      const result = await service.calculate(22000, asOf);

      expect(result.employerEsiMonthly).toBe('654.46');
      expect(result.employerEsiAnnual).toBe('7853.52');
      expect(printedCtcAnnual(result)).toBe('264000');
      expect(result.totalEmolumentsAnnual).toBe('264000');
    });

    it('includes employer ESI in the annual contributions total', async () => {
      const result = await service.calculate(22000, asOf);

      const expected = new Prisma.Decimal(result.employerPfAnnual)
        .plus(result.employerEsiAnnual!)
        .plus(result.insuranceAnnual)
        .plus(result.incentiveAnnual);
      expect(result.totalCompanyContributionsAnnual).toBe(expected.toString());
    });

    it('keeps the employee inside ESI where both readings balance the same CTC', async () => {
      // ₹22,936/month sits in the band (roughly ₹22,260–₹22,942) where solving
      // WITH employer ESI yields a gross under the threshold and solving
      // WITHOUT it yields one over — both reconstruct the target exactly. The
      // covered reading wins rather than engineering the employee out of ESI.
      const result = await service.calculate(22936, asOf);

      expect(result.employerEsiMonthly).not.toBeNull();
      expect(result.grossMonthly).toBe('20994.05');
      expect(new Prisma.Decimal(result.grossMonthly).lte(21000)).toBe(true);
      expect(printedCtcAnnual(result)).toBe('275232');
    });

    it('drops ESI once no covered solution exists, still reconstructing the CTC exactly', async () => {
      const result = await service.calculate(22943, asOf);

      expect(result.employerEsiMonthly).toBeNull();
      expect(result.employerEsiAnnual).toBeNull();
      expect(result.grossMonthly).toBe('21644.34');
      expect(printedCtcAnnual(result)).toBe('275316');
    });

    it('rejects a CTC that the fixed insurance alone exceeds', async () => {
      config.findEffective.mockImplementation((type: StatutoryConfigType) =>
        Promise.resolve(
          type === StatutoryConfigType.SALARY_STRUCTURE
            ? ({
                configData: {
                  basicGrossRate: 0.5,
                  hraGrossRate: 0.2,
                  conveyanceMonthly: 0,
                  annualInsurance: 500000,
                  incentiveGrossMonths: 0,
                },
              } as any)
            : type === StatutoryConfigType.PF
              ? ({
                  configData: {
                    employeeRate: 0.12,
                    employerRate: 0.12,
                    wageCeiling: 15000,
                  },
                } as any)
              : type === StatutoryConfigType.ESI
                ? ({
                    configData: {
                      employeeRate: 0.0075,
                      employerRate: 0.0325,
                      wageThreshold: 21000,
                    },
                  } as any)
                : ({ configData: { slabs: [] } } as any),
        ),
      );

      await expect(service.calculate(10000, asOf)).rejects.toThrow(
        'Monthly CTC is too low',
      );
    });
  });
});
