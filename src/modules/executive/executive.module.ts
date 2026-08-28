import { Module } from '@nestjs/common';
import { ExecutiveController } from './executive.controller';
import { ExecutiveAccessService } from './executive-access.service';
import { SalesDashboardService } from './sales-dashboard.service';
import { OperationsDashboardService } from './operations-dashboard.service';
import { PlmModule } from '../plm/plm.module';
import { ProjectKickoffModule } from '../project-kickoff/project-kickoff.module';
import { LogisticsModule } from '../logistics/logistics.module';

/**
 * The Executive Dashboards section. ExecutiveAccessService is exported so a
 * future Finance/Production dashboard — whether it lands here or in its own
 * module — reuses the single hasExecutiveDashboardAccess gate instead of
 * inventing a second access mechanism.
 *
 * The imported modules are the Operations dashboard's sources of truth: it
 * widens PlmService/ProjectKickoffService's own scope and reads OtdService's own
 * report rather than recomputing project health, blockers or delivery
 * performance. Nothing imports ExecutiveModule but AppModule, so these are
 * one-directional.
 */
@Module({
  imports: [PlmModule, ProjectKickoffModule, LogisticsModule],
  controllers: [ExecutiveController],
  providers: [
    ExecutiveAccessService,
    SalesDashboardService,
    OperationsDashboardService,
  ],
  exports: [ExecutiveAccessService],
})
export class ExecutiveModule {}
