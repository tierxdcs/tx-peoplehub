import { Module } from '@nestjs/common';
import { FinanceModule } from '../finance/finance.module';
import { ContraController } from './contra.controller';
import { ContraService } from './contra.service';

@Module({
  imports: [FinanceModule],
  controllers: [ContraController],
  providers: [ContraService],
})
export class FinanceContraModule {}
