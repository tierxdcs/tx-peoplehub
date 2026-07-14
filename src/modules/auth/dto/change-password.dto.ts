import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MinLength } from 'class-validator';

/**
 * Self-service password change for the authenticated user: verify the current
 * password, then set a new one. Not an admin reset — the caller changes their
 * OWN password.
 */
export class ChangePasswordDto {
  @ApiProperty({ description: 'The current password, for verification' })
  @IsString()
  @IsNotEmpty()
  currentPassword!: string;

  @ApiProperty({ example: 'N3wSecurePass!', minLength: 8 })
  @IsString()
  @MinLength(8)
  newPassword!: string;
}
