import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  AccountType,
  AccountingPeriodStatus,
  NormalBalance,
} from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';

export class CreateFiscalYearDto {
  @ApiProperty({ example: 'FY 2026-27' }) @IsString() @IsNotEmpty() name!: string;
  @ApiProperty({ example: 2026 }) @Type(() => Number) @IsInt() @Min(2000) startYear!: number;
}

export class UpdatePeriodStatusDto {
  @ApiProperty({ enum: AccountingPeriodStatus })
  @IsEnum(AccountingPeriodStatus)
  status!: AccountingPeriodStatus;
}

export class CreateAccountDto {
  @ApiProperty() @IsString() @Matches(/^[A-Z0-9.-]+$/) code!: string;
  @ApiProperty() @IsString() @IsNotEmpty() name!: string;
  @ApiProperty({ enum: AccountType }) @IsEnum(AccountType) accountType!: AccountType;
  @ApiProperty({ enum: NormalBalance }) @IsEnum(NormalBalance) normalBalance!: NormalBalance;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() parentId?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isControlAccount?: boolean;
}

export class UpdateAccountDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @IsNotEmpty() name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() parentId?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

export class CreateCostCenterDto {
  @ApiProperty() @IsString() @Matches(/^[A-Z0-9.-]+$/) code!: string;
  @ApiProperty() @IsString() @IsNotEmpty() name!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
}

export class CreateExchangeRateDto {
  @ApiProperty({ enum: ['USD', 'CAD', 'EUR'] })
  @IsString() @Length(3, 3) currencyCode!: string;
  @ApiProperty() @IsDateString() effectiveOn!: string;
  @ApiProperty({ description: 'INR value of one unit of foreign currency' })
  @Type(() => Number) @IsNumber() @Min(0.000001) rateToInr!: number;
  @ApiProperty() @IsString() @IsNotEmpty() source!: string;
}

export class JournalLineDto {
  @ApiProperty() @IsString() accountId!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
  @ApiPropertyOptional({ default: 0 }) @Type(() => Number) @IsNumber() @Min(0) debit = 0;
  @ApiPropertyOptional({ default: 0 }) @Type(() => Number) @IsNumber() @Min(0) credit = 0;
  @ApiPropertyOptional() @IsOptional() @IsString() costCenterId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() projectReference?: string;
}

export class CreateJournalDto {
  @ApiProperty() @IsDateString() entryDate!: string;
  @ApiProperty() @IsString() @IsNotEmpty() description!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() reference?: string;
  @ApiProperty({ type: [JournalLineDto] })
  @IsArray() @ArrayMinSize(2) @ValidateNested({ each: true }) @Type(() => JournalLineDto)
  lines!: JournalLineDto[];
}

export class RejectFinanceDto {
  @ApiProperty() @IsString() @IsNotEmpty() comment!: string;
}

export class ReportQueryDto {
  @ApiProperty() @IsDateString() from!: string;
  @ApiProperty() @IsDateString() to!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() accountId?: string;
}

/** The Tally-style voucher categories the Day Book can be filtered to. */
export const DAYBOOK_VOUCHER_TYPES = [
  'SALES',
  'PURCHASE',
  'RECEIPT',
  'PAYMENT',
  'JOURNAL',
] as const;
export type DaybookVoucherType = (typeof DAYBOOK_VOUCHER_TYPES)[number];

/**
 * Day Book query — a chronological, read-only register spanning every voucher
 * type. Defaults are applied in the service (today's date) when from/to are
 * omitted, so an unparameterised call still returns a useful "today" view.
 */
export class DaybookQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsDateString() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() to?: string;
  @ApiPropertyOptional({ enum: DAYBOOK_VOUCHER_TYPES })
  @IsOptional()
  @IsEnum(DAYBOOK_VOUCHER_TYPES as unknown as string[])
  voucherType?: DaybookVoucherType;
  @ApiPropertyOptional() @IsOptional() @IsString() status?: string;
}
