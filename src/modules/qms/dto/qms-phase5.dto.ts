import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsNotEmpty, IsObject, IsOptional, IsString, Min } from 'class-validator';
import { QmsCalibrationResult, QmsNcrSeverity } from '@prisma/client';

export class CreateQmsEquipmentDto {
  @IsString() @IsNotEmpty() equipmentCode!: string;
  @IsString() @IsNotEmpty() name!: string;
  @IsOptional() @IsString() serialNumber?: string;
  @IsOptional() @IsString() manufacturer?: string;
  @IsOptional() @IsString() model?: string;
  @IsOptional() @IsString() measurementRange?: string;
  @IsOptional() @IsString() leastCount?: string;
  @IsOptional() @IsString() location?: string;
  @IsString() custodianId!: string;
  @Type(() => Number) @IsInt() @Min(1) calibrationFrequencyDays!: number;
  @IsString() nextCalibrationDate!: string;
  @IsOptional() @IsString() notes?: string;
}

export class CreateQmsCalibrationDto {
  @IsString() calibrationDate!: string;
  @IsString() nextDueDate!: string;
  @IsEnum(QmsCalibrationResult) result!: QmsCalibrationResult;
  @IsOptional() @IsString() agency?: string;
  @IsOptional() @IsString() certificateNumber?: string;
  @IsOptional() @IsObject() certificateEvidence?: object;
  @IsOptional() @IsObject() observedResults?: object;
  @IsOptional() @IsString() remarks?: string;
}

export class CreateQmsComplaintDto {
  @IsString() customerId!: string;
  @IsOptional() @IsString() orderId?: string;
  @IsOptional() @IsString() productId?: string;
  @IsEnum(QmsNcrSeverity) severity!: QmsNcrSeverity;
  @IsString() reportedAt!: string;
  @IsOptional() @IsString() reportedBy?: string;
  @IsString() @IsNotEmpty() title!: string;
  @IsString() @IsNotEmpty() description!: string;
  @IsString() ownerId!: string;
  @IsString() targetDate!: string;
  @IsOptional() @IsString() immediateAction?: string;
}

export class InvestigateQmsComplaintDto {
  @IsString() @IsNotEmpty() investigation!: string;
  @IsString() @IsNotEmpty() responseToCustomer!: string;
}

export class CloseQmsComplaintDto {
  @IsString() @IsNotEmpty() closureNote!: string;
}
