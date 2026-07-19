import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { NcrDispositionType } from '@prisma/client';

/**
 * Record a disposition on an OPEN NCR (RETURN_TO_SUPPLIER / SCRAP / USE_AS_IS /
 * REWORK). This moves the NCR to DISPOSITIONED. Never affects stock — the
 * rejected quantity never entered stock in the first place.
 */
export class DispositionNcrDto {
  @ApiProperty({ enum: NcrDispositionType })
  @IsEnum(NcrDispositionType)
  disposition!: NcrDispositionType;

  @ApiPropertyOptional() @IsOptional() @IsString() dispositionNotes?: string;
}
