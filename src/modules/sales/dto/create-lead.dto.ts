import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { LeadPriority, LeadSource } from '@prisma/client';
import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
} from 'class-validator';

export class CreateLeadDto {
  @ApiProperty({ example: 'Globex Manufacturing' })
  @IsString()
  @MinLength(1)
  companyName!: string;

  @ApiProperty({ example: 'Priya Sharma' })
  @IsString()
  @MinLength(1)
  contactName!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiProperty({ example: 'Liquid Cooling LC25 — 500 nos' })
  @IsString()
  @MinLength(1)
  requirement!: string;

  @ApiPropertyOptional({ enum: LeadPriority, default: LeadPriority.MEDIUM })
  @IsOptional()
  @IsEnum(LeadPriority)
  priority?: LeadPriority;

  @ApiPropertyOptional({ enum: LeadSource, default: LeadSource.OTHER })
  @IsOptional()
  @IsEnum(LeadSource)
  source?: LeadSource;

  @ApiPropertyOptional({
    description:
      'Owning Sales rep. Defaults to the creating user; only MANAGER/SUPER_ADMIN may assign another owner.',
  })
  @IsOptional()
  @IsUUID()
  ownerId?: string;
}
