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
import { Role } from '@prisma/client';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { CreateOpportunityDto } from './dto/create-opportunity.dto';
import { UpdateOpportunityDto } from './dto/update-opportunity.dto';
import { OpportunitiesService } from './opportunities.service';

@ApiTags('opportunities')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles(Role.MANAGER, Role.EMPLOYEE, Role.SUPER_ADMIN)
@Controller('opportunities')
export class OpportunitiesController {
  constructor(private readonly opportunitiesService: OpportunitiesService) {}

  @Post()
  @ApiOperation({ summary: 'Create an opportunity (directly, not via a lead)' })
  create(
    @Body() dto: CreateOpportunityDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.opportunitiesService.create(dto, user);
  }

  @Get()
  @ApiOperation({ summary: 'List opportunities visible to the caller' })
  findAll(
    @Query() query: PaginationQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.opportunitiesService.findAll(query, user);
  }

  @Get(':id')
  @ApiOperation({ summary: 'View one opportunity (ownership-scoped)' })
  findOne(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.opportunitiesService.findOne(id, user);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update an opportunity / transition stage' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateOpportunityDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.opportunitiesService.update(id, dto, user);
  }
}
