import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { CreateLeaveRequestDto } from './dto/create-leave-request.dto';
import { RejectLeaveRequestDto } from './dto/reject-leave-request.dto';
import { LeaveRequestsService } from './leave-requests.service';

/**
 * Route order matters: /pending-approval must be declared before
 * @Get(':id')-style routes so it isn't swallowed by the :id param — same
 * convention as employees.controller.ts.
 */
@ApiTags('leave-requests')
@ApiBearerAuth()
@Controller('leave-requests')
export class LeaveRequestsController {
  constructor(private readonly leaveRequestsService: LeaveRequestsService) {}

  @Post()
  @ApiOperation({ summary: 'Submit a leave request' })
  create(
    @Body() dto: CreateLeaveRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.leaveRequestsService.create(dto, user);
  }

  @Get('me')
  @ApiOperation({ summary: 'Own leave request history' })
  getOwn(
    @Query() query: PaginationQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.leaveRequestsService.getOwn(user.id, query);
  }

  @Get('pending-approval')
  @ApiOperation({
    summary:
      'Requests awaiting the caller’s approval (Manager: direct reports; Admin: company-wide)',
  })
  getPendingApproval(
    @Query() query: PaginationQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.leaveRequestsService.getPendingApproval(user, query);
  }

  @Patch(':id/approve')
  @ApiOperation({ summary: 'Approve a pending leave request, deduct balance' })
  approve(
    @Param('id') id: string,
    @Body() dto: RejectLeaveRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.leaveRequestsService.approve(id, user, dto.approverComments);
  }

  @Patch(':id/reject')
  @ApiOperation({
    summary: 'Reject a pending leave request, no balance change',
  })
  reject(
    @Param('id') id: string,
    @Body() dto: RejectLeaveRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.leaveRequestsService.reject(id, user, dto.approverComments);
  }

  @Patch(':id/cancel')
  @ApiOperation({
    summary:
      'Cancel a request before its startDate; restores balance if it was approved',
  })
  cancel(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.leaveRequestsService.cancel(id, user);
  }
}
