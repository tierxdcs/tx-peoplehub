import { Controller, Delete, HttpCode, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { VaultExternalShareService } from './vault-external-share.service';

/** Manage existing external share links (revocation). */
@ApiTags('vault')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles(Role.EMPLOYEE, Role.MANAGER, Role.ADMIN, Role.SUPER_ADMIN)
@Controller('vault/share-links')
export class VaultShareLinksController {
  constructor(private readonly externalShares: VaultExternalShareService) {}

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Revoke a share link (creator or SUPER_ADMIN) — immediate',
  })
  async revoke(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.externalShares.revoke(id, user);
  }
}
