import { Module, forwardRef } from '@nestjs/common';
import { LeaveModule } from '../leave/leave.module';
import { EmployeesModule } from '../employees/employees.module';
import { OfferLettersModule } from '../offer-letters/offer-letters.module';
import { ProvisioningModule } from '../provisioning/provisioning.module';
import { SalesModule } from '../sales/sales.module';
import { CandidateRequisitionsModule } from '../candidate-requisitions/candidate-requisitions.module';
import { BomModule } from '../bom/bom.module';
import { ExpenseClaimsModule } from '../expense-claims/expense-claims.module';
import { ScmPurchasingModule } from '../scm-purchasing/scm-purchasing.module';
import { DesignModule } from '../design/design.module';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { KanbanNotificationsService } from './kanban-notifications.service';

/**
 * Two notification surfaces: the cross-cutting approval COUNTERS
 * (NotificationsService, reusing each module's scoped queries) and the generic
 * in-app NOTIFICATIONS (KanbanNotificationsService). The latter is exported so
 * KanbanModule's write-paths can create notifications on card events.
 */
@Module({
  // BomModule imports NotificationsModule (BOM-workflow notifications) and
  // ScmPurchasingModule reaches it through BomModule, so both of those edges
  // are cycles and need forwardRef on this side (BomModule mirrors it).
  imports: [
    LeaveModule,
    EmployeesModule,
    SalesModule,
    OfferLettersModule,
    ProvisioningModule,
    CandidateRequisitionsModule,
    ExpenseClaimsModule,
    DesignModule,
    forwardRef(() => BomModule),
    forwardRef(() => ScmPurchasingModule),
  ],
  controllers: [NotificationsController],
  providers: [NotificationsService, KanbanNotificationsService],
  exports: [KanbanNotificationsService],
})
export class NotificationsModule {}
