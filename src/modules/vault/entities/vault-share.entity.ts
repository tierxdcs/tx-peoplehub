import { ApiProperty } from '@nestjs/swagger';
import { VaultSharePermission, VaultShareResourceType } from '@prisma/client';

export class VaultInternalShareEntity {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: VaultShareResourceType })
  resourceType!: VaultShareResourceType;

  @ApiProperty()
  resourceId!: string;

  @ApiProperty()
  sharedWithEmployeeId!: string;

  @ApiProperty({ enum: VaultSharePermission })
  permission!: VaultSharePermission;

  @ApiProperty({
    nullable: true,
    description:
      'Display name of the recipient, when resolvable (for the UI list)',
  })
  sharedWithEmployeeName?: string | null;

  @ApiProperty()
  sharedById!: string;

  @ApiProperty()
  createdAt!: Date;

  constructor(partial: Partial<VaultInternalShareEntity>) {
    Object.assign(this, partial);
  }
}
