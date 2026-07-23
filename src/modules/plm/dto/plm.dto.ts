import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class PlmTransitionDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  comment?: string;
}

export class RejectPlmDesignReviewDto {
  @IsString()
  @MinLength(1)
  comment!: string;
}

export class LinkPlmProductionBoardDto {
  @IsUUID()
  boardId!: string;
}

export class AssignPlmOwnerDto {
  @IsUUID()
  ownerId!: string;
}

export class CreatePlmVendorInviteDto {
  @IsOptional() @IsInt() @Min(1) expiresInHours?: number;
  @IsOptional() @IsString() @MinLength(1) password?: string;
}

export class PlmPublicResolveDto {
  @IsOptional() @IsString() password?: string;
}

export class PlmUpdatePhotoDto {
  @IsString() @MinLength(1) storageKey!: string;
  @IsString() @MinLength(1) fileName!: string;
}

export class PlmProductionUpdateDto {
  @IsOptional() @IsString() password?: string;
  @Type(() => Number) @IsInt() @Min(0) @Max(100) fabricationPercent!: number;
  @Type(() => Number) @IsInt() @Min(0) @Max(100) surfaceFinishPercent!: number;
  @Type(() => Number) @IsInt() @Min(0) @Max(100) assemblyPercent!: number;
  @IsOptional() @IsString() notes?: string;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @ValidateNested({ each: true })
  @Type(() => PlmUpdatePhotoDto)
  photos?: PlmUpdatePhotoDto[];
}

export class PlmPhotoUploadUrlDto {
  @IsOptional() @IsString() password?: string;
  @IsString() @MinLength(1) name!: string;
  @IsString() @MinLength(1) mimeType!: string;
  @Type(() => Number) @IsInt() @Min(0) sizeBytes!: number;
}
