import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

/** Optional invite password rides in the POST body (never the URL). */
export class PublicResolveRfqDto {
  @ApiPropertyOptional() @IsOptional() @IsString() password?: string;
}

export class PublicQuoteLineDto {
  @ApiProperty() @IsString() @MinLength(1) rfqLineId!: string;
  @ApiProperty() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) unitPrice!: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) deliveryLeadTimeDays?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() remarks?: string;
}

/** Save-and-resume: partial quote is persisted; nothing locks until submit. */
export class PublicSaveQuoteDto {
  @ApiPropertyOptional() @IsOptional() @IsString() password?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) quotedLeadTimeDays?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() paymentTermsOffered?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) validityDays?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
  @ApiPropertyOptional({ type: [PublicQuoteLineDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PublicQuoteLineDto)
  lines?: PublicQuoteLineDto[];
}

/** Submit locks the quote. Every RFQ line must be priced. */
export class PublicSubmitQuoteDto {
  @ApiPropertyOptional() @IsOptional() @IsString() password?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) quotedLeadTimeDays?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() paymentTermsOffered?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) validityDays?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
  @ApiProperty({ type: [PublicQuoteLineDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PublicQuoteLineDto)
  @ArrayMinSize(1)
  lines!: PublicQuoteLineDto[];
}

export class PublicDeclineDto {
  @ApiPropertyOptional() @IsOptional() @IsString() password?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() declineReason?: string;
}

export class PublicQuoteAttachmentUploadUrlDto {
  @ApiPropertyOptional() @IsOptional() @IsString() password?: string;
  @ApiProperty() @IsString() @MinLength(1) name!: string;
  @ApiProperty() @IsString() @MinLength(1) mimeType!: string;
  @ApiProperty() @Type(() => Number) @IsInt() @Min(0) sizeBytes!: number;
}

export class PublicQuoteAttachmentConfirmDto {
  @ApiPropertyOptional() @IsOptional() @IsString() password?: string;
  @ApiProperty() @IsString() @MinLength(1) storageKey!: string;
  @ApiProperty() @IsString() @MinLength(1) name!: string;
}
