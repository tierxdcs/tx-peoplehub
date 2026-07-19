import { ApiProperty } from '@nestjs/swagger';

export class MaterialIssueNoteEntity {
  @ApiProperty() id!: string;
  @ApiProperty() minNumber!: string;
  @ApiProperty() materialIndentId!: string;

  @ApiProperty() itemId!: string;
  @ApiProperty({ nullable: true }) itemCode!: string | null;
  @ApiProperty({ nullable: true }) itemName!: string | null;

  @ApiProperty() storeLocationId!: string;
  @ApiProperty({ nullable: true }) storeLocationName!: string | null;

  @ApiProperty({ description: 'Decimal serialized as string' })
  issuedQuantity!: string;
  @ApiProperty({ nullable: true }) binLocation!: string | null;
  @ApiProperty({ nullable: true }) notes!: string | null;

  @ApiProperty() issuedById!: string;
  @ApiProperty({ nullable: true }) issuedByName!: string | null;
  @ApiProperty() issuedAt!: string;

  @ApiProperty() createdAt!: string;

  constructor(p: Partial<MaterialIssueNoteEntity>) {
    Object.assign(this, p);
  }
}
