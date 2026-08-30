import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { ExecutiveAccessService } from './executive-access.service';
import { SalesDashboardService } from './sales-dashboard.service';
import { OperationsDashboardService } from './operations-dashboard.service';
import { ScmDashboardService } from './scm-dashboard.service';
import { ProjectManagementDashboardService } from './project-management-dashboard.service';

/**
 * The Executive Dashboards section. One controller, one gate: every route here
 * calls ExecutiveAccessService.assertAccess first, so adding the planned Finance
 * or Production dashboard means adding a @Get('dashboards/<name>') below — not a
 * new permission, guard, or flag.
 *
 * No @Roles decorator on purpose: the grant is a per-employee flag that cuts
 * across roles and verticals, which a role list cannot express.
 */
@ApiTags('executive')
@ApiBearerAuth()
@Controller('executive')
export class ExecutiveController {
  constructor(
    private readonly access: ExecutiveAccessService,
    private readonly salesDashboard: SalesDashboardService,
    private readonly operationsDashboard: OperationsDashboardService,
    private readonly scmDashboard: ScmDashboardService,
    private readonly projectManagementDashboard: ProjectManagementDashboardService,
  ) {}

  @Get('access')
  @ApiOperation({
    summary:
      'Whether the caller may see the Executive Dashboards section — drives sidebar visibility',
  })
  async getAccess(@CurrentUser() user: AuthenticatedUser) {
    return { hasExecutiveDashboardAccess: await this.access.hasAccess(user) };
  }

  @Get('dashboards/sales')
  @ApiOperation({
    summary:
      'Executive Sales dashboard: booked vs recognised revenue, margin, funnel, cash, customers and BU split for the current fiscal year',
  })
  async sales(@CurrentUser() user: AuthenticatedUser) {
    await this.access.assertAccess(user);
    return this.salesDashboard.build();
  }

  @Get('dashboards/operations')
  @ApiOperation({
    summary:
      'Executive Operations dashboard: company-wide project health, delivery urgency, blockers, PLM stage funnel, OTD, design stage gates, vendor cadence and procurement cycle health — deliberately no revenue, margin, cash flow or receivables',
  })
  async operations(@CurrentUser() user: AuthenticatedUser) {
    await this.access.assertAccess(user);
    return this.operationsDashboard.build(user);
  }

  @Get('dashboards/scm')
  @ApiOperation({
    summary:
      'Executive SCM dashboard: RFQ and purchase-order health, vendor/supplier base and classification overrides, vendor-executed project detail, sourcing backlog, resource-plan cost variance, vendor-caused quality and quoted lead-time trend — deliberately no revenue, margin or customer data',
  })
  async scm(@CurrentUser() user: AuthenticatedUser) {
    await this.access.assertAccess(user);
    return this.scmDashboard.build(user);
  }

  @Get('dashboards/project-management')
  @ApiOperation({
    summary:
      'Executive Project Management dashboard: PM-attributed project health, blockers, delivery, workload and kickoff readiness',
  })
  async projectManagement(@CurrentUser() user: AuthenticatedUser) {
    await this.access.assertAccess(user);
    return this.projectManagementDashboard.build();
  }
}
