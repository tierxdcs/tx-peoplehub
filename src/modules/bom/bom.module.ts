import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
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

/**
 * Bill of Materials + Item Master + Inventory + kickoff stock-availability.
 * R&D authors/heads own BOM + item technical data; Store (Production vertical)
 * owns inventory + reservations. Imports NotificationsModule for BOM-workflow
 * notifications.
 */
@Module({
  imports: [NotificationsModule],
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
  ],
  // Exported so the Purchasing/Stores module (Material Issue) can reuse the
  // single reservation-aware STOCK_OUT implementation and access rules.
  exports: [InventoryService, BomAccessService, StockReportService],
})
export class BomModule {}
