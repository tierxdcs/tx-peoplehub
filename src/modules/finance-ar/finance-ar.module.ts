import { Module } from '@nestjs/common';
import { FinanceModule } from '../finance/finance.module';
import { SalesModule } from '../sales/sales.module';
import { ArController } from './ar.controller';
import { ArService } from './ar.service';
import { GstGatewayService } from './gst-gateway.service';

// Imports SalesModule for the shared year-prefixed SalesNumberingService
// (INV-/RCT- document numbers). Exports ArService so the Logistics & Dispatch
// module can seed DRAFT invoices module-to-module (createDraftInvoiceFromDispatch)
// without exposing invoice creation to non-finance HTTP callers.
@Module({
  imports: [FinanceModule, SalesModule],
  controllers: [ArController],
  providers: [ArService, GstGatewayService],
  exports: [ArService],
})
export class FinanceArModule {}
