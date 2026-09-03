import { Module } from '@nestjs/common';
import { StatutoryConfigController } from './statutory-config.controller';
import { StatutoryConfigService } from './statutory-config.service';
import { SalaryStructuresController } from './salary-structures.controller';
import { SalaryStructuresService } from './salary-structures.service';
import { PayrollComputationService } from './payroll-computation.service';
import { PayrollRunsController } from './payroll-runs.controller';
import { PayrollRunsService } from './payroll-runs.service';
import { PayslipsController } from './payslips.controller';
import { PayslipsService } from './payslips.service';
import { OnboardingCompensationService } from './onboarding-compensation.service';
import { FinanceModule } from '../finance/finance.module';
import { FinancePayrollController } from './finance-payroll.controller';

@Module({
  imports: [FinanceModule],
  controllers: [
    StatutoryConfigController,
    SalaryStructuresController,
    PayrollRunsController,
    PayslipsController,
    FinancePayrollController,
  ],
  providers: [
    StatutoryConfigService,
    SalaryStructuresService,
    PayrollComputationService,
    PayrollRunsService,
    PayslipsService,
    OnboardingCompensationService,
  ],
  exports: [
    SalaryStructuresService,
    PayrollComputationService,
    OnboardingCompensationService,
  ],
})
export class PayrollModule {}
