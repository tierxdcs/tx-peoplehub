import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import {
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
} from 'class-validator';

export class GrantAccessDto {
  @ApiProperty({
    enum: Role,
    description: 'SUPER_ADMIN cannot be granted here',
  })
  @IsEnum(Role)
  role!: Role;

  @ApiProperty({
    description: 'Confirms or overrides the vertical set during onboarding',
  })
  @IsUUID()
  verticalId!: string;

  @ApiPropertyOptional({
    description: 'Required for every role except SUPER_ADMIN',
  })
  @IsOptional()
  @IsUUID()
  reportingManagerId?: string;

  @ApiProperty({ example: 'S3curePass!', minLength: 8 })
  @IsString()
  @MinLength(8)
  password!: string;
}
