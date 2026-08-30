import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Body for "email this invite link" actions. Shared by Vendor and Supplier
 * qualification (and whatever invite flow comes next) so the two can't drift —
 * same reasoning as token-invite.ts: the behavior is identical, only the noun
 * differs.
 */
export class SendInviteEmailDto {
  @ApiPropertyOptional({
    description:
      "Override recipient. Defaults to the company's contact email on file.",
  })
  @IsOptional()
  @IsEmail()
  to?: string;

  @ApiPropertyOptional({
    description: 'Optional note included in the email body',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
