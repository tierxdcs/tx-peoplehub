import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { ExecutiveAccessService } from './executive-access.service';
import { SalesDashboardService } from './sales-dashboard.service';

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
}
