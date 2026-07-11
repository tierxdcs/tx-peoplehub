import { ApiProperty } from '@nestjs/swagger';
import { PreviewStatus, VaultFileStatus } from '@prisma/client';
import { VaultAccessEntity } from './vault-folder.entity';

export class VaultFileVersionEntity {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  fileId!: string;

  @ApiProperty()
  versionNumber!: number;

  @ApiProperty()
  mimeType!: string;

  @ApiProperty({ description: 'Size in bytes (serialized as string — BigInt)' })
  sizeBytes!: string;

  @ApiProperty()
  storageKey!: string;

  @ApiProperty({ nullable: true })
  previewStorageKey!: string | null;

  @ApiProperty({ enum: PreviewStatus })
  previewStatus!: PreviewStatus;

  @ApiProperty({ nullable: true })
  changeNote!: string | null;

  @ApiProperty()
  uploadedById!: string;

  @ApiProperty()
  createdAt!: Date;

  constructor(partial: Partial<VaultFileVersionEntity>) {
    Object.assign(this, partial);
  }
}

export class VaultFileEntity {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  folderId!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ nullable: true })
  currentVersionId!: string | null;

  @ApiProperty()
  uploadedById!: string;

  @ApiProperty({ enum: VaultFileStatus })
  status!: VaultFileStatus;

  @ApiProperty({ type: VaultFileVersionEntity, required: false })
  currentVersion?: VaultFileVersionEntity;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;

  constructor(partial: Partial<VaultFileEntity>) {
    Object.assign(this, partial);
  }
}

/**
 * A file enriched for list/detail rendering (spec §3): the flat file plus the
 * current version's display fields, a version count, and the caller's computed
 * access on it (so the UI can show/hide View/Download/Share/Delete per row).
 * This is what the folder file-list and single-file GET return — distinct from
 * the lean VaultFileEntity that mutation endpoints echo back.
 */
export class VaultFileListItemEntity {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  folderId!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ nullable: true })
  currentVersionId!: string | null;

  @ApiProperty({ enum: VaultFileStatus })
  status!: VaultFileStatus;

  @ApiProperty()
  uploadedById!: string;

  @ApiProperty({
    nullable: true,
    description: 'Display name of the current version uploader, if resolvable',
  })
  uploadedByName!: string | null;

  @ApiProperty({
    nullable: true,
    description: 'Current version size in bytes (string — BigInt)',
  })
  sizeBytes!: string | null;

  @ApiProperty({ nullable: true })
  mimeType!: string | null;

  @ApiProperty({ enum: PreviewStatus, nullable: true })
  previewStatus!: PreviewStatus | null;

  @ApiProperty({ description: 'Number of retained versions for this file' })
  versionCount!: number;

  @ApiProperty({
    type: VaultAccessEntity,
    description: "The caller's computed effective access on this file",
  })
  access!: VaultAccessEntity;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty({
    description: 'Last-modified: the current version created-at when available',
  })
  updatedAt!: Date;

  constructor(partial: Partial<VaultFileListItemEntity>) {
    Object.assign(this, partial);
  }
}

/** A presigned upload URL + the pending file/version it was minted for. */
export class UploadUrlResponseEntity {
  @ApiProperty()
  file!: VaultFileEntity;

  @ApiProperty()
  versionId!: string;

  @ApiProperty()
  storageKey!: string;

  @ApiProperty({
    description: 'Presigned PUT URL — upload bytes here directly',
  })
  uploadUrl!: string;

  @ApiProperty()
  expiresInSeconds!: number;

  constructor(partial: Partial<UploadUrlResponseEntity>) {
    Object.assign(this, partial);
  }
}

/** A presigned download/preview GET URL. */
export class DownloadUrlResponseEntity {
  @ApiProperty()
  downloadUrl!: string;

  @ApiProperty()
  expiresInSeconds!: number;

  constructor(partial: Partial<DownloadUrlResponseEntity>) {
    Object.assign(this, partial);
  }
}

/**
 * Status-aware preview response. `viewUrl`/`expiresInSeconds` are set only
 * when previewStatus = READY; otherwise the UI reads `previewStatus` to show
 * "Preparing preview…" (PENDING) or "download to view" (FAILED/NOT_APPLICABLE)
 * rather than getting an error.
 */
export class ViewUrlResponseEntity {
  @ApiProperty({ enum: PreviewStatus })
  previewStatus!: PreviewStatus;

  @ApiProperty({ nullable: true })
  viewUrl!: string | null;

  @ApiProperty({ nullable: true })
  expiresInSeconds!: number | null;

  constructor(partial: Partial<ViewUrlResponseEntity>) {
    Object.assign(this, partial);
  }
}
