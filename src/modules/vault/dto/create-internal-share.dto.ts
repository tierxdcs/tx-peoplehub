import { ApiProperty } from '@nestjs/swagger';
import { VaultSharePermission } from '@prisma/client';
import { IsEnum, IsUUID } from 'class-validator';

/**
 * Grant one employee VIEW (read) or EDIT (read+write) on a file or folder.
 * The resource is taken from the route; only the recipient + level here.
 * Additive — never reduces the recipient's existing access.
 */
export class CreateInternalShareDto {
  @ApiProperty({ description: 'Employee to share with' })
  @IsUUID()
  sharedWithEmployeeId!: string;

  @ApiProperty({ enum: VaultSharePermission })
  @IsEnum(VaultSharePermission)
  permission!: VaultSharePermission;
}
