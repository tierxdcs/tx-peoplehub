import { Module } from '@nestjs/common';
import { SalesModule } from '../sales/sales.module';
import { BomModule } from '../bom/bom.module';
import { PurchaseOrderController } from './purchase-order.controller';
import { PurchaseOrderService } from './purchase-order.service';
import { PurchasingAccessService } from './purchasing-access.service';
import { GoodsReceiptNoteController } from './goods-receipt-note.controller';
import { GoodsReceiptNoteService } from './goods-receipt-note.service';
import { NonConformanceReportController } from './non-conformance-report.controller';
import { NonConformanceReportService } from './non-conformance-report.service';
import { GrnAccessService } from './grn-access.service';
import { MaterialIndentController } from './material-indent.controller';
import { MaterialIssueController } from './material-issue.controller';
import { MaterialService } from './material.service';

/**
 * Purchasing (Stores). Phase 1: Purchase Orders. Phase 2: Goods Receipt Notes,
 * the QC inspection gate, and Non-Conformance Reports. Phase 3: Material Indent
 * + Issue. Imports SalesModule for the shared year-prefixed PO-/GRN-/NCR-/IND-/
 * MIN-#### sequences, and BomModule to reuse InventoryService's single
 * reservation-aware STOCK_OUT implementation for material issuing.
 */
@Module({
  imports: [SalesModule, BomModule],
  controllers: [
    PurchaseOrderController,
    GoodsReceiptNoteController,
    NonConformanceReportController,
    MaterialIndentController,
    MaterialIssueController,
  ],
  providers: [
    PurchaseOrderService,
    PurchasingAccessService,
    GoodsReceiptNoteService,
    NonConformanceReportService,
    GrnAccessService,
    MaterialService,
  ],
  // Exported so the RFQ module can pre-fill a DRAFT PurchaseOrder from an
  // awarded quote (reusing create() rather than duplicating PO logic).
  exports: [PurchaseOrderService],
})
export class ScmPurchasingModule {}
