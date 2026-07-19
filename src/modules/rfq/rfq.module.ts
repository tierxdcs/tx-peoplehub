import { Module } from '@nestjs/common';
import { SalesModule } from '../sales/sales.module';
import { BomModule } from '../bom/bom.module';
import { VaultModule } from '../vault/vault.module';
import { ScmPurchasingModule } from '../scm-purchasing/scm-purchasing.module';
import { RfqController } from './rfq.controller';
import { RfqPublicController } from './rfq-public.controller';
import { RfqService } from './rfq.service';
import { RfqPublicService } from './rfq-public.service';
import { RfqAccessService } from './rfq-access.service';

/**
 * RFQ Builder (SCM). Imports:
 *  - SalesModule: shared year-prefixed RFQ- numbering (SalesNumberingService)
 *  - BomModule: StockReportService, for the shortfall-to-RFQ trigger
 *  - VaultModule: VaultStorageService + guardrails, for quote attachments
 *  - ScmPurchasingModule: PurchaseOrderService, to pre-fill a DRAFT PO on award
 */
@Module({
  imports: [SalesModule, BomModule, VaultModule, ScmPurchasingModule],
  controllers: [RfqController, RfqPublicController],
  providers: [RfqService, RfqPublicService, RfqAccessService],
})
export class RfqModule {}
