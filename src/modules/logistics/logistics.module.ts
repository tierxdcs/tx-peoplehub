import { Module } from '@nestjs/common';
import { SalesModule } from '../sales/sales.module';
import { BomModule } from '../bom/bom.module';
import { FinanceArModule } from '../finance-ar/finance-ar.module';
import { VaultModule } from '../vault/vault.module';
import { DeliveryChallanController } from './delivery-challan.controller';
import { DeliveryChallanService } from './delivery-challan.service';
import { DispatchAccessService } from './dispatch-access.service';
import { OtdController } from './otd.controller';
import { OtdService } from './otd.service';

/**
 * Logistics & Dispatch — Delivery Challans for outbound shipments.
 * Imports:
 *  - SalesModule: shared year-prefixed DC- numbering (SalesNumberingService)
 *  - BomModule: InventoryService, for the single reservation-free STOCK_OUT
 *    ledger implementation on dispatch
 *  - FinanceArModule: ArService, to seed DRAFT invoices module-to-module
 *  - VaultModule: VaultStorageService, for R2-backed POD upload/download
 */
@Module({
  imports: [SalesModule, BomModule, FinanceArModule, VaultModule],
  controllers: [DeliveryChallanController, OtdController],
  providers: [DeliveryChallanService, DispatchAccessService, OtdService],
})
export class LogisticsModule {}
