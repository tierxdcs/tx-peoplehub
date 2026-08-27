import { ApiProperty } from '@nestjs/swagger';
import {
  VaultFolderStatus,
  VaultFolderType,
  VaultGranteeType,
  VaultVisibilityScope,
} from '@prisma/client';

/** Effective access the CALLER has on a folder — always computed, never stored. */
export class VaultAccessEntity {
  @ApiProperty()
  canRead!: boolean;

  @ApiProperty()
  canWrite!: boolean;

  @ApiProperty()
  canDelete!: boolean;

  @ApiProperty()
  canCreateSubfolder!: boolean;

  constructor(partial: Partial<VaultAccessEntity>) {
    Object.assign(this, partial);
  }
}

export class VaultFolderPermissionEntity {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  folderId!: string;

  @ApiProperty({ enum: VaultGranteeType })
  granteeType!: VaultGranteeType;

  @ApiProperty()
  granteeId!: string;

  @ApiProperty()
  canRead!: boolean;

  @ApiProperty()
  canWrite!: boolean;

  @ApiProperty()
  canDelete!: boolean;

  @ApiProperty()
  canCreateSubfolder!: boolean;

  @ApiProperty()
  grantedById!: string;

  @ApiProperty()
  createdAt!: Date;

  constructor(partial: Partial<VaultFolderPermissionEntity>) {
    Object.assign(this, partial);
  }
}

/**
 * One step of a folder's breadcrumb trail. `canRead` is the caller's own read
 * access on that ancestor: because Vault access can be granted on a child
 * without the parent, an ancestor may legitimately be un-openable. The UI shows
 * it for orientation (you still need to know where you are) but must not link
 * to a folder that would 403.
 */
export class VaultFolderCrumbEntity {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ description: 'Whether the caller may open this ancestor' })
  canRead!: boolean;

  constructor(partial: Partial<VaultFolderCrumbEntity>) {
    Object.assign(this, partial);
  }
}

export class VaultFolderEntity {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ nullable: true })
  parentFolderId!: string | null;

  @ApiProperty({ enum: VaultFolderType })
  type!: VaultFolderType;

  @ApiProperty()
  ownerId!: string;

  @ApiProperty({ enum: VaultVisibilityScope })
  visibilityScope!: VaultVisibilityScope;

  @ApiProperty({ nullable: true })
  scopeVerticalId!: string | null;

  @ApiProperty()
  versioningEnabled!: boolean;

  @ApiProperty({ nullable: true })
  maxVersionsRetained!: number | null;

  @ApiProperty({ enum: VaultFolderStatus })
  status!: VaultFolderStatus;

  @ApiProperty({
    type: VaultAccessEntity,
    description: "The caller's computed effective access on this folder",
  })
  access!: VaultAccessEntity;

  @ApiProperty({ type: [VaultFolderEntity], required: false })
  children?: VaultFolderEntity[];

  @ApiProperty({
    type: [VaultFolderCrumbEntity],
    required: false,
    description:
      'Breadcrumb trail, root first, excluding this folder itself (empty at a root)',
  })
  ancestors?: VaultFolderCrumbEntity[];

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;

  constructor(partial: Partial<VaultFolderEntity>) {
    Object.assign(this, partial);
  }
}
