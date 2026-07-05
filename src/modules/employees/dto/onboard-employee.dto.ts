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
  @ApiProperty({ example: 50000 })
  @IsNumber()
  @Min(0)
  basicSalary!: number;

  @ApiProperty({ example: 10000 })
  @IsNumber()
  @Min(0)
  hra!: number;

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
  @ApiProperty({ example: 'Jane' })
  @IsString()
  firstName!: string;

  @ApiProperty({ example: 'Doe' })
  @IsString()
  lastName!: string;

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
