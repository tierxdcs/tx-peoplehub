import { Module } from '@nestjs/common';
import { FinanceModule } from '../finance/finance.module';
import { ManagementController } from './management.controller';
import { ManagementService } from './management.service';
@Module({
  imports: [FinanceModule],
  controllers: [ManagementController],
  providers: [ManagementService],
})
export class FinanceManagementModule {}
