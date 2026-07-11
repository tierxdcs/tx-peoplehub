import { Module } from '@nestjs/common';
import { EmployeesModule } from '../employees/employees.module';
import { VaultModule } from '../vault/vault.module';
import { SalesAccessService } from './common/sales-access.service';
import { SalesNumberingService } from './common/sales-numbering.service';
import { ApprovalRoutingService } from './common/approval-routing.service';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';
import { LeadsController } from './leads.controller';
import { LeadsService } from './leads.service';
import { OpportunitiesController } from './opportunities.controller';
import { OpportunitiesService } from './opportunities.service';
import { TaxConfigController } from './tax-config.controller';
import { TaxConfigService } from './tax-config.service';
import { BidsController } from './bids.controller';
import { BidsService } from './bids.service';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { BidAssessmentQuestionsController } from './bid-assessment-questions.controller';
import { BidAssessmentQuestionsService } from './bid-assessment-questions.service';
import { BidAssessmentsController } from './bid-assessments.controller';
import { BidAssessmentsService } from './bid-assessments.service';
import { ConfirmationSheetsController } from './confirmation-sheets.controller';
import { ConfirmationSheetsService } from './confirmation-sheets.service';

/**
 * Sales pipeline: Customer/Product master data → Lead → Opportunity →
 * Bid/No-Bid decision gate → Bid (discount approval + tax) → Order. Imports
 * EmployeesModule for the recursive-hierarchy getTeam used by
 * SalesAccessService's manager scoping.
 */
@Module({
  imports: [EmployeesModule, VaultModule],
  controllers: [
    CustomersController,
    ProductsController,
    LeadsController,
    OpportunitiesController,
    TaxConfigController,
    BidAssessmentQuestionsController,
    BidAssessmentsController,
    BidsController,
    OrdersController,
    ConfirmationSheetsController,
  ],
  providers: [
    SalesAccessService,
    SalesNumberingService,
    ApprovalRoutingService,
    CustomersService,
    ProductsService,
    LeadsService,
    OpportunitiesService,
    TaxConfigService,
    BidAssessmentQuestionsService,
    BidAssessmentsService,
    BidsService,
    OrdersService,
    ConfirmationSheetsService,
  ],
})
export class SalesModule {}
