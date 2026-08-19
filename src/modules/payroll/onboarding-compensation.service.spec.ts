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
});
