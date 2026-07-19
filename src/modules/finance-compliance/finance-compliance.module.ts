import { Module } from '@nestjs/common';
import { FinanceModule } from '../finance/finance.module';
import { ComplianceController } from './compliance.controller';
import { ComplianceService } from './compliance.service';
import { FilingsController } from './filings.controller';
import { FilingsService } from './filings.service';
import { VaultModule } from '../vault/vault.module';
import { CloseControlsController } from './close-controls.controller';
import { CloseControlsService } from './close-controls.service';

@Module({
  imports: [FinanceModule, VaultModule],
  controllers: [ComplianceController, FilingsController, CloseControlsController],
  providers: [ComplianceService, FilingsService, CloseControlsService],
})
export class FinanceComplianceModule {}
