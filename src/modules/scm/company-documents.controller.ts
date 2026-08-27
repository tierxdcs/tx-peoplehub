import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { NdaTemplateConfirmDto, NdaTemplateUploadUrlDto } from './dto/scm.dto';
import { ScmService } from './scm.service';

@UseGuards(RolesGuard)
@Roles(Role.SUPER_ADMIN)
@Controller('admin/company-documents')
export class CompanyDocumentsController {
  constructor(private readonly service: ScmService) {}

  @Post('nda-template/upload-url')
  uploadUrl(
    @Body() dto: NdaTemplateUploadUrlDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.ndaTemplateUploadUrl(dto, user);
  }

  @Post('nda-template/confirm')
  confirm(
    @Body() dto: NdaTemplateConfirmDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.confirmNdaTemplate(dto.fileId, user);
  }
}
