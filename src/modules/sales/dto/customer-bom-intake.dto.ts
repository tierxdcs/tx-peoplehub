import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class CustomerBomUploadUrlDto {
  @IsString() @MinLength(1) fileName!: string;
  @IsString() @MinLength(1) mimeType!: string;
  @Type(() => Number) @IsInt() @Min(1) fileSize!: number;
}

export class CustomerBomMatchDto {
  @IsString() @MinLength(2) description!: string;
}

export class CustomerBomIntakeLineDto {
  @IsString() @MinLength(1) description!: string;
  @IsOptional() @IsString() customerPartReference?: string;
  @IsNumber({ maxDecimalPlaces: 4 }) @Min(0.0001) quantity!: number;
  @IsString() @MinLength(1) unitOfMeasure!: string;
  @IsOptional() @IsString() existingItemId?: string;
  @IsBoolean() confirmCreateNew!: boolean;
}

/**
 * Sales quote-stage revision of an intake's DRAFT BOM. The full replacement
 * line set (same shape/validation as creation) plus a mandatory "what changed"
 * note that becomes the new revision's revisionNotes — the history entry.
 */
export class ReviseCustomerBomIntakeDto {
  @IsString() @MinLength(3) @MaxLength(2000) revisionNotes!: string;
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CustomerBomIntakeLineDto)
  lines!: CustomerBomIntakeLineDto[];
}

export class CreateCustomerBomIntakeDto {
  @IsString() @MinLength(1) businessUnitId!: string;
  @IsString() @MinLength(1) productName!: string;
  @IsString() @MinLength(1) unitOfMeasure!: string;
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(99.99)
  targetMarginPercent?: number;
  @IsString() @MinLength(1) fileKey!: string;
  @IsString() @MinLength(1) fileName!: string;
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CustomerBomIntakeLineDto)
  lines!: CustomerBomIntakeLineDto[];
}
