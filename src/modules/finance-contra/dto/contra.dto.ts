import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
} from 'class-validator';

export class CreateContraVoucherDto {
  @ApiProperty() @IsDateString() voucherDate!: string;
  @ApiProperty() @IsUUID() fromLedgerAccountId!: string;
  @ApiProperty() @IsUUID() toLedgerAccountId!: string;
  @ApiProperty() @IsNumber() @IsPositive() amount!: number;
  @ApiPropertyOptional() @IsOptional() @IsString() narration?: string;
}

export class RejectContraVoucherDto {
  @ApiProperty() @IsString() @IsNotEmpty() comment!: string;
}
