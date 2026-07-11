import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
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
import { CreateUploadUrlDto } from './dto/create-upload-url.dto';
import { CreateVersionUrlDto } from './dto/create-version-url.dto';
import { CreateInternalShareDto } from './dto/create-internal-share.dto';
import { CreateShareLinkDto } from './dto/create-share-link.dto';
import { VaultShareResourceType } from '@prisma/client';
import { VaultFilesService } from './vault-files.service';
import { VaultSharesService } from './vault-shares.service';
import { VaultExternalShareService } from './vault-external-share.service';

/**
 * Vault file lifecycle (Phase 2). Every authenticated role may reach these
 * routes; per-folder read/write/delete is computed in the service layer
 * (reusing Phase 1's permission model). The backend only issues presigned
 * URLs — bytes flow browser↔R2 directly, never through here.
 *
 * Route order: static segments (upload-url) declared before nothing that
 * collides; :id routes are all suffixed, so no ambiguity.
 */
@ApiTags('vault')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles(Role.EMPLOYEE, Role.MANAGER, Role.ADMIN, Role.SUPER_ADMIN)
@Controller('vault/files')
export class VaultFilesController {
  constructor(
    private readonly service: VaultFilesService,
    private readonly shares: VaultSharesService,
    private readonly externalShares: VaultExternalShareService,
  ) {}

  @Post('upload-url')
  @ApiOperation({
    summary:
      'Request a presigned PUT URL for a new file (creates a PENDING record)',
  })
  createUploadUrl(
    @Body() dto: CreateUploadUrlDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.createUploadUrl(dto, user);
  }

  @Post(':id/confirm-upload')
  @ApiOperation({
    summary: 'Finalize a file after the browser upload to R2 completes',
  })
  confirmUpload(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.confirmUpload(id, user);
  }

  @Get(':id/download-url')
  @ApiOperation({
    summary: 'Presigned GET URL for the current (or a specific) version',
  })
  getDownloadUrl(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query('versionId') versionId?: string,
  ) {
    return this.service.getDownloadUrl(id, user, versionId);
  }

  @Get(':id/view-url')
  @ApiOperation({
    summary:
      'Preview URL when previewStatus=READY, else the status (Preparing…/unavailable)',
  })
  getViewUrl(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query('versionId') versionId?: string,
  ) {
    return this.service.getViewUrl(id, user, versionId);
  }

  @Get(':id')
  @ApiOperation({
    summary:
      'Single file enriched (size/mime/preview/versions + caller access) — read access required',
  })
  findOne(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.findOneEnriched(id, user);
  }

  @Get(':id/shares')
  @ApiOperation({
    summary: 'List internal shares on this file (write access required)',
  })
  listShares(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.shares.listFileShares(id, user);
  }

  @Delete(':id/shares/:shareId')
  @HttpCode(204)
  @ApiOperation({
    summary:
      'Revoke an internal share on this file (sharer, file manager, or SUPER_ADMIN)',
  })
  async revokeShare(
    @Param('id') id: string,
    @Param('shareId') shareId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.shares.revokeShare(
      shareId,
      user,
      VaultShareResourceType.FILE,
      id,
    );
  }

  @Get(':id/share-links')
  @ApiOperation({
    summary: 'List active external links on this file (read access required)',
  })
  listShareLinks(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.externalShares.listFileLinks(id, user);
  }

  @Post(':id/versions')
  @ApiOperation({
    summary:
      'Request a presigned PUT URL for a new version (versioning folders only)',
  })
  createVersionUrl(
    @Param('id') id: string,
    @Body() dto: CreateVersionUrlDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.createVersionUrl(id, dto, user);
  }

  @Post(':id/versions/confirm')
  @ApiOperation({
    summary: 'Finalize a new-version upload, then prune per retention policy',
  })
  confirmVersionUpload(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.confirmVersionUpload(id, user);
  }

  @Get(':id/versions')
  @ApiOperation({
    summary: 'Version history (uploader, date, size, change note)',
  })
  listVersions(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.listVersions(id, user);
  }

  @Post(':id/versions/:versionId/restore')
  @ApiOperation({
    summary: 'Restore an old version as a NEW version (append-only)',
  })
  restoreVersion(
    @Param('id') id: string,
    @Param('versionId') versionId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.restoreVersion(id, versionId, user);
  }

  @Post(':id/share')
  @ApiOperation({
    summary:
      'Share this file with an employee (VIEW/EDIT) — additive, folder access unaffected',
  })
  share(
    @Param('id') id: string,
    @Body() dto: CreateInternalShareDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.shares.shareFile(id, dto, user);
  }

  @Post(':id/share-link')
  @ApiOperation({
    summary:
      'Create a public external share link (VIEW-only, version-pinned, expiring)',
  })
  createShareLink(
    @Param('id') id: string,
    @Body() dto: CreateShareLinkDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.externalShares.createFileLink(id, dto, user);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Soft-delete the whole file and free all its version objects',
  })
  async deleteFile(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.service.deleteFile(id, user);
  }
}
