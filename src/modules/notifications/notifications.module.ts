import { Module } from '@nestjs/common';
import { LeaveModule } from '../leave/leave.module';
import { EmployeesModule } from '../employees/employees.module';
import { SalesModule } from '../sales/sales.module';
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
  imports: [LeaveModule, EmployeesModule, SalesModule],
  controllers: [NotificationsController],
  providers: [NotificationsService, KanbanNotificationsService],
  exports: [KanbanNotificationsService],
})
export class NotificationsModule {}
