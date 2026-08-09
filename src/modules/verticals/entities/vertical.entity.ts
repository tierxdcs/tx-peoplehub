import { ApiProperty } from '@nestjs/swagger';

export class VerticalEntity {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  code!: string;

  @ApiProperty()
  isActive!: boolean;

  @ApiProperty({ nullable: true })
  ownerId!: string | null;

  @ApiProperty({ nullable: true })
  owner!: {
    id: string;
    employeeId: string;
    firstName: string;
    lastName: string;
  } | null;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;

  constructor(partial: Partial<VerticalEntity>) {
    Object.assign(this, partial);
  }
}
