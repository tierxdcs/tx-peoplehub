import { Body, Controller, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { SupplierService } from './supplier.service';
import {
  PublicCertConfirmDto,
  PublicCertUploadUrlDto,
  PublicQuestionnaireSaveDto,
  PublicResolveDto,
} from './dto/supplier.dto';

/**
 * Unauthenticated Supplier questionnaire surface (@Public bypasses the global
 * JwtAuthGuard). POST-only so the optional password rides in the body. Distinct
 * route from Vendor's /public/vendor-questionnaire.
 */
@ApiTags('scm-supplier-public')
@Controller('public/supplier-questionnaire')
export class SupplierPublicController {
  constructor(private readonly service: SupplierService) {}

  @Public()
  @Post(':token/resolve')
  @ApiOperation({ summary: 'Resolve a supplier questionnaire invite (unauthenticated)' })
  resolve(@Param('token') token: string, @Body() dto: PublicResolveDto) {
    return this.service.resolvePublic(token, dto.password);
  }

  @Public()
  @Post(':token/save')
  @ApiOperation({ summary: 'Partial save / resume (unauthenticated)' })
  save(@Param('token') token: string, @Body() dto: PublicQuestionnaireSaveDto) {
    return this.service.savePublic(token, dto);
  }

  @Public()
  @Post(':token/submit')
  @ApiOperation({ summary: 'Final submit — locks the questionnaire (unauthenticated)' })
  submit(@Param('token') token: string, @Body() dto: PublicQuestionnaireSaveDto) {
    return this.service.submitPublic(token, dto);
  }

  @Public()
  @Post(':token/certificate-upload-url')
  @ApiOperation({ summary: 'Presign a certificate upload (guarded like Vault)' })
  certUploadUrl(@Param('token') token: string, @Body() dto: PublicCertUploadUrlDto) {
    return this.service.publicCertUploadUrl(token, dto);
  }

  @Public()
  @Post(':token/certificate-confirm')
  @ApiOperation({ summary: 'Confirm a completed certificate upload (size-checked)' })
  certConfirm(@Param('token') token: string, @Body() dto: PublicCertConfirmDto) {
    return this.service.publicCertConfirm(token, dto);
  }
}
