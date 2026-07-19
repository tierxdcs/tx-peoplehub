import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';
import { CashFlowCategory } from '@prisma/client';
export class ReportingRangeDto {
  @ApiProperty() @IsDateString() from!: string;
  @ApiProperty() @IsDateString() to!: string;
}
export class CashFlowMappingDto {
  @ApiProperty({ enum: CashFlowCategory })
  @IsEnum(CashFlowCategory)
  category!: CashFlowCategory;
}
export class CreatePackDto extends ReportingRangeDto {
  @ApiProperty() @IsString() @IsNotEmpty() title!: string;
}
export class AuditorGrantDto {
  @ApiProperty() @IsString() employeeId!: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() expiresAt?: string;
}
export class CreateRolloverDto {
  @ApiProperty() @IsString() sourceFiscalYearId!: string;
  @ApiProperty() @IsString() targetFiscalYearId!: string;
  @ApiProperty() @IsString() retainedEarningsAccountId!: string;
}
