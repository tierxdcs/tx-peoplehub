import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  OrderConfirmationDeliveryType,
  OrderConfirmationQualityReport,
} from '@prisma/client';
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

/**
 * Create the first DRAFT sheet for an order. Only the orderId is strictly
 * required at creation — the rep fills the rest before generating the PDF,
 * and `generate-pdf` enforces the full required-field set (including the
 * structured packaging block, §2.1). requirementsOverview is pre-filled from
 * the linked Bid's technicalSpecification server-side if the caller omits it.
 */
export class CreateConfirmationSheetDto {
  @ApiPropertyOptional({
    description:
      'Defaults to the linked Bid technicalSpecification if omitted.',
  })
  @IsOptional()
  @IsString()
  requirementsOverview?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  deliveryDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  deliveryLocation?: string;

  @ApiPropertyOptional({ enum: OrderConfirmationDeliveryType })
  @IsOptional()
  @IsEnum(OrderConfirmationDeliveryType)
  deliveryType?: OrderConfirmationDeliveryType;

  @ApiPropertyOptional({
    enum: OrderConfirmationQualityReport,
    isArray: true,
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsEnum(OrderConfirmationQualityReport, { each: true })
  qualityReportsExpected?: OrderConfirmationQualityReport[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  qualityReportNotes?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  installationCommissioningRequired?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  installationNotes?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  warrantyTerms?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  paymentMilestones?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  siteReadinessRequirements?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  specialHandlingInstructions?: string;

  // Packaging (§2.1) — accepted at create but only enforced non-empty at
  // generate-pdf, so a rep can save an in-progress DRAFT.
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  packagingType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  protectiveMeasures?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  packagingComplianceStandard?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  labelingRequirements?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  customerPackagingSpecReference?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  customerContactName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  customerContactPhone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  customerContactEmail?: string;
}

/** All fields editable while DRAFT (same shape as create, minus server bits). */
export class UpdateConfirmationSheetDto extends CreateConfirmationSheetDto {}

/** Sales Head rejection — comments mandatory (same rule as Bid/No-Bid). */
export class RejectConfirmationSheetDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  comments!: string;
}

/** Confirm a signed-copy upload — the storageKey the client PUT to. */
export class ConfirmSignedCopyDto {
  @ApiProperty({ description: 'The storageKey returned by upload-url.' })
  @IsString()
  @MinLength(1)
  storageKey!: string;
}
