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

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;

  constructor(partial: Partial<VaultFolderEntity>) {
    Object.assign(this, partial);
  }
}
