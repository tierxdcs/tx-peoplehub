import { ApiProperty } from '@nestjs/swagger';

export class NavShortcutEntity {
  @ApiProperty()
  id!: string;

  @ApiProperty({ example: '/sales/leads' })
  href!: string;

  @ApiProperty({ example: 'Leads' })
  label!: string;

  @ApiProperty({ description: 'Dense 0-based display order', example: 0 })
  sortOrder!: number;
}
