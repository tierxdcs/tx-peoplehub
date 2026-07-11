import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role, VaultShareResourceType } from '@prisma/client';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CreateVaultFolderDto } from './dto/create-vault-folder.dto';
import { UpdateVaultFolderDto } from './dto/update-vault-folder.dto';
import { GrantVaultPermissionDto } from './dto/grant-vault-permission.dto';
import { CreateInternalShareDto } from './dto/create-internal-share.dto';
import { CreateShareLinkDto } from './dto/create-share-link.dto';
import { VaultFoldersService } from './vault-folders.service';
import { VaultFilesService } from './vault-files.service';
import { VaultSharesService } from './vault-shares.service';
import { VaultExternalShareService } from './vault-external-share.service';

/**
 * Vault folder tree (Phase 1). Every authenticated role may reach these
 * routes — the meaningful rules (DEFAULT = SUPER_ADMIN only, CUSTOM =
 * Manager+, per-folder read/write/manage) are computed in the service layer
 * per folder, which a route-level @Roles can't express.
 */
@ApiTags('vault')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles(Role.EMPLOYEE, Role.MANAGER, Role.ADMIN, Role.SUPER_ADMIN)
@Controller('vault/folders')
export class VaultFoldersController {
  constructor(
    private readonly service: VaultFoldersService,
    private readonly files: VaultFilesService,
    private readonly shares: VaultSharesService,
    private readonly externalShares: VaultExternalShareService,
  ) {}

  @Post()
  @ApiOperation({
    summary:
      'Create a folder (DEFAULT: SuperAdmin only; CUSTOM: Manager+, auto TEAM-scoped)',
  })
  create(
    @Body() dto: CreateVaultFolderDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.create(dto, user);
  }

  @Get('roots')
  @ApiOperation({
    summary:
      'Root folders the caller can see (Personal first, then DEFAULT, then CUSTOM) — the browser landing',
  })
  listRoots(@CurrentUser() user: AuthenticatedUser) {
    return this.service.listRoots(user);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Folder + visible immediate children (computed access applied)',
  })
  findOne(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.findOne(id, user);
  }

  @Get(':id/files')
  @ApiOperation({
    summary:
      'List the files in this folder, enriched (size/mime/preview/versions + per-file access)',
  })
  listFiles(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.files.listFilesInFolder(id, user);
  }

  @Get(':id/shares')
  @ApiOperation({
    summary: 'List internal shares on this folder (write access required)',
  })
  listShares(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.shares.listFolderShares(id, user);
  }

  @Delete(':id/shares/:shareId')
  @HttpCode(204)
  @ApiOperation({
    summary:
      'Revoke an internal share on this folder (sharer, folder manager, or SUPER_ADMIN)',
  })
  async revokeShare(
    @Param('id') id: string,
    @Param('shareId') shareId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.shares.revokeShare(
      shareId,
      user,
      VaultShareResourceType.FOLDER,
      id,
    );
  }

  @Get(':id/share-links')
  @ApiOperation({
    summary: 'List active external links on this folder (read access required)',
  })
  listShareLinks(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.externalShares.listFolderLinks(id, user);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Rename / archive / toggle versioning (write access required)',
  })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateVaultFolderDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.update(id, dto, user);
  }

  @Post(':id/permissions')
  @ApiOperation({
    summary: 'Grant explicit access beyond the default scope (additive only)',
  })
  grantPermission(
    @Param('id') id: string,
    @Body() dto: GrantVaultPermissionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.grantPermission(id, dto, user);
  }

  @Post(':id/share')
  @ApiOperation({
    summary: 'Share this folder with an employee (VIEW/EDIT, additive)',
  })
  share(
    @Param('id') id: string,
    @Body() dto: CreateInternalShareDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.shares.shareFolder(id, dto, user);
  }

  @Post(':id/share-link')
  @ApiOperation({
    summary:
      'Create a public external share link for this folder (VIEW-only; not allowed for PERSONAL folders)',
  })
  createShareLink(
    @Param('id') id: string,
    @Body() dto: CreateShareLinkDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.externalShares.createFolderLink(id, dto, user);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({
    summary:
      'Archive (soft-delete) an empty DEFAULT folder — SUPER_ADMIN only; folder must contain no active files or subfolders',
  })
  async deleteFolder(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.service.deleteFolder(id, user);
  }
}
