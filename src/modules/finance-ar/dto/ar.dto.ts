import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
  Matches,
  ValidateNested,
} from 'class-validator';

export class CreateMilestoneDto {
  @ApiProperty() @IsString() @IsNotEmpty() name!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  @Max(100)
  percentage?: number;
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  fixedAmount?: number;
  @ApiPropertyOptional() @IsOptional() @IsDateString() plannedDate?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sequence?: number;
}

export class InvoiceLineDto {
  @ApiPropertyOptional() @IsOptional() @IsString() productId?: string;
  @ApiProperty() @IsString() @IsNotEmpty() description!: string;
  @ApiProperty() @IsString() @IsNotEmpty() hsnSacCode!: string;
  @ApiProperty() @Type(() => Number) @IsNumber() @Min(0.0001) quantity!: number;
  @ApiProperty() @IsString() @IsNotEmpty() unitOfMeasure!: string;
  @ApiProperty() @Type(() => Number) @IsNumber() @Min(0) unitPrice!: number;
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  discountPercent?: number;
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  cgstRate?: number;
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  sgstRate?: number;
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  igstRate?: number;
}

export class CreateSalesInvoiceDto {
  @ApiProperty() @IsString() customerId!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() orderId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() milestoneId?: string;
  @ApiProperty() @IsDateString() invoiceDate!: string;
  @ApiProperty() @IsDateString() dueDate!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() customerPoReference?: string;
  @ApiProperty({ enum: ['INR', 'USD', 'CAD', 'EUR'] })
  @IsString()
  @Length(3, 3)
  currencyCode!: string;
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.000001)
  exchangeRateToInr?: number;
  @ApiProperty() @IsString() @IsNotEmpty() placeOfSupplyState!: string;
  @ApiProperty() @IsString() @Length(2, 2) placeOfSupplyStateCode!: string;
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
  roundOff?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() paymentTerms?: string;
  @ApiProperty({ type: [InvoiceLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => InvoiceLineDto)
  lines!: InvoiceLineDto[];
}

export class RejectArDto {
  @ApiProperty() @IsString() @IsNotEmpty() comment!: string;
}

export class ReceiptAllocationDto {
  @ApiProperty() @IsString() invoiceId!: string;
  @ApiProperty() @Type(() => Number) @IsNumber() @Min(0.01) amount!: number;
}

export class CreateCustomerReceiptDto {
  @ApiProperty() @IsString() customerId!: string;
  @ApiProperty() @IsDateString() receiptDate!: string;
  @ApiProperty({ enum: ['INR', 'USD', 'CAD', 'EUR'] })
  @IsString()
  @Length(3, 3)
  currencyCode!: string;
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.000001)
  exchangeRateToInr?: number;
  @ApiProperty() @Type(() => Number) @IsNumber() @Min(0.01) amount!: number;
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  tdsDeducted?: number;
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  bankCharges?: number;
  @ApiProperty() @IsString() @IsNotEmpty() paymentMethod!: string;
  @ApiProperty() @IsString() @IsNotEmpty() bankReference!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
  @ApiPropertyOptional({ type: [ReceiptAllocationDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReceiptAllocationDto)
  allocations?: ReceiptAllocationDto[];
}

export class CompanySettingsDto {
  @ApiProperty() @IsString() @IsNotEmpty() legalName!: string;
  @ApiProperty() @IsString() @IsNotEmpty() gstin!: string;
  @ApiProperty() @IsString() @IsNotEmpty() addressLine1!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() addressLine2?: string;
  @ApiProperty() @IsString() @IsNotEmpty() city!: string;
  @ApiProperty() @IsString() @IsNotEmpty() state!: string;
  @ApiProperty() @IsString() @Length(2, 2) stateCode!: string;
  @ApiProperty() @IsString() @IsNotEmpty() postalCode!: string;
  @ApiPropertyOptional() @IsOptional() @Matches(/^[A-Z]{5}[0-9]{4}[A-Z]$/) pan?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(/^[A-Z]{4}[0-9]{5}[A-Z]$/) tan?: string;
}

export class GenerateEwayBillDto {
  @ApiProperty() @IsString() @IsNotEmpty() transporterId!: string;
  @ApiProperty() @IsString() @IsNotEmpty() transporterName!: string;
  @ApiProperty() @IsString() @IsNotEmpty() transportMode!: string;
  @ApiProperty() @IsString() @IsNotEmpty() transportDocumentNumber!: string;
  @ApiProperty() @IsDateString() transportDocumentDate!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() vehicleNumber?: string;
  @ApiProperty() @Type(() => Number) @IsInt() @Min(1) distanceKm!: number;
}
