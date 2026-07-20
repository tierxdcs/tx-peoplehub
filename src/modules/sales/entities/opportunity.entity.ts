import { ApiProperty } from '@nestjs/swagger';
import { OpportunityStage } from '@prisma/client';

export class OpportunityEntity {
  @ApiProperty()
  id!: string;

  @ApiProperty({ nullable: true })
  leadId!: string | null;

  @ApiProperty({ nullable: true })
  customerId!: string | null;

  @ApiProperty()
  name!: string;

  @ApiProperty({ enum: OpportunityStage })
  stage!: OpportunityStage;

  @ApiProperty({ description: 'Decimal serialized as string' })
  estimatedValue!: string;

  @ApiProperty()
  expectedCloseDate!: Date;

  @ApiProperty()
  ownerId!: string;

  @ApiProperty({ description: 'Current owner (may differ from the creator)' })
  ownerName!: string;

  @ApiProperty({
    description: 'Immutable user credited with originating the enquiry',
  })
  enquiryCreatorId!: string;

  @ApiProperty()
  enquiryCreatorName!: string;

  @ApiProperty()
  businessUnitId!: string;

  @ApiProperty()
  businessUnitName!: string;

  @ApiProperty()
  businessUnitColorHex!: string;

  @ApiProperty({ nullable: true })
  lostReason!: string | null;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;

  constructor(partial: Partial<OpportunityEntity>) {
    Object.assign(this, partial);
  }
}
