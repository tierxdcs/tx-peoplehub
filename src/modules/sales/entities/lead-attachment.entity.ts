import { ApiProperty } from '@nestjs/swagger';
import { PreviewStatus } from '@prisma/client';

/**
 * A file attached to a lead. Carries the linking row's id plus the underlying
 * VaultFile's id/name/preview status, so the frontend can render the list and
 * open the Vault PreviewModal (which only needs the vaultFileId).
 */
export class LeadAttachmentEntity {
  @ApiProperty() id!: string;
  @ApiProperty() leadId!: string;
  @ApiProperty() vaultFileId!: string;
  @ApiProperty() fileName!: string;
  @ApiProperty({ nullable: true }) mimeType!: string | null;
  @ApiProperty({ nullable: true, description: 'Bytes, as a string' })
  sizeBytes!: string | null;
  @ApiProperty({ enum: PreviewStatus, nullable: true })
  previewStatus!: PreviewStatus | null;
  @ApiProperty() uploadedById!: string;
  @ApiProperty({ nullable: true }) uploadedByName!: string | null;
  @ApiProperty() createdAt!: string;

  constructor(partial: Partial<LeadAttachmentEntity>) {
    Object.assign(this, partial);
  }
}
