import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { AuthenticatedUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { BidStrategyMeetingsService } from './bid-strategy-meetings.service';
import { CreateBidStrategyMeetingDto, UpdateBidStrategyActionStatusDto } from './dto/bid-strategy-meeting.dto';

@ApiTags('bid-strategy-meetings')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles(Role.MANAGER, Role.EMPLOYEE, Role.SUPER_ADMIN)
@Controller('bids/:bidId/strategy-meetings')
export class BidStrategyMeetingsController {
  constructor(private readonly service: BidStrategyMeetingsService) {}

  @Get()
  list(@Param('bidId') bidId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.list(bidId, user);
  }

  @Get('employee-options')
  employeeOptions(@Param('bidId') bidId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.employeeOptions(bidId, user);
  }

  @Post()
  create(@Param('bidId') bidId: string, @Body() dto: CreateBidStrategyMeetingDto, @CurrentUser() user: AuthenticatedUser) {
    return this.service.create(bidId, dto, user);
  }

  @Patch('action-items/:actionItemId/status')
  updateActionStatus(@Param('bidId') bidId: string, @Param('actionItemId') actionItemId: string, @Body() dto: UpdateBidStrategyActionStatusDto, @CurrentUser() user: AuthenticatedUser) {
    return this.service.updateActionStatus(bidId, actionItemId, dto, user);
  }
}
