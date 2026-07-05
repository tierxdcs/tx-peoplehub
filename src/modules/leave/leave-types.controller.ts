import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { LeaveTypesService } from './leave-types.service';

@ApiTags('leave-types')
@ApiBearerAuth()
@Controller('leave-types')
export class LeaveTypesController {
  constructor(private readonly leaveTypesService: LeaveTypesService) {}

  @Get()
  @ApiOperation({ summary: 'List active leave types' })
  findAll() {
    return this.leaveTypesService.findAllActive();
  }
}
