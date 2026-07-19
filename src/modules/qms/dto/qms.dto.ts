import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsEnum, IsNotEmpty, IsNumber, IsObject, IsOptional, IsString, ValidateNested } from 'class-validator';
import { QmsControlPoint, QmsInspectionResult, QmsResponseType, QmsTemplateType } from '@prisma/client';
export class QmsQuestionDto {
  @ApiProperty() @IsString() section!: string;
  @ApiProperty() @Type(()=>Number) @IsNumber() sequence!: number;
  @ApiProperty() @IsString() @IsNotEmpty() prompt!: string;
  @ApiProperty({enum:QmsResponseType}) @IsEnum(QmsResponseType) responseType!: QmsResponseType;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() required?: boolean;
  @ApiPropertyOptional() @IsOptional() @Type(()=>Number) @IsNumber() weight?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() unit?: string;
  @ApiPropertyOptional() @IsOptional() @Type(()=>Number) @IsNumber() lowerLimit?: number;
  @ApiPropertyOptional() @IsOptional() @Type(()=>Number) @IsNumber() upperLimit?: number;
  @ApiPropertyOptional() @IsOptional() @IsArray() options?: string[];
  @ApiPropertyOptional() @IsOptional() @IsString() acceptanceCriteria?: string;
}
export class CreateQmsTemplateDto {
  @ApiProperty() @IsString() templateCode!: string;
  @ApiProperty() @IsString() name!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
  @ApiProperty({enum:QmsTemplateType}) @IsEnum(QmsTemplateType) templateType!: QmsTemplateType;
  @ApiProperty({type:[QmsQuestionDto]}) @IsArray() @ValidateNested({each:true}) @Type(()=>QmsQuestionDto) questions!: QmsQuestionDto[];
}
export class QmsPlanStageDto {
  @IsString() name!:string; @IsString() stageCode!:string; @Type(()=>Number) @IsNumber() sequence!:number;
  @IsEnum(QmsControlPoint) controlPoint!:QmsControlPoint; @IsString() templateId!:string;
  @IsOptional() @IsBoolean() customerWitnessRequired?:boolean; @IsOptional() @IsBoolean() blocksNextStage?:boolean; @IsOptional() @IsString() instructions?:string;
}
export class CreateQmsPlanDto {
  @IsString() name!:string; @IsOptional() @IsString() description?:string; @IsOptional() @IsString() productId?:string; @IsOptional() @IsString() orderId?:string; @IsOptional() @IsString() projectKickoffId?:string;
  @IsArray() @ValidateNested({each:true}) @Type(()=>QmsPlanStageDto) stages!:QmsPlanStageDto[];
}
export class CreateQmsInspectionDto {
  @IsString() templateId!:string; @IsOptional() @IsString() planId?:string; @IsOptional() @IsString() planStageId?:string; @IsOptional() @IsString() productId?:string; @IsOptional() @IsString() orderId?:string; @IsOptional() @IsString() projectKickoffId?:string; @IsOptional() @IsString() grnId?:string; @IsOptional() @IsString() batchOrSerial?:string; @IsOptional() @IsString() assignedToId?:string; @IsOptional() @Type(()=>Number) @IsNumber() quantityOffered?:number;
}
export class QmsResponseDto { @IsString() questionKey!:string; @IsObject() answer!:object; @IsOptional() @IsEnum(QmsInspectionResult) result?:QmsInspectionResult; @IsOptional() @IsString() comments?:string; @IsOptional() @IsObject() evidence?:object; }
export class CompleteQmsInspectionDto {
  @IsArray() @ValidateNested({each:true}) @Type(()=>QmsResponseDto) responses!:QmsResponseDto[];
  @IsEnum(QmsInspectionResult) overallResult!:QmsInspectionResult;
  @IsOptional() @Type(()=>Number) @IsNumber() quantityInspected?:number; @IsOptional() @Type(()=>Number) @IsNumber() quantityAccepted?:number; @IsOptional() @Type(()=>Number) @IsNumber() quantityRejected?:number; @IsOptional() @IsString() remarks?:string;
}
