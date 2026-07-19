import { Module } from '@nestjs/common';
import { FinanceModule } from '../finance/finance.module';
import { ApController } from './ap.controller';
import { ApService } from './ap.service';

@Module({
  imports: [FinanceModule],
  controllers: [ApController],
  providers: [ApService],
})
export class FinanceApModule {}
