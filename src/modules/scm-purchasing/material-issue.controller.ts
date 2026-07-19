import {
  Body,
  Controller,
  Get,
  Param,
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
import { MaterialService } from './material.service';
import { CreateMaterialIssueDto } from './dto/material-issue-note.dto';

/**
 * Material Issue Notes (Stores Phase 3). Company-wide read; issuing is gated in
 * the service to Production-vertical/SA (Stores). Issuing generates a
 * reservation-aware STOCK_OUT and supports short issue.
 */
@ApiTags('material-issue-notes')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles(Role.MANAGER, Role.EMPLOYEE, Role.ADMIN, Role.SUPER_ADMIN)
@Controller('material-issue-notes')
export class MaterialIssueController {
  constructor(private readonly service: MaterialService) {}

  @Get()
  @ApiOperation({ summary: 'List material issue notes (company-wide read)' })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('materialIndentId') materialIndentId?: string,
  ) {
    return this.service.listIssues(user, { materialIndentId });
  }

  @Post()
  @ApiOperation({
    summary:
      'Issue material against an indent (Production-vertical/SA). Reservation-aware STOCK_OUT; short issue allowed.',
  })
  create(
    @Body() dto: CreateMaterialIssueDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.createIssue(dto, user);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a material issue note (company-wide read)' })
  get(@Param('id') id: string) {
    return this.service.getIssue(id);
  }
}
