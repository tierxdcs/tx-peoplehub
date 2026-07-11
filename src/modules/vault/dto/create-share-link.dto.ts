import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
} from 'class-validator';

/**
 * Create a public external share link. Permission is always VIEW (never an
 * option here). Optional password + custom expiry; expiry defaults to 24h.
 */
export class CreateShareLinkDto {
  @ApiPropertyOptional({
    description: 'Optional password required to open the link',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  password?: string;

  @ApiPropertyOptional({
    description: 'Link lifetime in hours (default 24, max 720 = 30 days)',
    default: 24,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(720)
  expiresInHours?: number;
}

/** Body for opening a password-protected link (password in body, not query/URL). */
export class OpenShareLinkDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  password?: string;
}
