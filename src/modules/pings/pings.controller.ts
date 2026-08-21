import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { CreateContextualPingDto, CreatePingDto, UpdatePingStatusDto } from './dto/pings.dto';
import { PingsService } from './pings.service';

@ApiTags('pings')
@ApiBearerAuth()
@Controller('pings')
export class PingsController {
  constructor(private readonly service: PingsService) {}
  @Post() create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreatePingDto) { return this.service.create(user, dto); }
  @Post('contextual') createContextual(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateContextualPingDto) { return this.service.createContextual(user, dto); }
  @Get('received') received(@CurrentUser() user: AuthenticatedUser) { return this.service.received(user); }
  @Get('sent') sent(@CurrentUser() user: AuthenticatedUser) { return this.service.sent(user); }
  @Get('recipients') recipients(@CurrentUser() user: AuthenticatedUser) { return this.service.recipients(user); }
  @Patch('received/:id/status') updateStatus(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser, @Body() dto: UpdatePingStatusDto) { return this.service.updateStatus(id, user, dto.status); }
}
