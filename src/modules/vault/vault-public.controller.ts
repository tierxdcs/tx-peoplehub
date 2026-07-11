import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { OpenShareLinkDto } from './dto/create-share-link.dto';
import { VaultExternalShareService } from './vault-external-share.service';

/**
 * The ONLY unauthenticated Vault surface: resolving a public external share
 * link by its token. @Public() bypasses the global JwtAuthGuard. Every access
 * attempt (valid or not) is logged with IP/UA inside the service.
 *
 * Two ways to resolve, split so a password never rides in a URL:
 *  - GET  /public/vault/shared/:token       — for links with NO password.
 *  - POST /public/vault/shared/:token       — the primary way for a
 *    password-protected link; the password travels in the request BODY, never
 *    the query string. Query strings surface in places a request body does not
 *    (platform/proxy request logs, browser history, Referer headers), so a
 *    secret in the URL is exposed even over HTTPS. The body avoids all of that.
 */
@ApiTags('vault-public')
@Controller('public/vault')
export class VaultPublicController {
  constructor(private readonly externalShares: VaultExternalShareService) {}

  @Public()
  @Get('shared/:token')
  @ApiOperation({
    summary:
      'Resolve a public share link with no password (unauthenticated) — pinned version, enforces expiry/revoke',
  })
  resolve(@Param('token') token: string, @Req() req: Request) {
    const ip = req.ip;
    const userAgent = req.headers['user-agent'];
    return this.externalShares.resolveByToken(token, undefined, {
      ip,
      userAgent,
    });
  }

  @Public()
  @Post('shared/:token')
  @ApiOperation({
    summary:
      'Resolve a password-protected public share link (unauthenticated) — password in body, pinned version, enforces expiry/revoke/password',
  })
  resolveWithPassword(
    @Param('token') token: string,
    @Body() dto: OpenShareLinkDto,
    @Req() req: Request,
  ) {
    const ip = req.ip;
    const userAgent = req.headers['user-agent'];
    return this.externalShares.resolveByToken(token, dto.password, {
      ip,
      userAgent,
    });
  }
}
