import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { todayInTimezone } from '../../common/utils/date.util';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { LeaveBalancesService } from './leave-balances.service';

@ApiTags('leave-balances')
@ApiBearerAuth()
@Controller('leave-balances')
export class LeaveBalancesController {
  constructor(
    private readonly leaveBalancesService: LeaveBalancesService,
    private readonly config: ConfigService,
  ) {}

  @Get('me')
  @ApiOperation({ summary: 'Own current-year balances, all tracked types' })
  getOwn(@CurrentUser() user: AuthenticatedUser) {
    const timezone = this.config.get<string>('timezone') as string;
    const year = todayInTimezone(timezone).getUTCFullYear();
    return this.leaveBalancesService.getOwnBalances(user.id, year);
  }
}
