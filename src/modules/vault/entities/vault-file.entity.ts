import { ApiProperty } from '@nestjs/swagger';
import { PreviewStatus, VaultFileStatus } from '@prisma/client';
import {
  VaultFileOrigin,
  VaultFileTypeCategory,
} from '../dto/vault-search-query.dto';
import { VaultAccessEntity, VaultFolderEntity } from './vault-folder.entity';

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

  @ApiProperty({
    enum: VaultFileTypeCategory,
    description:
      'Type bucket derived from the filename extension and mimetype (drives the type filter and the type sort)',
  })
  fileType!: VaultFileTypeCategory;

  @ApiProperty({
    enum: VaultFileOrigin,
    description:
      'Which module filed this document, derived from back-relations and module-owned folder identity; MANUAL when a person uploaded it',
  })
  origin!: VaultFileOrigin;

  @ApiProperty({
    nullable: true,
    description:
      'Name of the containing folder — search results are shown outside their folder',
  })
  folderName!: string | null;

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

/**
 * Result of a Vault search: matching folders AND matching files, since people
 * look for "the RFQ folder" as often as for a specific document. `truncated`
 * says the scan cap was reached, so the UI can tell the user to narrow rather
 * than silently implying it saw everything.
 */
export class VaultSearchResultEntity {
  @ApiProperty({
    type: [VaultFolderEntity],
    description: 'Folders whose name matched, in relevance order',
  })
  folders!: VaultFolderEntity[];

  @ApiProperty({
    type: [VaultFileListItemEntity],
    description: 'Matching files, in the requested sort order',
  })
  files!: VaultFileListItemEntity[];

  @ApiProperty({
    description: 'Files matched before the result limit was applied',
  })
  totalFileMatches!: number;

  @ApiProperty({
    description:
      'True when more candidate files existed than the scan cap allowed — narrow the search',
  })
  truncated!: boolean;

  constructor(partial: Partial<VaultSearchResultEntity>) {
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
