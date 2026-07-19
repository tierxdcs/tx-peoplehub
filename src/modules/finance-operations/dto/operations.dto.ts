import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsInt,
  IsOptional,
  IsString,
} from 'class-validator';
import { BankMatchType } from '@prisma/client';

export class CreateBankAccountDto {
  @ApiProperty() @IsString() @IsNotEmpty() accountName!: string;
  @ApiProperty() @IsString() @IsNotEmpty() bankName!: string;
  @ApiProperty() @IsString() @IsNotEmpty() accountNumberLast4!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() ifscCode?: string;
  @ApiProperty() @IsString() @IsNotEmpty() ledgerAccountId!: string;
}

export class ImportBankStatementDto {
  @ApiProperty() @IsString() @IsNotEmpty() bankAccountId!: string;
  @ApiProperty() @IsDateString() periodFrom!: string;
  @ApiProperty() @IsDateString() periodTo!: string;
  @ApiProperty() @Type(() => Number) @IsNumber() openingBalance!: number;
  @ApiProperty() @Type(() => Number) @IsNumber() closingBalance!: number;
  @ApiProperty() @IsString() @IsNotEmpty() sourceFileName!: string;
  @ApiProperty({
    description:
      'UTF-8 CSV with date, description, reference, debit, credit and optional value_date/balance headers',
  })
  @IsString()
  @IsNotEmpty()
  csvText!: string;
}

export class MatchBankLineDto {
  @ApiProperty({ enum: BankMatchType })
  @IsEnum(BankMatchType)
  matchType!: BankMatchType;
  @ApiProperty() @IsString() @IsNotEmpty() transactionId!: string;
}

export class AcceptUnmatchedDto {
  @ApiProperty() @IsString() @IsNotEmpty() reason!: string;
}

export class RejectBankStatementDto {
  @ApiProperty() @IsString() @IsNotEmpty() comment!: string;
}

export class OperationsRangeDto {
  @ApiProperty() @IsDateString() from!: string;
  @ApiProperty() @IsDateString() to!: string;
}

export class ProductionSettingsDto {
  @ApiProperty() @IsObject() controlAccountMap!: Record<string, string>;
  @ApiProperty() @Type(() => Number) @IsInt() gstMaxAttempts!: number;
  @ApiProperty() @Type(() => Number) @IsInt() gstRetryDelayMinutes!: number;
}

export class OpeningBalanceImportDto {
  @ApiProperty() @IsString() @IsNotEmpty() sourceFileName!: string;
  @ApiProperty() @IsDateString() entryDate!: string;
  @ApiProperty({ description: 'CSV headers: account_code,description,debit,credit' })
  @IsString() @IsNotEmpty() csvText!: string;
}
