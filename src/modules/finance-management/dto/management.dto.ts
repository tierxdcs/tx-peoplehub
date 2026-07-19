import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { FinanceScheduleType } from '@prisma/client';
export class BudgetLineDto {
  @ApiProperty() @IsString() periodId!: string;
  @ApiProperty() @IsString() accountId!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() costCenterId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() projectReference?: string;
  @ApiProperty() @Type(() => Number) @IsNumber() @Min(0) amount!: number;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
}
export class CreateBudgetDto {
  @ApiProperty() @IsString() @IsNotEmpty() name!: string;
  @ApiProperty() @IsString() fiscalYearId!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
  @ApiProperty({ type: [BudgetLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => BudgetLineDto)
  lines!: BudgetLineDto[];
}
export class RejectManagementDto {
  @ApiProperty() @IsString() @IsNotEmpty() comment!: string;
}
export class CreateFixedAssetDto {
  @ApiProperty() @IsString() @IsNotEmpty() name!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
  @ApiProperty() @IsDateString() purchaseDate!: string;
  @ApiProperty() @IsDateString() capitalizationDate!: string;
  @ApiProperty()
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  originalCost!: number;
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  residualValue?: number;
  @ApiProperty() @Type(() => Number) @IsInt() @Min(1) usefulLifeMonths!: number;
  @ApiPropertyOptional() @IsOptional() @IsString() location?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() serialNumber?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() vendorReference?: string;
  @ApiProperty() @IsString() assetAccountId!: string;
  @ApiProperty() @IsString() accumulatedDepreciationAccountId!: string;
  @ApiProperty() @IsString() depreciationExpenseAccountId!: string;
  @ApiProperty() @IsString() acquisitionCreditAccountId!: string;
}
export class CreateScheduleDto {
  @ApiProperty() @IsString() @IsNotEmpty() name!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
  @ApiProperty({ enum: FinanceScheduleType })
  @IsEnum(FinanceScheduleType)
  scheduleType!: FinanceScheduleType;
  @ApiProperty() @IsString() debitAccountId!: string;
  @ApiProperty() @IsString() creditAccountId!: string;
  @ApiProperty()
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  amountPerRun!: number;
  @ApiProperty() @IsDateString() startDate!: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() endDate?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  remainingRuns?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() costCenterId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() projectReference?: string;
}
export class RunAsOfDto {
  @ApiProperty() @IsDateString() asOf!: string;
}
export class ManagementRangeDto {
  @ApiProperty() @IsDateString() from!: string;
  @ApiProperty() @IsDateString() to!: string;
}
