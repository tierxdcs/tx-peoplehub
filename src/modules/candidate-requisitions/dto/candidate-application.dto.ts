import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from 'class-validator';
import { CandidateApplicationStatus } from '@prisma/client';

export class CreateCandidateApplicationInviteDto {
  @ApiPropertyOptional({ description: 'Optional link password; blank means public' })
  @IsOptional() @IsString() password?: string;
  @ApiPropertyOptional({ default: 2160, description: 'Link lifetime in hours' })
  @IsOptional() @IsInt() @Min(1) expiresInHours?: number;
}

export class CandidateApplicationResolveDto {
  @ApiPropertyOptional() @IsOptional() @IsString() password?: string;
}

export class CandidateResumeUploadUrlDto extends CandidateApplicationResolveDto {
  @ApiProperty() @IsString() @MinLength(1) fileName!: string;
  @ApiProperty() @IsString() mimeType!: string;
  @ApiProperty() @IsInt() @Min(1) sizeBytes!: number;
}

export class SubmitCandidateApplicationDto extends CandidateApplicationResolveDto {
  @ApiProperty() @IsString() @MinLength(1) name!: string;
  @ApiProperty() @IsString() @MinLength(3) contact!: string;
  @ApiProperty() @IsString() @MinLength(1) areaOfExpertise!: string;
  @ApiProperty() @IsNumber() @Min(0) totalExperienceYears!: number;
  @ApiProperty() @IsNumber() @Min(0) relevantExperienceYears!: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) currentCtc?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) expectedCtc?: number;
  @ApiProperty() @IsString() @MinLength(1) aboutExperience!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() projects?: string;
  @ApiProperty() @IsString() resumeFileKey!: string;
  @ApiProperty() @IsString() resumeFileName!: string;
  @ApiProperty() @IsInt() @Min(1) resumeFileSize!: number;
  @ApiProperty() @IsString() resumeMimeType!: string;
}

export class UpdateCandidateApplicationStatusDto {
  @ApiProperty({ enum: CandidateApplicationStatus })
  @IsEnum(CandidateApplicationStatus)
  status!: CandidateApplicationStatus;
}
