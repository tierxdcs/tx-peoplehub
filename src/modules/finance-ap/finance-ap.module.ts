import { Module } from '@nestjs/common';
import { FinanceModule } from '../finance/finance.module';
import { VaultModule } from '../vault/vault.module';
import { ApController } from './ap.controller';
import { ApService } from './ap.service';

@Module({
  imports: [FinanceModule, VaultModule],
  controllers: [ApController],
  providers: [ApService],
  // Exported so Stores can raise the advance-payment request when a PO carrying
  // an advance commitment is issued, reusing this module's payment numbering and
  // lifecycle rather than writing a second kind of payable.
  exports: [ApService],
})
export class FinanceApModule {}
