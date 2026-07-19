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
import { NonConformanceReportStatus, Role } from '@prisma/client';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { NonConformanceReportService } from './non-conformance-report.service';
import { DispositionNcrDto } from './dto/non-conformance-report.dto';

/**
 * Non-Conformance Reports (Stores Phase 2). Company-wide read; disposition is
 * gated in the service to QC Inspector / Production Manager+ / SA.
 */
@ApiTags('non-conformance-reports')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles(Role.MANAGER, Role.EMPLOYEE, Role.ADMIN, Role.SUPER_ADMIN)
@Controller('non-conformance-reports')
export class NonConformanceReportController {
  constructor(private readonly service: NonConformanceReportService) {}

  @Get()
  @ApiOperation({ summary: 'List non-conformance reports (company-wide read)' })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('status') status?: NonConformanceReportStatus,
    @Query('grnId') grnId?: string,
  ) {
    return this.service.list(user, { status, grnId });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a non-conformance report (company-wide read)' })
  get(@Param('id') id: string) {
    return this.service.get(id);
  }

  @Post(':id/disposition')
  @ApiOperation({
    summary:
      'Record a disposition (QC Inspector/Production Manager+/SA). OPEN → DISPOSITIONED.',
  })
  disposition(
    @Param('id') id: string,
    @Body() dto: DispositionNcrDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.disposition(id, dto, user);
  }

  @Post(':id/close')
  @ApiOperation({ summary: 'Close a DISPOSITIONED NCR (QC Inspector/Production Manager+/SA)' })
  close(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.close(id, user);
  }
}
