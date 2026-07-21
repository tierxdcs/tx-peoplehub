import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

/**
 * Link an already-uploaded, confirmed VaultFile to a lead. The browser does the
 * Vault upload (upload-url → PUT → confirm-upload) into the Sales "Lead
 * Attachments" folder, then posts the resulting file id here to record the link.
 */
export class AttachLeadFileDto {
  @ApiProperty({ description: 'A confirmed VaultFile id (from the Vault upload flow)' })
  @IsUUID()
  vaultFileId!: string;
}
