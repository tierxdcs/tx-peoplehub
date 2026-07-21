import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { EmploymentType, Role } from '@prisma/client';
import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
} from 'class-validator';

export class CreateEmployeeDto {
  @ApiProperty({ example: 'Jane' })
  @IsString()
  firstName!: string;

  @ApiProperty({ example: 'Doe' })
  @IsString()
  lastName!: string;

  @ApiProperty({ example: 'jane.doe@peoplehub.local' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'S3curePass!', minLength: 8 })
  @IsString()
  @MinLength(8)
  password!: string;

  @ApiProperty({ enum: Role })
  @IsEnum(Role)
  role!: Role;

  @ApiPropertyOptional({
    description: 'Required for every role except SUPER_ADMIN',
  })
  @IsOptional()
  @IsUUID()
  verticalId?: string;

  @ApiPropertyOptional({
    description: 'Required for every role except SUPER_ADMIN',
  })
  @IsOptional()
  @IsUUID()
  reportingManagerId?: string;

  @ApiPropertyOptional({ description: 'Job title, e.g. "Senior Design Engineer"' })
  @IsOptional()
  @IsString()
  designation?: string;

  @ApiPropertyOptional({ enum: EmploymentType })
  @IsOptional()
  @IsEnum(EmploymentType)
  employmentType?: EmploymentType;

  @ApiPropertyOptional({ description: 'Work location / office, e.g. "Bengaluru"' })
  @IsOptional()
  @IsString()
  workLocation?: string;
}
