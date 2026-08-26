import { Module } from '@nestjs/common';
import { ExecutiveController } from './executive.controller';
import { ExecutiveAccessService } from './executive-access.service';
import { SalesDashboardService } from './sales-dashboard.service';

/**
 * The Executive Dashboards section. ExecutiveAccessService is exported so a
 * future Finance/Production dashboard — whether it lands here or in its own
 * module — reuses the single hasExecutiveDashboardAccess gate instead of
 * inventing a second access mechanism.
 */
@Module({
  controllers: [ExecutiveController],
  providers: [ExecutiveAccessService, SalesDashboardService],
  exports: [ExecutiveAccessService],
})
export class ExecutiveModule {}
