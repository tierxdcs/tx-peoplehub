import { Type } from 'class-transformer';
import { IsArray, IsEnum, IsNotEmpty, IsObject, IsOptional, IsString, ValidateNested } from 'class-validator';
import { QmsAuditFindingType, QmsInspectionResult, QmsTemplateType } from '@prisma/client';

export class QmsAuditProgramItemDto {
  @IsString() @IsNotEmpty() title!: string;
  @IsEnum(QmsTemplateType) auditType!: QmsTemplateType;
  @IsString() @IsNotEmpty() scope!: string;
  @IsString() @IsNotEmpty() criteria!: string;
  @IsString() plannedFrom!: string;
  @IsString() plannedTo!: string;
  @IsOptional() @IsString() department?: string;
  @IsOptional() @IsString() supplierId?: string;
  @IsString() leadAuditorId!: string;
  @IsOptional() @IsString() auditeeId?: string;
  @IsString() templateId!: string;
}

export class CreateQmsAuditProgramDto {
  @IsString() @IsNotEmpty() name!: string;
  @IsOptional() @IsString() description?: string;
  @IsString() financialYear!: string;
  @IsArray() @ValidateNested({ each: true }) @Type(() => QmsAuditProgramItemDto) items!: QmsAuditProgramItemDto[];
}

export class CreateQmsAuditDto extends QmsAuditProgramItemDto {
  @IsOptional() @IsString() programId?: string;
  @IsOptional() @IsString() programItemId?: string;
  @IsOptional() @IsString() openingNotes?: string;
}

export class QmsAuditResponseDto {
  @IsString() questionKey!: string;
  @IsObject() answer!: object;
  @IsOptional() @IsEnum(QmsInspectionResult) result?: QmsInspectionResult;
  @IsOptional() @IsString() comments?: string;
  @IsOptional() @IsObject() evidence?: object;
}

export class QmsAuditFindingDto {
  @IsEnum(QmsAuditFindingType) findingType!: QmsAuditFindingType;
  @IsOptional() @IsString() clause?: string;
  @IsString() @IsNotEmpty() description!: string;
  @IsOptional() @IsString() evidence?: string;
  @IsOptional() @IsString() ownerId?: string;
  @IsOptional() @IsString() targetDate?: string;
}

export class CompleteQmsAuditDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => QmsAuditResponseDto) responses!: QmsAuditResponseDto[];
  @IsArray() @ValidateNested({ each: true }) @Type(() => QmsAuditFindingDto) findings!: QmsAuditFindingDto[];
  @IsString() @IsNotEmpty() conclusion!: string;
}

export class ReviewQmsAuditDto {
  @IsOptional() @IsString() closureNote?: string;
}
