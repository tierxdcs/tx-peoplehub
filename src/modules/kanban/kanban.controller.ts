import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { KanbanBoardsService } from './kanban-boards.service';
import { KanbanListsService } from './kanban-lists.service';
import { KanbanCardsService } from './kanban-cards.service';
import { KanbanFeedService } from './kanban-feed.service';
import { KanbanLabelsService } from './kanban-labels.service';
import { KanbanAttachmentsService } from './kanban-attachments.service';
import {
  AddBoardMemberDto,
  CardFilterQueryDto,
  ConfirmAttachmentDto,
  CreateAttachmentUploadUrlDto,
  CreateBoardDto,
  CreateCardDto,
  CreateCommentDto,
  CreateLabelDto,
  CreateListDto,
  CreateSprintDto,
  MoveCardDto,
  ReorderListDto,
  SetCardSprintDto,
  UpdateCardDto,
  UpdateLabelDto,
  UpdateListDto,
} from './dto/kanban.dto';

/**
 * Kanban Phase 1: boards, members, lists, sprints. Board access is by explicit
 * membership (+ SUPER_ADMIN override) — enforced in the service layer via
 * KanbanAccessService, since RolesGuard can't express "member of THIS board".
 * ADMIN is excluded by default (account-management-only), so it's not in the
 * @Roles set; it can still be added to a board as an ordinary member and would
 * then reach these routes — but the class guard keeps plain ADMINs out unless
 * a board explicitly includes them. (SUPER_ADMIN + all Sales-capable roles are
 * allowed through the guard; membership does the real gating.)
 */
@ApiTags('kanban')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles(Role.MANAGER, Role.EMPLOYEE, Role.ADMIN, Role.SUPER_ADMIN)
@Controller('kanban')
export class KanbanController {
  constructor(
    private readonly boards: KanbanBoardsService,
    private readonly lists: KanbanListsService,
    private readonly cards: KanbanCardsService,
    private readonly feed: KanbanFeedService,
    private readonly labels: KanbanLabelsService,
    private readonly attachments: KanbanAttachmentsService,
  ) {}

  // ── Boards ─────────────────────────────────────────────────────────
  @Post('boards')
  @ApiOperation({ summary: 'Create a board (Scrum Master / SUPER_ADMIN)' })
  createBoard(
    @Body() dto: CreateBoardDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.boards.create(dto, user);
  }

  @Get('boards')
  @ApiOperation({ summary: 'Boards the caller can access' })
  listBoards(@CurrentUser() user: AuthenticatedUser) {
    return this.boards.findAll(user);
  }

  @Get('boards/:id')
  @ApiOperation({ summary: 'One board (member or SUPER_ADMIN)' })
  getBoard(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.boards.findOne(id, user);
  }

