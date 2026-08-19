import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { EmploymentType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEmail,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class OnboardCompensationDto {
  @ApiProperty({ example: 35195, description: 'Target monthly CTC in INR' })
  @IsNumber()
  @Min(1)
  monthlyCtc!: number;

  @ApiProperty({ example: '2026-07-05' })
  @IsDateString()
  effectiveDate!: string;
}

export class OnboardStatutoryDto {
  @ApiProperty({ example: 'ABCDE1234F' })
  @IsString()
  @MinLength(4)
  panNumber!: string;

  @ApiProperty({ example: '1234', description: 'Last 4 digits only' })
  @IsString()
  @MinLength(4)
  aadhaarLast4!: string;

  @ApiProperty({ example: 'PF1234567890' })
  @IsString()
  @MinLength(4)
  pfAccountNumber!: string;

  @ApiPropertyOptional({ example: 'ESIC1234567890' })
  @IsOptional()
  @IsString()
  esicNumber?: string;
}

export class OnboardBankDetailsDto {
  @ApiProperty({ example: '000123456789' })
  @IsString()
  @MinLength(4)
  bankAccountNumber!: string;

  @ApiProperty({ example: 'HDFC0001234' })
  @IsString()
  ifscCode!: string;
}

export class OnboardEmployeeDto {
  @ApiPropertyOptional({
    description:
      'Approved-offer requisition to link to this onboarding. Optional for exception hires.',
  })
  @IsOptional()
  @IsUUID()
  candidateRequisitionId?: string;

  @ApiProperty({ example: 'Jane' })
  @IsString()
  firstName!: string;

  @ApiProperty({ example: 'Doe' })
  @IsString()
  lastName!: string;

  @ApiPropertyOptional({
    example: 'jane.doe@phaze-dynamics.com',
    description:
      'Optional HR override. When omitted, firstname.lastname@phaze-dynamics.com is generated with a collision-safe suffix.',
  })
  @IsOptional()
  @IsEmail()
  officialEmail?: string;

  @ApiProperty({ example: '1995-05-20' })
  @IsDateString()
  dateOfBirth!: string;

  @ApiProperty({ example: 'Female' })
  @IsString()
  gender!: string;

  @ApiProperty({ example: 'jane.doe@gmail.com' })
  @IsEmail()
  personalEmail!: string;

  @ApiProperty({ example: '+91 9876543210' })
  @IsString()
  mobile!: string;

  @ApiProperty({ example: 'Design Engineer' })
  @IsString()
  designation!: string;

  @ApiProperty({ enum: EmploymentType })
  @IsEnum(EmploymentType)
  employmentType!: EmploymentType;

  @ApiProperty({ example: '2026-07-05' })
  @IsDateString()
  dateOfJoining!: string;

  @ApiProperty({ example: 'Bangalore HQ' })
  @IsString()
  workLocation!: string;

  @ApiPropertyOptional({ example: 'South India' })
  @IsOptional()
  @IsString()
  territory?: string;

  @ApiProperty({
    description:
      'Any existing vertical — HR onboarding is a cross-vertical exception',
  })
  @IsUUID()
  verticalId!: string;

  @ApiProperty({ example: 'Jane Roe' })
  @IsString()
  emergencyContactName!: string;

  @ApiProperty({ example: 'Spouse' })
  @IsString()
  emergencyContactRelation!: string;

  @ApiProperty({ example: '+91 9876500000' })
  @IsString()
  emergencyContactPhone!: string;

  @ApiPropertyOptional({
    description:
      'R2 object key of an already-uploaded employee photo (from /employees/photo-upload-url)',
  })
  @IsOptional()
  @IsString()
  photoStorageKey?: string;

  @ApiProperty({ type: OnboardCompensationDto })
  @ValidateNested()
  @Type(() => OnboardCompensationDto)
  compensation!: OnboardCompensationDto;

  @ApiProperty({ type: OnboardStatutoryDto })
  @ValidateNested()
  @Type(() => OnboardStatutoryDto)
  statutoryInfo!: OnboardStatutoryDto;

  @ApiProperty({ type: OnboardBankDetailsDto })
  @ValidateNested()
  @Type(() => OnboardBankDetailsDto)
  bankDetails!: OnboardBankDetailsDto;
}
