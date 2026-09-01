import { Module, forwardRef } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { SalesModule } from '../sales/sales.module';
import { BomAccessService } from './bom-access.service';
import { ItemService } from './item.service';
import { BomService } from './bom.service';
import { InventoryService } from './inventory.service';
import { StockReportService } from './stock-report.service';
import { ItemController } from './item.controller';
import { BomController } from './bom.controller';
import { ItemBomsController } from './item-boms.controller';
import { InventoryController } from './inventory.controller';
import { KickoffStockController } from './kickoff-stock.controller';
import { FinanceModule } from '../finance/finance.module';
import { ItemCostService } from './item-cost.service';
import { BomCostSnapshotService } from './bom-cost-snapshot.service';
import { ProductCatalogPriceService } from './product-catalog-price.service';

/**
 * Bill of Materials + Item Master + Inventory + kickoff stock-availability.
 * R&D authors/heads own BOM + item technical data; Store (Production vertical)
 * owns inventory + reservations. Imports NotificationsModule for BOM-workflow
 * notifications, and SalesModule for the shared SalesNumberingService (item
 * codes reuse the same sales_sequences-backed mechanism as Bids/Orders/POs).
 */
@Module({
  // NotificationsModule's pending-approval badges call BomService, so this
  // edge is a cycle — forwardRef on both sides.
  imports: [forwardRef(() => NotificationsModule), SalesModule, FinanceModule],
  controllers: [
    ItemController,
    BomController,
    ItemBomsController,
    InventoryController,
    KickoffStockController,
  ],
  providers: [
    BomAccessService,
    ItemService,
    BomService,
    InventoryService,
    StockReportService,
    ItemCostService,
    BomCostSnapshotService,
    ProductCatalogPriceService,
  ],
  // Exported so the Purchasing/Stores module (Material Issue) can reuse the
  // single reservation-aware STOCK_OUT implementation and access rules, and so
  // SCM Resource Planning can reuse leaf costing + the amended cost-view gate.
  exports: [
    BomService,
    InventoryService,
    BomAccessService,
    StockReportService,
    ItemCostService,
    BomCostSnapshotService,
  ],
})
export class BomModule {}
