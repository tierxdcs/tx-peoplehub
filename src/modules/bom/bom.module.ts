import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { BomAccessService } from './bom-access.service';
import { ItemService } from './item.service';
import { BomService } from './bom.service';
import { InventoryService } from './inventory.service';
import { StockReportService } from './stock-report.service';
import { ItemController } from './item.controller';
import { BomController } from './bom.controller';
import { ProductBomsController } from './product-boms.controller';
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
    ProductBomsController,
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
})
export class BomModule {}
