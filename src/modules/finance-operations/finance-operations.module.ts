import { Module } from '@nestjs/common';
import { FinanceModule } from '../finance/finance.module';
import { OperationsController } from './operations.controller';
import { OperationsService } from './operations.service';
@Module({
  imports: [FinanceModule],
  controllers: [OperationsController],
  providers: [OperationsService],
})
export class FinanceOperationsModule {}
