import { ApiProperty } from '@nestjs/swagger';
import {
  KickoffMeetingMode,
  KickoffMilestoneStatus,
  KickoffRiskLevel,
  KickoffRiskStatus,
  KickoffStatus,
  OrderLineDeliveryType,
} from '@prisma/client';

/**
 * A line item from the kickoff's linked Order, with its delivery
 * classification. Read from OrderLineItem — surfaced here so the kickoff UI can
 * assign NPD / In-House / Vendor per product without Sales-module access.
 */
export class KickoffDeliveryItemEntity {
  @ApiProperty() id!: string;
  @ApiProperty() productName!: string;
  @ApiProperty() productSku!: string;
  @ApiProperty() quantity!: string;
  @ApiProperty({ enum: OrderLineDeliveryType, nullable: true })
  deliveryType!: OrderLineDeliveryType | null;
  @ApiProperty({ nullable: true }) vendorName!: string | null;
  @ApiProperty({ nullable: true }) vendorContactInfo!: string | null;
  @ApiProperty({ nullable: true }) vendorExpectedLeadTime!: string | null;

  constructor(p: Partial<KickoffDeliveryItemEntity>) {
    Object.assign(this, p);
  }
}

export class KickoffAttendeeEntity {
  @ApiProperty() id!: string;
  @ApiProperty() kickoffId!: string;
  @ApiProperty({ nullable: true }) employeeId!: string | null;
  @ApiProperty({ nullable: true, description: 'Resolved name (internal or external)' })
  name!: string | null;
  @ApiProperty({ nullable: true }) externalOrganization!: string | null;
  @ApiProperty({ nullable: true }) designation!: string | null;
  @ApiProperty({ nullable: true }) department!: string | null;
  @ApiProperty({ description: 'true = internal (employee-linked), false = external' })
  isInternal!: boolean;

  constructor(p: Partial<KickoffAttendeeEntity>) {
    Object.assign(this, p);
  }
}

export class KickoffMilestoneEntity {
  @ApiProperty() id!: string;
  @ApiProperty() kickoffId!: string;
  @ApiProperty() name!: string;
  @ApiProperty() targetDate!: string;
  @ApiProperty({ nullable: true }) ownerId!: string | null;
  @ApiProperty({ nullable: true }) ownerName!: string | null;
  @ApiProperty({ enum: KickoffMilestoneStatus }) status!: KickoffMilestoneStatus;

  constructor(p: Partial<KickoffMilestoneEntity>) {
    Object.assign(this, p);
  }
}

/** The action item's status is COMPUTED from its linked Kanban card, never stored. */
export type ActionItemComputedStatus =
  | 'TODO'
  | 'IN_PROGRESS'
  | 'DONE'
  | 'ARCHIVED'
  | 'UNLINKED';

export class KickoffActionItemEntity {
  @ApiProperty() id!: string;
  @ApiProperty() kickoffId!: string;
  @ApiProperty() description!: string;
  @ApiProperty() ownerId!: string;
  @ApiProperty({ nullable: true }) ownerName!: string | null;
  @ApiProperty({ nullable: true }) dueDate!: string | null;
  @ApiProperty({ nullable: true }) kanbanCardId!: string | null;
  @ApiProperty({ nullable: true, description: 'The card’s current list name' })
  currentListName!: string | null;
  @ApiProperty({
    enum: ['TODO', 'IN_PROGRESS', 'DONE', 'ARCHIVED', 'UNLINKED'],
    description: 'Derived from the linked Kanban card’s list at read time',
  })
  status!: ActionItemComputedStatus;

  constructor(p: Partial<KickoffActionItemEntity>) {
    Object.assign(this, p);
  }
}

export class KickoffRiskEntity {
  @ApiProperty() id!: string;
  @ApiProperty() kickoffId!: string;
  @ApiProperty() description!: string;
  @ApiProperty({ enum: KickoffRiskLevel }) likelihood!: KickoffRiskLevel;
  @ApiProperty({ enum: KickoffRiskLevel }) impact!: KickoffRiskLevel;
  @ApiProperty({ nullable: true }) mitigationPlan!: string | null;
  @ApiProperty({ nullable: true }) ownerId!: string | null;
  @ApiProperty({ nullable: true }) ownerName!: string | null;
  @ApiProperty({ enum: KickoffRiskStatus }) status!: KickoffRiskStatus;

  constructor(p: Partial<KickoffRiskEntity>) {
    Object.assign(this, p);
  }
}

export class ProjectKickoffEntity {
  @ApiProperty() id!: string;
  @ApiProperty() orderId!: string;
  @ApiProperty() projectName!: string;
  @ApiProperty() meetingDate!: string;
  @ApiProperty({ enum: KickoffMeetingMode }) meetingMode!: KickoffMeetingMode;
  @ApiProperty({ nullable: true }) meetingLocation!: string | null;
  @ApiProperty({ nullable: true }) overviewAndScope!: string | null;
  @ApiProperty({ nullable: true }) minutesNotes!: string | null;
  @ApiProperty({ enum: KickoffStatus }) status!: KickoffStatus;
  @ApiProperty() kanbanBoardId!: string;
  @ApiProperty() createdById!: string;
  @ApiProperty() createdAt!: string;
  @ApiProperty() updatedAt!: string;

  @ApiProperty({ type: [KickoffAttendeeEntity], required: false })
  attendees?: KickoffAttendeeEntity[];
  @ApiProperty({ type: [KickoffMilestoneEntity], required: false })
  milestones?: KickoffMilestoneEntity[];
  @ApiProperty({ type: [KickoffActionItemEntity], required: false })
  actionItems?: KickoffActionItemEntity[];
  @ApiProperty({ type: [KickoffRiskEntity], required: false })
  risks?: KickoffRiskEntity[];
  @ApiProperty({ type: [KickoffDeliveryItemEntity], required: false })
  deliveryItems?: KickoffDeliveryItemEntity[];

  constructor(p: Partial<ProjectKickoffEntity>) {
    Object.assign(this, p);
  }
}
