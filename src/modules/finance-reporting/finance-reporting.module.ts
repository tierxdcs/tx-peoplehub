import { Module } from '@nestjs/common';
import { FinanceModule } from '../finance/finance.module';
import { ReportingController } from './reporting.controller';
import { ReportingService } from './reporting.service';
@Module({
  imports: [FinanceModule],
  controllers: [ReportingController],
  providers: [ReportingService],
})
export class FinanceReportingModule {}
