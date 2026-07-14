import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
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
import {
  AddBoardMemberDto,
  CreateBoardDto,
  CreateCardDto,
  CreateListDto,
  CreateSprintDto,
  MoveCardDto,
  SetCardSprintDto,
  UpdateCardDto,
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
  @ApiOperation({ summary: 'Remove a board member (Scrum Master / SUPER_ADMIN)' })
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

  // ── Sprints ────────────────────────────────────────────────────────
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
}
