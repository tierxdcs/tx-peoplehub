import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { VaultModule } from '../vault/vault.module';
import { KanbanController } from './kanban.controller';
import { KanbanAccessService } from './kanban-access.service';
import { KanbanBoardsService } from './kanban-boards.service';
import { KanbanListsService } from './kanban-lists.service';
import { KanbanCardsService } from './kanban-cards.service';
import { KanbanActivityService } from './kanban-activity.service';
import { KanbanFeedService } from './kanban-feed.service';
import { KanbanLabelsService } from './kanban-labels.service';
import { KanbanAttachmentsService } from './kanban-attachments.service';
import { KanbanBoardProvisioningService } from './kanban-board-provisioning.service';

/**
 * Kanban boards (Phase 1): boards, members, lists, sprints. Access is by
 * explicit board membership + SUPER_ADMIN override + Scrum-Master capability,
 * all decided in KanbanAccessService. Cards, comments/activity, and
 * notifications land in later phases.
 */
@Module({
  imports: [NotificationsModule, VaultModule],
  controllers: [KanbanController],
  providers: [
    KanbanAccessService,
    KanbanBoardsService,
    KanbanListsService,
    KanbanCardsService,
    KanbanActivityService,
    KanbanFeedService,
    KanbanLabelsService,
    KanbanAttachmentsService,
    KanbanBoardProvisioningService,
  ],
  // KanbanBoardsService is exported for privileged internal provisioning by the
  // Project Kickoff module (auto-created project board + action-item cards).
  exports: [KanbanBoardsService],
})
export class KanbanModule {}
