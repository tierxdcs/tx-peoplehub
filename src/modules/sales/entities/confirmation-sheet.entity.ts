import { ApiProperty } from '@nestjs/swagger';
import {
  OrderConfirmationDeliveryType,
  OrderConfirmationQualityReport,
  OrderConfirmationStatus,
  SignatureFont,
} from '@prisma/client';

/**
 * Wire shape for an Order Confirmation Sheet. Dates are ISO strings; the
 * signed-copy download URL is populated on demand (not persisted) by the
 * download-url endpoint, so it's absent on list/detail reads.
 */
export class ConfirmationSheetEntity {
  @ApiProperty() id!: string;
  @ApiProperty() confirmationNumber!: string;
  @ApiProperty() orderId!: string;
  @ApiProperty() revisionNumber!: number;
  @ApiProperty({ enum: OrderConfirmationStatus })
  status!: OrderConfirmationStatus;

  @ApiProperty() requirementsOverview!: string;
  @ApiProperty({ nullable: true }) deliveryDate!: string | null;
  @ApiProperty() deliveryLocation!: string;
  @ApiProperty({ enum: OrderConfirmationDeliveryType, nullable: true })
  deliveryType!: OrderConfirmationDeliveryType | null;

  @ApiProperty({ enum: OrderConfirmationQualityReport, isArray: true })
  qualityReportsExpected!: OrderConfirmationQualityReport[];
  @ApiProperty({ nullable: true }) qualityReportNotes!: string | null;

  @ApiProperty() installationCommissioningRequired!: boolean;
  @ApiProperty({ nullable: true }) installationNotes!: string | null;

  @ApiProperty() warrantyTerms!: string;
  @ApiProperty() paymentMilestones!: string;
  @ApiProperty({ nullable: true }) siteReadinessRequirements!: string | null;
  @ApiProperty({ nullable: true }) specialHandlingInstructions!: string | null;

  @ApiProperty() packagingType!: string;
  @ApiProperty() protectiveMeasures!: string;
  @ApiProperty({ nullable: true }) packagingComplianceStandard!: string | null;
  @ApiProperty() labelingRequirements!: string;
  @ApiProperty({ nullable: true })
  customerPackagingSpecReference!: string | null;

  @ApiProperty() customerContactName!: string;
  @ApiProperty() customerContactPhone!: string;
  @ApiProperty() customerContactEmail!: string;

  @ApiProperty({ nullable: true }) pdfGeneratedAt!: string | null;
  @ApiProperty({ description: 'Whether a signed copy has been uploaded.' })
  hasSignedCopy!: boolean;
  @ApiProperty({ nullable: true }) signedCopyUploadedById!: string | null;
  @ApiProperty({ nullable: true }) signedCopyUploadedAt!: string | null;

  @ApiProperty({ nullable: true }) internalSignedById!: string | null;
  @ApiProperty({ nullable: true }) internalSignedByName!: string | null;
  @ApiProperty({ nullable: true }) internalSignedAt!: string | null;
  @ApiProperty({ nullable: true }) internalReviewComments!: string | null;
  @ApiProperty({ nullable: true })
  approverSignatureTextSnapshot!: string | null;
  @ApiProperty({ enum: SignatureFont, nullable: true })
  approverSignatureFontSnapshot!: SignatureFont | null;

  @ApiProperty() createdById!: string;
  @ApiProperty() createdAt!: string;
  @ApiProperty() updatedAt!: string;

  constructor(partial: Partial<ConfirmationSheetEntity>) {
    Object.assign(this, partial);
  }
}
