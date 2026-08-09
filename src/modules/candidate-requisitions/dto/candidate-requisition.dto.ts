import { EmploymentType } from '@prisma/client';
import { IsDateString, IsEnum, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class CreateCandidateRequisitionDto {
  @IsString() @MaxLength(200) positionTitle!: string;
  @IsEnum(EmploymentType) employmentType!: EmploymentType;
  @IsString() @MaxLength(5000) justification!: string;
  /** Annual CTC hiring budget (INR). Required — approvers weigh headcount cost. */
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(1) @Max(999999999999) budgetAnnualCtc!: number;
  @IsOptional() @IsDateString() targetJoiningDate?: string;
}

export class RejectCandidateRequisitionDto {
  @IsString() @MaxLength(2000) comment!: string;
}
