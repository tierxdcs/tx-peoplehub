import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { NotificationsService } from './notifications.service';

/**
 * In-app notification counters. No @Roles gate — every authenticated user may
 * ask for their own counts; each category is role-scoped inside the service
 * (0 for categories that don't apply), so the response is safe for any role.
 */
@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly service: NotificationsService) {}

  @Get('pending-counts')
  @ApiOperation({
    summary: "Pending-approval counts across all surfaces for the caller",
  })
  getPendingCounts(@CurrentUser() user: AuthenticatedUser) {
    return this.service.getPendingCounts(user);
  }
}
