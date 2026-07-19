import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class CreateFxRunDto {
  @ApiProperty() @IsString() periodId!: string;
  @ApiProperty() @IsObject() closingRates!: Record<string, number>;
  @ApiProperty() @IsString() gainAccountId!: string;
  @ApiProperty() @IsString() lossAccountId!: string;
}
export class ReverseFxDto {
  @ApiProperty() @IsDateString() reversalDate!: string;
}
export class CreditControlDto {
  @ApiProperty() @IsString() customerId!: string;
  @ApiProperty()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  creditLimitInr!: number;
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  overdueGraceDays?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() blockOnLimit?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() blockOnOverdue?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsDateString() reviewDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
}
export class CreditOverrideDto {
  @ApiProperty() @IsString() @IsNotEmpty() reason!: string;
}
export class FxSettingsDto {
  @ApiProperty() @IsString() gainAccountId!: string;
  @ApiProperty() @IsString() lossAccountId!: string;
}
export class ApplyAdvanceDto {
  @ApiProperty() @IsIn(['CUSTOMER', 'VENDOR']) side!: 'CUSTOMER' | 'VENDOR';
  @ApiProperty() @IsString() sourceId!: string;
  @ApiProperty() @IsString() targetInvoiceId!: string;
  @ApiProperty() @IsDateString() applicationDate!: string;
  @ApiProperty() @Type(() => Number) @IsNumber() @Min(0.01) amount!: number;
}
