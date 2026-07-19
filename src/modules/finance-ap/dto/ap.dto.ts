import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Min,
  ValidateNested,
} from 'class-validator';

export class ApInvoiceLineDto {
  @ApiProperty() @IsString() @IsNotEmpty() description!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() hsnSacCode?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() purchaseOrderLineId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() grnLineId?: string;
  @ApiProperty() @Type(() => Number) @IsNumber() @Min(0.0001) quantity!: number;
  @ApiProperty() @IsString() @IsNotEmpty() unitOfMeasure!: string;
  @ApiProperty() @Type(() => Number) @IsNumber() @Min(0) unitPrice!: number;
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  taxAmount?: number;
}

export class CreateApInvoiceDto {
  @ApiPropertyOptional() @IsOptional() @IsString() supplierId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() vendorId?: string;
  @ApiProperty() @IsString() @IsNotEmpty() externalInvoiceNumber!: string;
  @ApiProperty() @IsDateString() invoiceDate!: string;
  @ApiProperty() @IsDateString() receivedDate!: string;
  @ApiProperty() @IsDateString() dueDate!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() purchaseOrderId?: string;
  @ApiProperty({ enum: ['INR', 'USD', 'CAD', 'EUR'] })
  @IsString()
  @Length(3, 3)
  currencyCode!: string;
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.000001)
  exchangeRateToInr?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() supplierGstin?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  otherCharges?: number;
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  inputCgstAmount?: number;
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  inputSgstAmount?: number;
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  inputIgstAmount?: number;
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  tdsAmount?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
  @ApiProperty({ type: [ApInvoiceLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ApInvoiceLineDto)
  lines!: ApInvoiceLineDto[];
}

export class ApApprovalDto {
  @ApiPropertyOptional() @IsOptional() @IsString() overrideReason?: string;
}
export class RejectApDto {
  @ApiProperty() @IsString() @IsNotEmpty() comment!: string;
}

export class ApPaymentAllocationDto {
  @ApiProperty() @IsString() invoiceId!: string;
  @ApiProperty() @Type(() => Number) @IsNumber() @Min(0.01) amount!: number;
}
export class CreateApPaymentDto {
  @ApiPropertyOptional() @IsOptional() @IsString() supplierId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() vendorId?: string;
  @ApiProperty() @IsDateString() plannedDate!: string;
  @ApiProperty({ enum: ['INR', 'USD', 'CAD', 'EUR'] })
  @IsString()
  @Length(3, 3)
  currencyCode!: string;
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.000001)
  exchangeRateToInr?: number;
  @ApiProperty() @Type(() => Number) @IsNumber() @Min(0.01) amount!: number;
  @ApiProperty() @IsString() @IsNotEmpty() paymentMethod!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
  @ApiPropertyOptional({ type: [ApPaymentAllocationDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ApPaymentAllocationDto)
  allocations?: ApPaymentAllocationDto[];
}
export class ExecutePaymentDto {
  @ApiProperty() @IsDateString() executedDate!: string;
  @ApiProperty() @IsString() @IsNotEmpty() bankReference!: string;
}
