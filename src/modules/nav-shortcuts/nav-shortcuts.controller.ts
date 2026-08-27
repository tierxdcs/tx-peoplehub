import { Body, Controller, Delete, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import {
  PinNavShortcutDto,
  UnpinNavShortcutQueryDto,
} from './dto/nav-shortcut.dto';
import { NavShortcutEntity } from './entities/nav-shortcut.entity';
import { MAX_NAV_SHORTCUTS, NavShortcutsService } from './nav-shortcuts.service';

/**
 * The caller's own sidebar shortcuts. No @Roles decorator and no access service:
 * every route is scoped to the authenticated employee's own pins, so any
 * logged-in employee may manage exactly their own list and nobody else's.
 *
 * Every mutation returns the full, ordered list so the client can replace its
 * state in one step rather than reconciling a patch.
 */
@ApiTags('nav-shortcuts')
@ApiBearerAuth()
@Controller('nav-shortcuts')
export class NavShortcutsController {
  constructor(private readonly shortcuts: NavShortcutsService) {}

  @Get()
  @ApiOperation({ summary: "List the caller's pinned sidebar shortcuts" })
  @ApiOkResponse({ type: [NavShortcutEntity] })
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.shortcuts.list(user);
  }

  @Post()
  @ApiOperation({
    summary: 'Pin a page',
    description: `Idempotent. Fails once the caller holds ${MAX_NAV_SHORTCUTS} pins.`,
  })
  @ApiOkResponse({ type: [NavShortcutEntity] })
  pin(@CurrentUser() user: AuthenticatedUser, @Body() dto: PinNavShortcutDto) {
    return this.shortcuts.pin(user, dto);
  }

  @Delete()
  @ApiOperation({
    summary: 'Unpin a page',
    description: 'Unpinning a route that is not pinned is a no-op.',
  })
  @ApiOkResponse({ type: [NavShortcutEntity] })
  unpin(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: UnpinNavShortcutQueryDto,
  ) {
    return this.shortcuts.unpin(user, query.href);
  }
}
