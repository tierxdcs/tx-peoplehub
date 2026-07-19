import { Type } from 'class-transformer';
import { IsBoolean, IsDateString, IsEnum, IsNotEmpty, IsNumber, IsObject, IsOptional, IsString } from 'class-validator';
import { QmsDisposition, QmsNcrSeverity, QmsNcrSource } from '@prisma/client';
export class CreateQmsNcrDto {
 @IsEnum(QmsNcrSource) source!:QmsNcrSource; @IsOptional() @IsString() sourceId?:string; @IsOptional() @IsString() inspectionId?:string;
 @IsEnum(QmsNcrSeverity) severity!:QmsNcrSeverity; @IsString() @IsNotEmpty() title!:string; @IsString() @IsNotEmpty() description!:string;
 @IsOptional() @IsString() requirement?:string; @IsOptional() @IsString() actualResult?:string; @IsOptional() @IsString() productId?:string; @IsOptional() @IsString() orderId?:string; @IsOptional() @IsString() projectKickoffId?:string; @IsOptional() @IsString() grnId?:string; @IsOptional() @IsString() itemId?:string; @IsOptional() @IsString() batchOrSerial?:string;
 @IsOptional() @Type(()=>Number) @IsNumber() affectedQuantity?:number; @IsOptional() @Type(()=>Number) @IsNumber() costOfPoorQuality?:number;
 @IsString() ownerId!:string; @IsDateString() targetDate!:string;
}
export class ContainQmsNcrDto { @IsString() @IsNotEmpty() containmentAction!:string; }
export class DispositionQmsNcrDto { @IsEnum(QmsDisposition) disposition!:QmsDisposition; @IsOptional() @IsString() dispositionNotes?:string; @IsOptional() @IsBoolean() concessionRequired?:boolean; }
export class CreateQmsCapaDto { @IsString() problemStatement!:string; @IsString() ownerId!:string; @IsOptional() @IsString() rootCauseMethod?:string; @IsOptional() @IsObject() rootCauseAnalysis?:object; @IsOptional() @IsString() rootCauseConclusion?:string; @IsOptional() @IsString() correction?:string; @IsOptional() @IsString() effectivenessCriteria?:string; @IsOptional() @IsDateString() effectivenessDueDate?:string; }
export class AddQmsCapaActionDto { @IsString() actionType!:string; @IsString() description!:string; @IsString() ownerId!:string; @IsDateString() dueDate!:string; }
export class CompleteQmsCapaActionDto { @IsString() completionNote!:string; @IsOptional() @IsObject() evidence?:object; }
export class EffectivenessDto { @IsString() @IsNotEmpty() result!:string; }
