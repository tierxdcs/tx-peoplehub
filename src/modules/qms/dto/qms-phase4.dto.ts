import { IsBoolean, IsEnum, IsNotEmpty, IsObject, IsOptional, IsString } from 'class-validator';
import { QmsReportType } from '@prisma/client';

export class GenerateQmsReportDto {
  @IsEnum(QmsReportType) reportType!: QmsReportType;
  @IsString() sourceId!: string;
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsBoolean() customerSignatureRequired?: boolean;
}

export class SignQmsReportCustomerDto {
  @IsString() @IsNotEmpty() signerName!: string;
  @IsOptional() @IsString() designation?: string;
  @IsOptional() @IsString() organisation?: string;
  @IsString() @IsNotEmpty() signatureText!: string;
  @IsOptional() @IsObject() evidence?: object;
}

export class ReviseQmsReportDto {
  @IsString() @IsNotEmpty() reason!: string;
  @IsOptional() @IsBoolean() customerSignatureRequired?: boolean;
}
