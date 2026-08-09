import { EmploymentType } from '@prisma/client';
import { IsDateString, IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateCandidateRequisitionDto {
  @IsString() @MaxLength(200) positionTitle!: string;
  @IsEnum(EmploymentType) employmentType!: EmploymentType;
  @IsString() @MaxLength(5000) justification!: string;
  @IsOptional() @IsDateString() targetJoiningDate?: string;
}

export class RejectCandidateRequisitionDto {
  @IsString() @MaxLength(2000) comment!: string;
}
