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
import { Delete, HttpCode } from '@nestjs/common';
import { CreateLeadDto } from './dto/create-lead.dto';
import { UpdateLeadDto } from './dto/update-lead.dto';
import { ConvertLeadDto } from './dto/convert-lead.dto';
import { AttachLeadFileDto } from './dto/attach-lead-file.dto';
import { LeadsService } from './leads.service';

@ApiTags('leads')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles(Role.MANAGER, Role.EMPLOYEE, Role.SUPER_ADMIN)
@Controller('leads')
export class LeadsController {
  constructor(private readonly leadsService: LeadsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a lead (a.k.a. "New Enquiry")' })
  create(@Body() dto: CreateLeadDto, @CurrentUser() user: AuthenticatedUser) {
    return this.leadsService.create(dto, user);
  }

  @Get()
  @ApiOperation({ summary: 'List leads visible to the caller' })
  findAll(
    @Query() query: PaginationQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.leadsService.findAll(query, user);
  }

  // Static route BEFORE @Get(':id') so 'attachments-folder' isn't read as an id.
  @Get('attachments-folder')
  @ApiOperation({
    summary: 'The Vault folder id lead files are uploaded into (for the upload flow)',
  })
  attachmentsFolder(@CurrentUser() user: AuthenticatedUser) {
    return this.leadsService.attachmentsFolderId(user);
  }

  @Get(':id')
  @ApiOperation({ summary: 'View one lead (ownership-scoped)' })
  findOne(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.leadsService.findOne(id, user);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a lead / transition status (not convert)' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateLeadDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.leadsService.update(id, dto, user);
  }

  @Post(':id/convert')
  @ApiOperation({
    summary:
      'Convert a QUALIFIED lead into an Opportunity (creates a Customer if needed)',
  })
  convert(
    @Param('id') id: string,
    @Body() dto: ConvertLeadDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.leadsService.convert(id, dto, user);
  }

  @Get(':id/attachments')
  @ApiOperation({ summary: 'Files attached to a lead' })
  listAttachments(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.leadsService.listAttachments(id, user);
  }

  @Post(':id/attachments')
  @ApiOperation({
    summary: 'Link an uploaded Vault file to a lead (owner-scoped)',
  })
  attachFile(
    @Param('id') id: string,
    @Body() dto: AttachLeadFileDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.leadsService.attachFile(id, dto, user);
  }

  @Delete(':id/attachments/:attachmentId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Unlink a file from a lead (owner-scoped)' })
  async removeAttachment(
    @Param('id') id: string,
    @Param('attachmentId') attachmentId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.leadsService.removeAttachment(id, attachmentId, user);
  }
}
