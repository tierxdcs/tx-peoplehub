import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class DenyAccessDto {
  @ApiProperty({
    description: 'Reason ERP login access is being denied',
    minLength: 3,
  })
  @IsString()
  @MinLength(3)
  reason!: string;
}
