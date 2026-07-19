import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { BomStatus, Role } from '@prisma/client';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { BomService } from './bom.service';
import { CreateBomDto, RejectBomDto, UpdateBomDto } from './dto/bom.dto';

/**
 * BOM workflow (§3–4). Coarse @Roles gate; the fine R&D-vertical (author) and
 * R&D-Head (approve/reject) checks live in the service.
 */
@ApiTags('boms')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles(Role.MANAGER, Role.EMPLOYEE, Role.ADMIN, Role.SUPER_ADMIN)
@Controller('boms')
export class BomController {
  constructor(private readonly service: BomService) {}

  @Get()
  @ApiOperation({ summary: 'List BOMs (R&D)' })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('itemId') itemId?: string,
    @Query('status') status?: BomStatus,
  ) {
    return this.service.list(user, { itemId, status });
  }

  // Static route BEFORE :id so 'pending-approval' isn't captured as an :id.
  @Get('pending-approval')
  @ApiOperation({ summary: 'R&D Head approval queue (R&D Head)' })
  pendingApproval(@CurrentUser() user: AuthenticatedUser) {
    return this.service.pendingApproval(user);
  }

  @Post()
  @ApiOperation({ summary: 'Create a draft BOM (R&D vertical)' })
  create(@Body() dto: CreateBomDto, @CurrentUser() user: AuthenticatedUser) {
    return this.service.create(dto, user);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one BOM with lines + history (R&D or Store)' })
  get(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.get(id, user);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Edit a DRAFT/REJECTED BOM (R&D vertical)' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateBomDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.update(id, dto, user);
  }

  @Post(':id/submit')
  @ApiOperation({ summary: 'Submit a draft BOM for approval (R&D vertical)' })
  submit(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.submit(id, user);
  }

  @Post(':id/approve')
  @ApiOperation({ summary: 'Approve + release a submitted BOM (R&D Head, not creator)' })
  approve(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.approve(id, user);
  }

  @Post(':id/reject')
  @ApiOperation({ summary: 'Reject a submitted BOM with a comment (R&D Head, not creator)' })
  reject(
    @Param('id') id: string,
    @Body() dto: RejectBomDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.reject(id, dto, user);
  }

  @Post(':id/new-revision')
  @ApiOperation({ summary: 'Create a new draft revision from this BOM (R&D vertical)' })
  newRevision(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.newRevision(id, user);
  }
}
