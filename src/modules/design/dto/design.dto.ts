import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
} from 'class-validator';
import {
  DesignCustomerApprovalStatus,
  DesignChangeDisposition,
  DesignChangeEffectivityType,
  DesignChangeObjectType,
  DesignChangeType,
  DesignReviewType,
  DesignDocumentType,
  DesignMilestoneStatus,
  DesignPriority,
  DesignProjectStatus,
  DesignRequestSource,
  DesignRequirementCategory,
  DesignRequirementStatus,
  DesignVerificationMethod,
} from '@prisma/client';
export class CreateDesignRequestDto {
  @IsEnum(DesignRequestSource) source!: DesignRequestSource;
  @IsString() @IsNotEmpty() title!: string;
  @IsString() @IsNotEmpty() description!: string;
  @IsOptional() @IsEnum(DesignPriority) priority?: DesignPriority;
  @IsOptional() @IsString() productId?: string;
  @IsOptional() @IsString() customerId?: string;
  @IsOptional() @IsString() orderId?: string;
  @IsOptional() @IsString() projectKickoffId?: string;
  @IsOptional() @IsString() ownerId?: string;
  @IsString() targetDate!: string;
}
export class CreateDesignProjectDto {
  @IsOptional() @IsString() requestId?: string;
  @IsString() @IsNotEmpty() name!: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() productId?: string;
  @IsOptional() @IsString() customerId?: string;
  @IsOptional() @IsString() orderId?: string;
  @IsOptional() @IsString() projectKickoffId?: string;
  @IsString() leadDesignerId!: string;
  @IsString() targetDate!: string;
}
export class UpdateDesignProjectStatusDto {
  @IsEnum(DesignProjectStatus) status!: DesignProjectStatus;
}
export class CreateDesignDocumentDto {
  @IsString() projectId!: string;
  @IsString() @IsNotEmpty() title!: string;
  @IsEnum(DesignDocumentType) documentType!: DesignDocumentType;
  @IsString() vaultFileId!: string;
  @IsString() vaultFileVersionId!: string;
  @IsOptional() @IsString() revisionCode?: string;
  @IsString() @IsNotEmpty() changeSummary!: string;
  @IsOptional() @IsBoolean() customerApprovalRequired?: boolean;
}
export class CreateDesignRevisionDto {
  @IsString() vaultFileVersionId!: string;
  @IsString() @IsNotEmpty() revisionCode!: string;
  @IsString() @IsNotEmpty() changeSummary!: string;
  @IsOptional() @IsBoolean() customerApprovalRequired?: boolean;
}
export class RejectDesignRevisionDto {
  @IsString() @IsNotEmpty() reason!: string;
}
export class CheckDesignRevisionDto {
  @IsString() @IsNotEmpty() checkNote!: string;
}
export class CreateDesignRequirementDto {
  @IsString() projectId!: string;
  @IsEnum(DesignRequirementCategory) category!: DesignRequirementCategory;
  @IsString() @IsNotEmpty() description!: string;
  @IsOptional() @IsString() source?: string;
  @IsString() @IsNotEmpty() acceptanceCriteria!: string;
  @IsEnum(DesignVerificationMethod)
  verificationMethod!: DesignVerificationMethod;
}
export class VerifyDesignRequirementDto {
  @IsEnum(DesignRequirementStatus) status!: DesignRequirementStatus;
  @IsString() @IsNotEmpty() result!: string;
  @IsOptional() @IsObject() evidence?: object;
}
export class CreateDesignMilestoneDto {
  @IsString() projectId!: string;
  @IsString() @IsNotEmpty() title!: string;
  @IsOptional() @IsString() description?: string;
  @IsString() ownerId!: string;
  @IsString() dueDate!: string;
}
export class UpdateDesignMilestoneDto {
  @IsEnum(DesignMilestoneStatus) status!: DesignMilestoneStatus;
  @IsOptional() @IsObject() evidence?: object;
}
export class RecordCustomerApprovalDto {
  @IsEnum(DesignCustomerApprovalStatus) status!: DesignCustomerApprovalStatus;
  @IsString() @IsNotEmpty() customerApproverName!: string;
  @IsOptional() @IsString() designation?: string;
  @IsOptional() @IsString() organisation?: string;
  @IsOptional() @IsString() approvalReference?: string;
  @IsOptional() @IsObject() evidence?: object;
  @IsOptional() @IsString() comments?: string;
}

export class CreateDesignChangeDto {
  @IsString() projectId!: string;
  @IsString() @IsNotEmpty() title!: string;
  @IsEnum(DesignChangeType) type!: DesignChangeType;
  @IsOptional() @IsEnum(DesignPriority) priority?: DesignPriority;
  @IsString() @IsNotEmpty() reason!: string;
  @IsString() @IsNotEmpty() proposedChange!: string;
  @IsString() coordinatorId!: string;
  @IsString() targetDate!: string;
}

