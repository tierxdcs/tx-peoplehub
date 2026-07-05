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

@Module({
  controllers: [
    StatutoryConfigController,
    SalaryStructuresController,
    PayrollRunsController,
    PayslipsController,
  ],
  providers: [
    StatutoryConfigService,
    SalaryStructuresService,
    PayrollComputationService,
    PayrollRunsService,
    PayslipsService,
  ],
  exports: [SalaryStructuresService],
})
export class PayrollModule {}
