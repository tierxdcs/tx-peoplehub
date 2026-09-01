import { Type } from 'class-transformer';
import { DesignPriority } from '@prisma/client';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
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
  /** The date Sales has promised the customer a price. */
  @IsOptional() @IsDateString() expectedBy?: string;
  @IsOptional() @IsString() @MinLength(1) fileKey?: string;
  @IsOptional() @IsString() @MinLength(1) fileName?: string;
  /**
   * The customer stated a requirement, not a parts list: the design team has to
   * design the product and author the BOM. The intake is still created (finished
   * good item, Product, promised date — everything the quote hangs off), it just
   * starts with no lines and no BOM, and parks in DESIGN_PENDING until the
   * designed BOM is handed over.
   */
  @IsOptional() @IsBoolean() requiresDesign?: boolean;
  @IsArray()
  // A design-required intake has nothing to transcribe yet; every other one must
  // carry at least one line, or there is no BOM to source from.
  @ValidateIf((dto: CreateCustomerBomIntakeDto) => dto.requiresDesign !== true)
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CustomerBomIntakeLineDto)
  lines!: CustomerBomIntakeLineDto[];
}

/**
 * Sales hands a design-required intake to the design team. The brief is the only
 * thing Sales can supply that the design team cannot derive — what the customer
 * actually asked for — so it is mandatory and substantial.
 */
export class SendBomIntakeToDesignDto {
  @IsOptional() @IsString() @MinLength(3) @MaxLength(200) title?: string;
  @IsString() @MinLength(20) @MaxLength(4000) description!: string;
  @IsOptional() @IsEnum(DesignPriority) priority?: DesignPriority;
  /**
   * When the design team has to be done. Defaults to the date Sales promised the
   * customer a price, since that is the real deadline the design sits inside.
   */
  @IsOptional() @IsDateString() targetDate?: string;
}

/**
 * The design team's finished parts list for a design-required intake. Same line
 * shape (and same Item Master resolution rules) as a Sales transcription — the
 * BOM this produces is indistinguishable from a transcribed one, which is the
 * whole point: SCM's RFQ path needs no special case.
 */
export class HandoverDesignBomDto {
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CustomerBomIntakeLineDto)
  lines!: CustomerBomIntakeLineDto[];
}

/**
 * The promised date usually gets agreed after the transcription is already in,
 * so it stays editable for the life of the intake. `null` clears it, which
 * simply takes the register's progress bar away again.
 */
export class UpdateCustomerBomIntakeDto {
  @IsOptional()
  @ValidateIf((dto: UpdateCustomerBomIntakeDto) => dto.expectedBy !== null)
  @IsDateString()
  expectedBy?: string | null;
}
