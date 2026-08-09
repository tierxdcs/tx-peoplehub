import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class UpdateVerticalOwnerDto {
  @ApiProperty()
  @IsUUID()
  ownerId!: string;
}
