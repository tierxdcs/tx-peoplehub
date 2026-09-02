import { CandidateHiringStage, EmploymentType } from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateCandidateRequisitionDto {
  @IsString() @MaxLength(200) positionTitle!: string;
  @IsEnum(EmploymentType) employmentType!: EmploymentType;
  @IsString() @MaxLength(5000) justification!: string;
  /** Key responsibilities of the role. Mandatory — approvers assess scope. */
  @IsString() @MaxLength(5000) keyResponsibilities!: string;
  /** Key performance indicators (KPIs) for the role. Mandatory. */
  @IsString() @MaxLength(5000) keyPerformanceIndicators!: string;
  /** Annual CTC hiring budget (INR). Required — approvers weigh headcount cost. */
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(999999999999)
  budgetAnnualCtc!: number;
  @IsOptional() @IsDateString() targetJoiningDate?: string;
  /** Raise N identical requisitions in one submit (same title, budget, JD).
   * Each position stays its own approval → offer → onboarding unit, so this
   * multiplies rows rather than adding a headcount column. Default 1. */
  @IsOptional() @IsInt() @Min(1) @Max(20) numberOfPositions?: number;
}

export class RejectCandidateRequisitionDto {
  @IsString() @MaxLength(2000) comment!: string;
}

/** HR's manual hiring-progress update. Only the pre-offer stages are settable
 *  here: Offer Extended follows from sending an approved offer letter, and
 *  Candidate Selected from onboarding the candidate who accepted it. The selected
 *  candidate's name is likewise taken from the accepted offer, never typed. */
export class UpdateCandidateHiringLifecycleDto {
  @IsEnum(CandidateHiringStage)
  hiringStage!: CandidateHiringStage;
}
