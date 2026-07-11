import { ApiPropertyOptional } from '@nestjs/swagger';
import { VaultFolderStatus } from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from 'class-validator';

/**
 * Rename / archive / toggle versioning. Scope and type are immutable after
 * creation in this phase (moving/rescoping a folder is a later-phase concern
 * with sharing implications).
 */
export class UpdateVaultFolderDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @ApiPropertyOptional({ enum: VaultFolderStatus })
  @IsOptional()
  @IsEnum(VaultFolderStatus)
  status?: VaultFolderStatus;

  @ApiPropertyOptional({
    description: 'Not togglable on PERSONAL folders',
  })
  @IsOptional()
  @IsBoolean()
  versioningEnabled?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  maxVersionsRetained?: number;
}
