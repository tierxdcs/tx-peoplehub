import { Module } from '@nestjs/common';
import { LeaveModule } from '../leave/leave.module';
import { EmployeesModule } from '../employees/employees.module';
import { SalesModule } from '../sales/sales.module';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

/**
 * Cross-cutting notification counters. Imports the modules that own each
 * approval surface and reuses their services' count helpers — no scoping
 * logic is reimplemented here.
 */
@Module({
  imports: [LeaveModule, EmployeesModule, SalesModule],
  controllers: [NotificationsController],
  providers: [NotificationsService],
})
export class NotificationsModule {}
