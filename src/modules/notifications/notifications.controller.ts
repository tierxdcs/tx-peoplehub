import { Controller, Get, Param, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { NotificationsService } from './notifications.service';
import { KanbanNotificationsService } from './kanban-notifications.service';

/**
 * Two distinct notification surfaces, both personal to the caller (no @Roles):
 *  - pending-counts: approval counters (things needing ACTION), role-scoped
 *    inside the service.
 *  - the generic in-app notifications (things worth KNOWING) — the caller's
 *    own list + read/unread management.
 */
@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly service: NotificationsService,
    private readonly kanban: KanbanNotificationsService,
  ) {}

  @Get('pending-counts')
  @ApiOperation({
    summary: 'Pending-approval counts across all surfaces for the caller',
  })
  getPendingCounts(@CurrentUser() user: AuthenticatedUser) {
    return this.service.getPendingCounts(user);
  }

  @Get('me')
  @ApiOperation({ summary: 'The caller’s in-app notifications, newest first' })
  listMine(@CurrentUser() user: AuthenticatedUser) {
    return this.kanban.listMine(user);
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Count of the caller’s unread notifications' })
  unreadCount(@CurrentUser() user: AuthenticatedUser) {
    return this.kanban.unreadCount(user);
  }

  @Patch('read-all')
  @ApiOperation({ summary: 'Mark all of the caller’s notifications read' })
  markAllRead(@CurrentUser() user: AuthenticatedUser) {
    return this.kanban.markAllRead(user);
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Mark one notification read (must be the caller’s)' })
  markRead(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.kanban.markRead(id, user);
  }
}
