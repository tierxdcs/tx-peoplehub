import { Body, Controller, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { ScmService } from './scm.service';
import {
  PublicCertConfirmDto,
  PublicCertUploadUrlDto,
  PublicQuestionnaireSaveDto,
  PublicResolveDto,
} from './dto/scm.dto';

/**
 * The ONLY unauthenticated SCM surface: a vendor filling their self-assessment
 * questionnaire via a token link. @Public() bypasses the global JwtAuthGuard.
 * Everything is POST so the optional invite password rides in the BODY, never
 * the URL/query (same reasoning as the Vault public controller). Expiry/revoke/
 * password are enforced in the service; a submitted questionnaire is locked.
 *
 * Certificate uploads reuse Vault's exact extension/size guardrails (in the
 * service), and the confirm step re-checks the ACTUAL object size — a public,
 * unauthenticated upload is a real abuse vector otherwise.
 */
@ApiTags('scm-public')
@Controller('public/vendor-questionnaire')
export class ScmPublicController {
  constructor(private readonly service: ScmService) {}

  @Public()
  @Post(':token/resolve')
  @ApiOperation({ summary: 'Resolve a questionnaire invite (unauthenticated)' })
  resolve(@Param('token') token: string, @Body() dto: PublicResolveDto) {
    return this.service.resolvePublic(token, dto.password);
  }

  @Public()
  @Post(':token/save')
  @ApiOperation({ summary: 'Partial save / resume of section data (unauthenticated)' })
  save(
    @Param('token') token: string,
    @Body() dto: PublicQuestionnaireSaveDto,
  ) {
    return this.service.savePublic(token, dto);
  }

  @Public()
  @Post(':token/submit')
  @ApiOperation({ summary: 'Final submit — locks the questionnaire (unauthenticated)' })
  submit(
    @Param('token') token: string,
    @Body() dto: PublicQuestionnaireSaveDto,
  ) {
    return this.service.submitPublic(token, dto);
  }

  @Public()
  @Post(':token/certificate-upload-url')
  @ApiOperation({ summary: 'Presign a certificate upload (guarded like Vault)' })
  certUploadUrl(
    @Param('token') token: string,
    @Body() dto: PublicCertUploadUrlDto,
  ) {
    return this.service.publicCertUploadUrl(token, dto);
  }

  @Public()
  @Post(':token/certificate-confirm')
  @ApiOperation({ summary: 'Confirm a completed certificate upload (size-checked)' })
  certConfirm(
    @Param('token') token: string,
    @Body() dto: PublicCertConfirmDto,
  ) {
    return this.service.publicCertConfirm(token, dto);
  }
}
