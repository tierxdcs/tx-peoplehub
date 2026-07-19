import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { CloseControlsService } from './close-controls.service';
import { ResolveExceptionDto, UpdateCloseTaskDto } from './dto/close-controls.dto';

@ApiTags('finance-close-controls') @ApiBearerAuth() @Controller('finance/close-controls')
export class CloseControlsController {
  constructor(private readonly controls: CloseControlsService) {}
  @Get(':periodId') workspace(@Param('periodId') id: string, @CurrentUser() u: AuthenticatedUser) { return this.controls.workspace(id, u); }
  @Post(':periodId/run') run(@Param('periodId') id: string, @CurrentUser() u: AuthenticatedUser) { return this.controls.run(id, u); }
  @Patch(':periodId/tasks/:taskId') task(@Param('periodId') id: string, @Param('taskId') taskId: string, @Body() d: UpdateCloseTaskDto, @CurrentUser() u: AuthenticatedUser) { return this.controls.updateTask(id, taskId, d, u); }
  @Patch('exceptions/:id/resolve') resolve(@Param('id') id: string, @Body() d: ResolveExceptionDto, @CurrentUser() u: AuthenticatedUser) { return this.controls.resolve(id, d, u); }
}
