import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  MinLength,
} from 'class-validator';

/**
 * Request a presigned upload URL for a NEW file in a folder. A file cannot
 * be created without a folder (folderId required). sizeBytes/mimeType are the
 * client's declared expectations, verified against R2 metadata at confirm.
 */
export class CreateUploadUrlDto {
  @ApiProperty()
  @IsUUID()
  folderId!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  name!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  mimeType!: string;

  @ApiProperty({ description: 'Expected size in bytes' })
  @IsInt()
  @Min(0)
  sizeBytes!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  changeNote?: string;
}
