import { ApiProperty } from '@nestjs/swagger';
import { VaultSharePermission, VaultShareResourceType } from '@prisma/client';

/** The created link, returned to the creator. Includes the full shareable token. */
export class VaultExternalShareLinkEntity {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: VaultShareResourceType })
  resourceType!: VaultShareResourceType;

  @ApiProperty()
  resourceId!: string;

  @ApiProperty({ description: 'The public token — embed in the shareable URL' })
  token!: string;

  @ApiProperty({ enum: VaultSharePermission })
  permission!: VaultSharePermission;

  @ApiProperty({ nullable: true })
  pinnedVersionId!: string | null;

  @ApiProperty()
  hasPassword!: boolean;

  @ApiProperty()
  expiresAt!: Date;

  @ApiProperty({ nullable: true })
  revokedAt!: Date | null;

  @ApiProperty()
  createdById!: string;

  @ApiProperty()
  createdAt!: Date;

  constructor(partial: Partial<VaultExternalShareLinkEntity>) {
    Object.assign(this, partial);
  }
}

/**
 * An existing external link, as listed for the resource's manager (spec §5.2):
 * the created-link shape plus a live `accessCount` (number of logged access
 * attempts) so the UI can show how often a link has been hit. The token is
 * still included so the copy-link action keeps working from the list.
 */
export class VaultExternalShareLinkListItemEntity extends VaultExternalShareLinkEntity {
  @ApiProperty({ description: 'Number of logged access attempts on this link' })
  accessCount!: number;

  constructor(partial: Partial<VaultExternalShareLinkListItemEntity>) {
    super(partial);
    Object.assign(this, partial);
  }
}

/**
 * The public (unauthenticated) resolution of a valid link. For a FILE:
 * a presigned URL to the pinned version's preview (if READY) else its
 * original, plus metadata. For a FOLDER: the shared folder's identity (file
 * listing/browse is a UI concern layered on top; this returns the folder ref).
 */
export class PublicSharedResourceEntity {
  @ApiProperty({ enum: VaultShareResourceType })
  resourceType!: VaultShareResourceType;

  @ApiProperty()
  name!: string;

  @ApiProperty({ nullable: true, description: 'Presigned URL (FILE links)' })
  url!: string | null;

  @ApiProperty({ nullable: true })
  mimeType!: string | null;

  @ApiProperty({ nullable: true })
  expiresInSeconds!: number | null;

  constructor(partial: Partial<PublicSharedResourceEntity>) {
    Object.assign(this, partial);
  }
}
