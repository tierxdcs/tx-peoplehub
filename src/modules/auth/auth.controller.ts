import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { NoAudit } from '../../common/decorators/no-audit.decorator';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Authenticate and receive an access token' })
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const tokens = await this.authService.login(dto.email, dto.password);
    this.setRefreshCookie(res, tokens.refreshToken);
    return { accessToken: tokens.accessToken };
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @NoAudit()
  @ApiOperation({
    summary: 'Exchange the refresh cookie for a new access token',
  })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const cookieName = this.config.get<string>(
      'jwt.refreshCookieName',
    ) as string;
    const token = req.cookies?.[cookieName];
    if (!token) {
      throw new UnauthorizedException('Missing refresh token');
    }
    const tokens = await this.authService.refresh(token);
    this.setRefreshCookie(res, tokens.refreshToken);
    return { accessToken: tokens.accessToken };
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @NoAudit()
  @ApiOperation({ summary: 'Clear the refresh cookie' })
  logout(@Res({ passthrough: true }) res: Response) {
    const cookieName = this.config.get<string>(
      'jwt.refreshCookieName',
    ) as string;
    res.clearCookie(cookieName, this.cookieOptions());
    return { success: true };
  }

  private setRefreshCookie(res: Response, token: string) {
    const cookieName = this.config.get<string>(
      'jwt.refreshCookieName',
    ) as string;
    res.cookie(cookieName, token, {
      ...this.cookieOptions(),
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });
  }

  private cookieOptions() {
    const isProd = this.config.get<string>('env') === 'production';
    return {
      httpOnly: true,
      secure: isProd,
      sameSite: isProd ? ('none' as const) : ('lax' as const),
      path: '/',
    };
  }
}
