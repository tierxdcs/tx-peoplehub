import { Module } from '@nestjs/common';
import { FinanceAccessService } from './finance-access.service';
import { FinanceController } from './finance.controller';
import { FinanceService } from './finance.service';

@Module({
  controllers: [FinanceController],
  providers: [FinanceAccessService, FinanceService],
  exports: [FinanceAccessService, FinanceService],
})
export class FinanceModule {}
