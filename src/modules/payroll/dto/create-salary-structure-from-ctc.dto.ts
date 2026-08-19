import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsNumber, IsUUID, Min } from 'class-validator';

/**
 * CTC-only input for a salary revision (hike/promotion). The server runs the
 * exact same reverse-solve as onboarding (OnboardingCompensationService) to
 * derive every component from the target monthly CTC — the browser never sends
 * trusted component amounts. Appends a new effective-dated row; history is
 * never overwritten.
 */
export class CreateSalaryStructureFromCtcDto {
  @ApiProperty()
  @IsUUID()
  employeeId!: string;

  @ApiProperty({ example: 100000, description: 'Target monthly CTC in INR' })
  @IsNumber()
  @Min(1)
  monthlyCtc!: number;

  @ApiProperty({ example: '2026-08-19' })
  @IsDateString()
  effectiveDate!: string;
}
