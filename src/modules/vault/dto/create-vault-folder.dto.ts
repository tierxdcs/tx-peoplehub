import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { VaultFolderType, VaultVisibilityScope } from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  MinLength,
} from 'class-validator';

export class CreateVaultFolderDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  name!: string;

  @ApiProperty({
    enum: [VaultFolderType.DEFAULT, VaultFolderType.CUSTOM],
    description:
      'PERSONAL folders are auto-provisioned at onboarding, never created via API',
  })
  @IsIn([VaultFolderType.DEFAULT, VaultFolderType.CUSTOM])
  type!: typeof VaultFolderType.DEFAULT | typeof VaultFolderType.CUSTOM;

  @ApiPropertyOptional({ description: 'Parent folder for nesting' })
  @IsOptional()
  @IsUUID()
  parentFolderId?: string;

  @ApiPropertyOptional({
    enum: VaultVisibilityScope,
    description:
      'DEFAULT folders: COMPANY_WIDE, VERTICAL, or PRIVATE (required). CUSTOM folders: ignored — always TEAM.',
  })
  @IsOptional()
  @IsEnum(VaultVisibilityScope)
  visibilityScope?: VaultVisibilityScope;

  @ApiPropertyOptional({
    description: 'Required when visibilityScope = VERTICAL',
  })
  @IsOptional()
  @IsUUID()
  scopeVerticalId?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  versioningEnabled?: boolean;

  @ApiPropertyOptional({ default: 5 })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxVersionsRetained?: number;
}
