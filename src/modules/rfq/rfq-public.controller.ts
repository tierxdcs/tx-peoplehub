import { Body, Controller, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { RfqPublicService } from './rfq-public.service';
import {
  PublicQuoteAttachmentConfirmDto,
  PublicQuoteAttachmentUploadUrlDto,
  PublicDeclineDto,
  PublicResolveRfqDto,
  PublicSaveQuoteDto,
  PublicSubmitQuoteDto,
} from './dto/rfq-public.dto';

/**
 * The ONLY unauthenticated RFQ surface: a vendor/supplier submitting their quote
 * via a token link. @Public() bypasses the global JwtAuthGuard. Everything is
 * POST so the optional invite password rides in the BODY, never the URL. Expiry/
 * revoke/password are enforced in the service (shared token-invite util); a
 * submitted quote is locked. Attachments reuse Vault's extension/size guardrails
 * and re-check the actual object size on confirm.
 */
@ApiTags('rfq-public')
@Controller('public/rfq-quote')
export class RfqPublicController {
  constructor(private readonly service: RfqPublicService) {}

  @Public()
  @Post(':token/resolve')
  @ApiOperation({ summary: 'Resolve an RFQ invite token (marks it viewed)' })
  resolve(@Param('token') token: string, @Body() dto: PublicResolveRfqDto) {
    return this.service.resolve(token, dto);
  }

  @Public()
  @Post(':token/save')
  @ApiOperation({ summary: 'Save-and-resume a partial quote' })
  save(@Param('token') token: string, @Body() dto: PublicSaveQuoteDto) {
    return this.service.save(token, dto);
  }

  @Public()
  @Post(':token/submit')
  @ApiOperation({ summary: 'Submit the quote (locks it)' })
  submit(@Param('token') token: string, @Body() dto: PublicSubmitQuoteDto) {
    return this.service.submit(token, dto);
  }

  @Public()
  @Post(':token/decline')
  @ApiOperation({ summary: 'Decline to quote, with an optional reason' })
  decline(@Param('token') token: string, @Body() dto: PublicDeclineDto) {
    return this.service.decline(token, dto);
  }

  @Public()
  @Post(':token/attachment-upload-url')
  @ApiOperation({ summary: 'Presigned PUT URL for a quote attachment (R2)' })
  attachmentUploadUrl(
    @Param('token') token: string,
    @Body() dto: PublicQuoteAttachmentUploadUrlDto,
  ) {
    return this.service.attachmentUploadUrl(token, dto);
  }

  @Public()
  @Post(':token/attachment-confirm')
  @ApiOperation({ summary: 'Confirm a quote attachment upload' })
  attachmentConfirm(
    @Param('token') token: string,
    @Body() dto: PublicQuoteAttachmentConfirmDto,
  ) {
    return this.service.attachmentConfirm(token, dto);
  }
}
