import { Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { LeaveAccrualService } from './leave-accrual.service';

/**
 * Manual trigger for the same monthly EL accrual logic the cron job calls
 * — not part of the original spec's endpoint table, added so the
 * accrual job (this codebase's first background job) can be verified
 * end-to-end without waiting for a real month boundary.
 */
@ApiTags('leave-accrual')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Controller('leave-accrual')
export class LeaveAccrualController {
  constructor(private readonly leaveAccrualService: LeaveAccrualService) {}

  @Post('run')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Manually run the monthly EL accrual job' })
  run() {
    return this.leaveAccrualService.run(new Date());
  }
}
