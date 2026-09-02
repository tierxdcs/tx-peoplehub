import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { EmploymentType } from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';

/**
 * Create or update authored offer-letter content.
 *
 * Exactly one anchor identifies the letter:
 *  - `candidateApplicationId` — the normal path. A new letter is addressed to a
 *    SELECTED applicant, months before any Employee row exists.
 *  - `offerLetterId` — edit a letter that already exists (either kind).
 *  - `employeeId` — edit a legacy employee-anchored letter written before
 *    candidate-anchoring. New employee-anchored letters are no longer created:
 *    an offer precedes the hire, it does not follow it.
 *
 * The `offered*` terms are the letter's own copy of the employment terms and are
 * required to create a candidate-anchored letter (there is no Employee row to
 * read them from). They are ignored for a legacy employee-anchored letter, whose
 * Employee row remains the source of truth.
 */
export class SaveOfferLetterDto {
  @ApiPropertyOptional({ description: 'Edit an existing letter by its id' })
  @IsOptional()
  @IsUUID()
  offerLetterId?: string;

  @ApiPropertyOptional({
    description: 'Legacy employee-anchored letter (edit only)',
  })
  @IsOptional()
  @IsUUID()
  employeeId?: string;

  @ApiPropertyOptional({
    description: 'The SELECTED candidate application this offer is made to',
  })
  @IsOptional()
  @IsUUID()
  candidateApplicationId?: string;

  @ApiPropertyOptional({ example: 'Design Engineer' })
  @IsOptional()
  @IsString()
  offeredDesignation?: string;

  @ApiPropertyOptional({ enum: EmploymentType })
  @IsOptional()
  @IsEnum(EmploymentType)
  offeredEmploymentType?: EmploymentType;

  @ApiPropertyOptional({ example: '2026-10-01' })
  @IsOptional()
  @IsDateString()
  offeredDateOfJoining?: string;

  @ApiPropertyOptional({ example: 'Bangalore HQ' })
  @IsOptional()
  @IsString()
  offeredWorkLocation?: string;

  @ApiPropertyOptional({ example: 'South India' })
  @IsOptional()
  @IsString()
  offeredTerritory?: string;

  @ApiPropertyOptional({
    example: 35195,
    description:
      'Monthly CTC offered (INR). Annexure A is derived from this through the same calculator onboarding uses.',
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  offeredMonthlyCtc?: number;

  @ApiPropertyOptional({
    description:
      'Employee the candidate will report to. Send null to clear it. Shown as “Reports To” on the letter.',
    nullable: true,
  })
  @IsOptional()
  @IsUUID()
  reportsToId?: string | null;

  @ApiProperty()
  @IsString()
  keyResponsibilities!: string;

  @ApiProperty()
  @IsString()
  kpis!: string;
}