  @Delete('boards/:id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Archive a board (Scrum Master / SUPER_ADMIN)' })
  async archiveBoard(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.boards.archive(id, user);
  }

  // ── Members ────────────────────────────────────────────────────────
  @Get('boards/:id/members')
  @ApiOperation({ summary: 'List a board’s members' })
  listMembers(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.boards.listMembers(id, user);
  }

  @Post('boards/:id/members')
  @ApiOperation({ summary: 'Add a board member (Scrum Master / SUPER_ADMIN)' })
  addMember(
    @Param('id') id: string,
    @Body() dto: AddBoardMemberDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.boards.addMember(id, dto, user);
  }

  @Delete('boards/:id/members/:employeeId')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Remove a board member (Scrum Master / SUPER_ADMIN)',
  })
  async removeMember(
    @Param('id') id: string,
    @Param('employeeId') employeeId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.boards.removeMember(id, employeeId, user);
  }

  // ── Lists ──────────────────────────────────────────────────────────
  @Get('boards/:id/lists')
  @ApiOperation({ summary: 'Lists on a board (any member)' })
  listLists(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.lists.listLists(id, user);
  }

  @Post('boards/:id/lists')
  @ApiOperation({ summary: 'Create a list (Scrum Master / SUPER_ADMIN)' })
  createList(
    @Param('id') id: string,
    @Body() dto: CreateListDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.lists.createList(id, dto, user);
  }

  @Patch('lists/:id')
  @ApiOperation({
    summary: 'Edit a list name / done-flag (Scrum Master / SUPER_ADMIN)',
  })
  updateList(
    @Param('id') id: string,
    @Body() dto: UpdateListDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.lists.updateList(id, dto, user);
  }

  @Patch('lists/:id/reorder')
  @ApiOperation({
    summary: 'Reorder a list within its board (Scrum Master / SUPER_ADMIN)',
  })
  reorderList(
    @Param('id') id: string,
    @Body() dto: ReorderListDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.lists.reorderList(id, dto, user);
  }

  @Delete('lists/:id')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Delete an empty non-done list (Scrum Master / SUPER_ADMIN)',
  })
  async deleteList(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.lists.deleteList(id, user);
  }

  @Get('done-list-backfill-report')
  @ApiOperation({
    summary: 'Review done-list choices made by the migration (SUPER_ADMIN)',
  })
  doneListBackfillReport(@CurrentUser() user: AuthenticatedUser) {
    return this.boards.doneListBackfillReport(user);
  }

  // ── Sprints ────────────────────────────────────────────────────────
  @Get('sprints')
  @ApiOperation({
    summary:
      'Sprints across every board the caller can view, grouped by computed status (optional boardId filter)',
  })
  listAllSprints(
    @CurrentUser() user: AuthenticatedUser,
    @Query('boardId') boardId?: string,
  ) {
    return this.lists.listAllSprints(user, boardId);
  }

  @Get('boards/:id/sprints')
  @ApiOperation({ summary: 'Sprints on a board (any member)' })
  listSprints(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.lists.listSprints(id, user);
  }

  @Post('boards/:id/sprints')
  @ApiOperation({ summary: 'Create a sprint (Scrum Master / SUPER_ADMIN)' })
  createSprint(
    @Param('id') id: string,
    @Body() dto: CreateSprintDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.lists.createSprint(id, dto, user);
  }

  // ── Cards ──────────────────────────────────────────────────────────
  @Get('boards/:id/cards')
  @ApiOperation({
    summary:
      'Board-wide card search with filters (dueBefore/dueAfter/createdBy/sprintId/assigneeId/priority) — any member',
  })
  listBoardCards(
    @Param('id') id: string,
    @Query() query: CardFilterQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.cards.listBoardCards(id, query, user);
  }

  @Get('boards/:id/vertical-progress')
  @ApiOperation({
    summary:
      'Per-vertical completion for a board (cards done/total by vertical) — any member',
  })
  boardVerticalProgress(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.cards.boardVerticalProgress(id, user);
  }

  @Get('lists/:listId/cards')
  @ApiOperation({ summary: 'Cards in a list (any board member)' })
  listCards(
    @Param('listId') listId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.cards.listCards(listId, user);
  }

  @Post('lists/:listId/cards')
  @ApiOperation({ summary: 'Create a card (any board member)' })
  createCard(
    @Param('listId') listId: string,
    @Body() dto: CreateCardDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.cards.create(listId, dto, user);
  }

  // Static route declared BEFORE cards/:id so 'mine' isn't captured as an :id.
  @Get('cards/mine')
  @ApiOperation({
    summary:
      'Active cards assigned to the current user across all boards (personal dashboard)',
  })
  myCards(@CurrentUser() user: AuthenticatedUser) {
    return this.cards.myCards(user);
  }

  @Get('cards/:id')
  @ApiOperation({
    summary: 'One card by id, with boardId for deep-linking (any board member)',
  })
  getCard(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.cards.findOne(id, user);
  }

  @Patch('cards/:id')
  @ApiOperation({
    summary:
      'Edit a card (title/description/priority/dates/assignee) — any member. sprintId is NOT accepted here.',
  })
  updateCard(
    @Param('id') id: string,
    @Body() dto: UpdateCardDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.cards.update(id, dto, user);
  }

  @Patch('cards/:id/move')
  @ApiOperation({ summary: 'Move a card to a list + fractional position' })
  moveCard(
    @Param('id') id: string,
    @Body() dto: MoveCardDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.cards.move(id, dto, user);
  }

  @Patch('cards/:id/sprint')
  @ApiOperation({
    summary:
      'Assign/clear a card’s sprint (Scrum Master / SUPER_ADMIN, member of the board)',
  })
  setCardSprint(
    @Param('id') id: string,
    @Body() dto: SetCardSprintDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.cards.setSprint(id, dto, user);
  }

  @Delete('cards/:id')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Archive a card (creator or Scrum Master / SUPER_ADMIN)',
  })
  async archiveCard(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.cards.archive(id, user);
  }

  // ── Comments + feed ────────────────────────────────────────────────
  @Post('cards/:id/comments')
  @ApiOperation({ summary: 'Comment on a card (any board member)' })
  addComment(
    @Param('id') id: string,
    @Body() dto: CreateCommentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.feed.addComment(id, dto, user);
  }

  @Delete('cards/:id/comments/:commentId')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Delete a comment (author or managing Scrum Master / SUPER_ADMIN)',
  })
  async deleteComment(
    @Param('id') id: string,
    @Param('commentId') commentId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.feed.deleteComment(id, commentId, user);
  }

  @Get('cards/:id/feed')
  @ApiOperation({
    summary:
      'Combined comment + activity feed for a card (chronological, discriminated)',
  })
  getFeed(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.feed.getFeed(id, user);
  }

  // ── Attachments ────────────────────────────────────────────────────
  @Get('cards/:id/attachments')
  @ApiOperation({
    summary: 'List a card’s file attachments (board member or card assignee)',
  })
  listAttachments(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.attachments.list(id, user);
  }

  @Post('cards/:id/attachments/upload-url')
  @ApiOperation({
    summary:
      'Presigned URL to upload a card attachment (board member or card assignee)',
  })
  createAttachmentUploadUrl(
    @Param('id') id: string,
    @Body() dto: CreateAttachmentUploadUrlDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.attachments.createUploadUrl(id, dto, user);
  }

  @Post('cards/:id/attachments/:attachmentId/confirm')
  @ApiOperation({ summary: 'Confirm an uploaded attachment landed in storage' })
  confirmAttachment(
    @Param('id') id: string,
    @Param('attachmentId') attachmentId: string,
    @Body() dto: ConfirmAttachmentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.attachments.confirm(id, attachmentId, dto, user);
  }

  @Get('cards/:id/attachments/:attachmentId/download-url')
  @ApiOperation({ summary: 'Presigned download URL for an attachment' })
  attachmentDownloadUrl(
    @Param('id') id: string,
    @Param('attachmentId') attachmentId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.attachments.downloadUrl(id, attachmentId, user);
  }

  @Delete('cards/:id/attachments/:attachmentId')
  @HttpCode(204)
  @ApiOperation({
    summary:
      'Delete an attachment (board member, uploader, or managing Scrum Master / SUPER_ADMIN)',
  })
  async deleteAttachment(
    @Param('id') id: string,
    @Param('attachmentId') attachmentId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.attachments.remove(id, attachmentId, user);
  }

  // ── Labels ─────────────────────────────────────────────────────────
  @Get('boards/:id/labels')
  @ApiOperation({ summary: 'List a board’s labels (any member)' })
  listLabels(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.labels.listLabels(id, user);
  }

  @Post('boards/:id/labels')
  @ApiOperation({ summary: 'Create a label (Scrum Master / SUPER_ADMIN)' })
  createLabel(
    @Param('id') id: string,
    @Body() dto: CreateLabelDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.labels.createLabel(id, dto, user);
  }

  @Patch('labels/:labelId')
  @ApiOperation({ summary: 'Edit a label (Scrum Master / SUPER_ADMIN)' })
  updateLabel(
    @Param('labelId') labelId: string,
    @Body() dto: UpdateLabelDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.labels.updateLabel(labelId, dto, user);
  }

  @Delete('labels/:labelId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a label (Scrum Master / SUPER_ADMIN)' })
  async deleteLabel(
    @Param('labelId') labelId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.labels.deleteLabel(labelId, user);
  }

  @Post('cards/:id/labels/:labelId')
  @ApiOperation({ summary: 'Attach a label to a card (any board member)' })
  attachLabel(
    @Param('id') id: string,
    @Param('labelId') labelId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.labels.attach(id, labelId, user);
  }

  @Delete('cards/:id/labels/:labelId')
  @ApiOperation({ summary: 'Detach a label from a card (any board member)' })
  detachLabel(
    @Param('id') id: string,
    @Param('labelId') labelId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.labels.detach(id, labelId, user);
  }
}
