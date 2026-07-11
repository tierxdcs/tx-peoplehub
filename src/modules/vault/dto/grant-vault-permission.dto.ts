import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { VaultGranteeType } from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

export class GrantVaultPermissionDto {
  @ApiProperty({ enum: VaultGranteeType })
  @IsEnum(VaultGranteeType)
  granteeType!: VaultGranteeType;

  @ApiProperty({
    description:
      'Employee id, Vertical id, or Role name (SUPER_ADMIN/ADMIN/MANAGER/EMPLOYEE) per granteeType',
  })
  @IsString()
  @MinLength(1)
  granteeId!: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  canRead?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  canWrite?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  canDelete?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  canCreateSubfolder?: boolean;
}
