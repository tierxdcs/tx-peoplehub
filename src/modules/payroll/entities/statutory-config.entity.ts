import { ApiProperty } from '@nestjs/swagger';
import { StatutoryConfigType } from '@prisma/client';

export class StatutoryConfigEntity {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: StatutoryConfigType })
  configType!: StatutoryConfigType;

  @ApiProperty({ nullable: true })
  state!: string | null;

  @ApiProperty()
  effectiveFrom!: Date;

  @ApiProperty({ nullable: true })
  effectiveTo!: Date | null;

  @ApiProperty()
  configData!: Record<string, unknown>;

  @ApiProperty()
  sourceNote!: string;

  constructor(partial: Partial<StatutoryConfigEntity>) {
    Object.assign(this, partial);
  }
}
