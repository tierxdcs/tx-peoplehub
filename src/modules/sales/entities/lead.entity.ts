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
