import { Module } from '@nestjs/common';
import { KanbanController } from './kanban.controller';
import { KanbanAccessService } from './kanban-access.service';
import { KanbanBoardsService } from './kanban-boards.service';
import { KanbanListsService } from './kanban-lists.service';
import { KanbanCardsService } from './kanban-cards.service';

/**
 * Kanban boards (Phase 1): boards, members, lists, sprints. Access is by
 * explicit board membership + SUPER_ADMIN override + Scrum-Master capability,
 * all decided in KanbanAccessService. Cards, comments/activity, and
 * notifications land in later phases.
 */
@Module({
  controllers: [KanbanController],
  providers: [
    KanbanAccessService,
    KanbanBoardsService,
    KanbanListsService,
    KanbanCardsService,
  ],
})
export class KanbanModule {}
