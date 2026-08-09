import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString, Min } from 'class-validator';

/**
 * Edit a single resource-plan line: the SCM-negotiated price per unit and/or a
 * free-text note. Both optional so the client can PATCH just one. Pass
 * `negotiatedPricePerUnit: null` to clear an entered price (falls the variance
 * back to "not yet negotiated"). The benchmark cost + required quantity are
 * snapshot-owned and never editable here.
 */
export class UpdateResourcePlanLineDto {
  @ApiPropertyOptional({
    nullable: true,
    description:
      'SCM-negotiated price per unit. null clears it (line reverts to benchmark-only).',
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  negotiatedPricePerUnit?: number | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  notes?: string | null;
}
