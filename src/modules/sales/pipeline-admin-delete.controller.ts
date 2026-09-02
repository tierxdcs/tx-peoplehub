import {
  Controller,
  Delete,
  Param,
  ParseEnumPipe,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import {
  PIPELINE_ENTRY_TYPES,
  PipelineAdminDeleteService,
  PipelineEntryType,
} from './pipeline-admin-delete.service';

@ApiTags('sales-pipeline-admin')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles(Role.SUPER_ADMIN)
@Controller('sales-pipeline-admin')
export class PipelineAdminDeleteController {
  constructor(private readonly service: PipelineAdminDeleteService) {}

  @Delete(':type/:id')
  @ApiOperation({
    summary: 'CEO/Super Admin hard-delete of a Sales Pipeline register entry',
  })
  remove(
    @Param('type', new ParseEnumPipe(PIPELINE_ENTRY_TYPES))
    type: PipelineEntryType,
    @Param('id') id: string,
  ) {
    return this.service.remove(type, id);
  }
}
