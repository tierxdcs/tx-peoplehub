import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';

/**
 * Request a presigned upload URL for a NEW VERSION of an existing file.
 * Only valid when the containing folder has versioningEnabled = true.
 */
export class CreateVersionUrlDto {
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
