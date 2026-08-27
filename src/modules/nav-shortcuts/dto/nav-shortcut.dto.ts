import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class PinNavShortcutDto {
  @ApiProperty({
    description: 'Nav route to pin, e.g. /sales/leads',
    example: '/sales/leads',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  href!: string;

  @ApiProperty({
    description:
      'Label to show in the pinned strip. Snapshotted so the pin still renders ' +
      'when the route is outside the current module nav; the UI prefers the live ' +
      'nav label when it can resolve one.',
    example: 'Leads',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  label!: string;
}

export class UnpinNavShortcutQueryDto {
  @ApiProperty({ description: 'Nav route to unpin', example: '/sales/leads' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  href!: string;
}