export class CompleteDesignChangeImpactDto {
  @IsBoolean() hasImpact!: boolean;
  @IsString() @IsNotEmpty() assessment!: string;
  @IsOptional() @IsString() requiredAction?: string;
}

export class AssignDesignChangeImpactDto {
  @IsString() ownerId!: string;
}

export class AddDesignChangeAffectedItemDto {
  @IsEnum(DesignChangeObjectType) objectType!: DesignChangeObjectType;
  @IsOptional() @IsString() objectId?: string;
  @IsString() @IsNotEmpty() reference!: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() currentRevision?: string;
  @IsOptional() @IsString() proposedRevision?: string;
  @IsEnum(DesignChangeEffectivityType)
  effectivityType!: DesignChangeEffectivityType;
  @IsOptional() @IsString() effectivityValue?: string;
}

export class UpdateDesignChangeDispositionDto {
  @IsEnum(DesignChangeDisposition) disposition!: DesignChangeDisposition;
  @IsOptional() @IsString() dispositionNote?: string;
}

export class DesignChangeDecisionDto {
  @IsOptional() @IsString() reason?: string;
}

export class AddDesignChangeAcknowledgementDto {
  @IsString() @IsNotEmpty() functionName!: string;
  @IsString() ownerId!: string;
}

export class AcknowledgeDesignChangeDto {
  @IsOptional() @IsString() comments?: string;
}

export class CloseDesignChangeDto {
  @IsString() @IsNotEmpty() implementationNote!: string;
}

export class CreateDesignReviewDto {
  @IsString() projectId!: string;
  @IsOptional() @IsString() changeId?: string;
  @IsEnum(DesignReviewType) reviewType!: DesignReviewType;
  @IsString() @IsNotEmpty() title!: string;
  @IsString() @IsNotEmpty() objectives!: string;
  @IsString() scheduledAt!: string;
  @IsOptional() @IsString() locationOrLink?: string;
  @IsString() chairpersonId!: string;
}

export class AddDesignReviewAttendeeDto {
  @IsOptional() @IsString() employeeId?: string;
  @IsString() @IsNotEmpty() name!: string;
  @IsOptional() @IsString() functionName?: string;
  @IsOptional() @IsBoolean() external?: boolean;
}

export class RecordDesignReviewDto {
  @IsString() @IsNotEmpty() minutes!: string;
  @IsString() @IsNotEmpty() decision!: string;
  @IsOptional() @IsArray() attendedIds?: string[];
}

export class AddDesignReviewActionDto {
  @IsString() @IsNotEmpty() description!: string;
  @IsString() ownerId!: string;
  @IsString() dueDate!: string;
}

export class CompleteDesignReviewActionDto {
  @IsString() @IsNotEmpty() completionNote!: string;
}

export class CreateDesignProjectTemplateDto {
  @IsString() @IsNotEmpty() name!: string;
  @IsOptional() @IsString() description?: string;
  @IsArray() requirements!: object[];
  @IsArray() milestones!: object[];
}

export class ApplyDesignProjectTemplateDto {
  @IsString() projectId!: string;
  @IsString() defaultOwnerId!: string;
  @IsString() startDate!: string;
}

export class CreateDesignTransmittalDto {
  @IsString() projectId!: string;
  @IsString() @IsNotEmpty() purpose!: string;
  @IsString() @IsNotEmpty() recipientOrganisation!: string;
  @IsString() @IsNotEmpty() recipientName!: string;
  @IsOptional() @IsString() recipientEmail?: string;
  @IsOptional() @IsString() message?: string;
  @IsArray() revisionIds!: string[];
}

export class AcknowledgeDesignTransmittalDto {
  @IsString() @IsNotEmpty() acknowledgedByName!: string;
  @IsOptional() @IsString() acknowledgementNote?: string;
}

export class GenerateDesignChangeReportDto {
  @IsString() changeId!: string;
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsBoolean() customerSignatureRequired?: boolean;
}

export class SignDesignChangeReportCustomerDto {
  @IsString() @IsNotEmpty() signerName!: string;
  @IsOptional() @IsString() designation?: string;
  @IsOptional() @IsString() organisation?: string;
  @IsString() @IsNotEmpty() signatureText!: string;
  @IsOptional() @IsObject() evidence?: object;
}

export class ReviseDesignChangeReportDto {
  @IsString() @IsNotEmpty() reason!: string;
  @IsOptional() @IsBoolean() customerSignatureRequired?: boolean;
}
