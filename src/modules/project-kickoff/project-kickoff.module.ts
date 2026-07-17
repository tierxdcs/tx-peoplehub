import { Module } from '@nestjs/common';
import { SalesModule } from '../sales/sales.module';
import { KanbanModule } from '../kanban/kanban.module';
import { ProjectKickoffController } from './project-kickoff.controller';
import { ProjectKickoffService } from './project-kickoff.service';
import { ProjectKickoffAccessService } from './project-kickoff-access.service';

/**
 * Project Kickoff: a structured record created once an Order's Confirmation
 * Sheet is EXECUTED. Imports SalesModule for the reused EXECUTED gate
 * (ConfirmationSheetsService) and KanbanModule for privileged internal board
 * provisioning (KanbanBoardsService).
 */
@Module({
  imports: [SalesModule, KanbanModule],
  controllers: [ProjectKickoffController],
  providers: [ProjectKickoffService, ProjectKickoffAccessService],
})
export class ProjectKickoffModule {}
