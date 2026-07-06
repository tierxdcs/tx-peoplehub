import { ApiPropertyOptional } from '@nestjs/swagger';
import { LeadPriority, LeadSource, LeadStatus } from '@prisma/client';
import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

/**
 * General field edits + status transitions short of conversion. Moving a
 * lead to DISQUALIFIED requires disqualifiedReason (enforced in the
 * service). CONVERTED is set only via POST /leads/:id/convert, never here.
 */
export class UpdateLeadDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  companyName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  contactName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  requirement?: string;

  @ApiPropertyOptional({ enum: LeadPriority })
  @IsOptional()
  @IsEnum(LeadPriority)
  priority?: LeadPriority;

  @ApiPropertyOptional({ enum: LeadSource })
  @IsOptional()
  @IsEnum(LeadSource)
  source?: LeadSource;

  @ApiPropertyOptional({
    enum: LeadStatus,
    description:
      'NEW/CONTACTED/QUALIFIED/DISQUALIFIED. CONVERTED is set via /convert only.',
  })
  @IsOptional()
  @IsEnum(LeadStatus)
  status?: LeadStatus;

  @ApiPropertyOptional({ description: 'Required when moving to DISQUALIFIED' })
  @IsOptional()
  @IsString()
  disqualifiedReason?: string;
}
