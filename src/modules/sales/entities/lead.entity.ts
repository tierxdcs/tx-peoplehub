import { ApiProperty } from '@nestjs/swagger';
import { LeadPriority, LeadSource, LeadStatus } from '@prisma/client';

export class LeadEntity {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  leadNumber!: string;

  @ApiProperty()
  companyName!: string;

  @ApiProperty()
  contactName!: string;

  @ApiProperty({ nullable: true })
  email!: string | null;

  @ApiProperty({ nullable: true })
  phone!: string | null;

  @ApiProperty()
  requirement!: string;

  @ApiProperty({ enum: LeadPriority })
  priority!: LeadPriority;

  @ApiProperty({ enum: LeadSource })
  source!: LeadSource;

  @ApiProperty({ enum: LeadStatus })
  status!: LeadStatus;

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
  disqualifiedReason!: string | null;

  @ApiProperty({ nullable: true })
  convertedToOpportunityId!: string | null;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;

  constructor(partial: Partial<LeadEntity>) {
    Object.assign(this, partial);
  }
}
