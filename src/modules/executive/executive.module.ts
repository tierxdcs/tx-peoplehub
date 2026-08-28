import { Module } from '@nestjs/common';
import { ExecutiveController } from './executive.controller';
import { ExecutiveAccessService } from './executive-access.service';
import { SalesDashboardService } from './sales-dashboard.service';
import { OperationsDashboardService } from './operations-dashboard.service';
import { ScmDashboardService } from './scm-dashboard.service';
import { PlmModule } from '../plm/plm.module';
import { ProjectKickoffModule } from '../project-kickoff/project-kickoff.module';
import { LogisticsModule } from '../logistics/logistics.module';
import { ScmResourcePlanModule } from '../scm-resource-plan/scm-resource-plan.module';
import { ProjectManagementDashboardService } from './project-management-dashboard.service';

/**
 * The Executive Dashboards section. ExecutiveAccessService is exported so a
 * future Finance/Production dashboard — whether it lands here or in its own
 * module — reuses the single hasExecutiveDashboardAccess gate instead of
 * inventing a second access mechanism.
 *
 * The imported modules are the dashboards' sources of truth: they widen
 * PlmService/ProjectKickoffService's own scope and read OtdService's and
 * ScmResourcePlanService's own reports rather than recomputing project health,
 * blockers, delivery performance or cost variance. Nothing imports
 * ExecutiveModule but AppModule, so these are one-directional.
 */
@Module({
  imports: [
    PlmModule,
    ProjectKickoffModule,
    LogisticsModule,
    ScmResourcePlanModule,
  ],
  controllers: [ExecutiveController],
  providers: [
    ExecutiveAccessService,
    SalesDashboardService,
    OperationsDashboardService,
    ScmDashboardService,
    ProjectManagementDashboardService,
  ],
  exports: [ExecutiveAccessService],
})
export class ExecutiveModule {}
