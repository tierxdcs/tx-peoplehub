import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  KickoffMeetingMode,
  KickoffMilestoneStatus,
  KickoffRiskLevel,
  KickoffRiskStatus,
  KickoffStatus,
  OrderLineDeliveryType,
} from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
} from 'class-validator';

export class CreateKickoffDto {
  @ApiProperty({
    description:
      'Order this kickoff is for (Confirmation Sheet must be EXECUTED)',
  })
  @IsUUID()
  orderId!: string;

  @ApiPropertyOptional({
    description: 'Defaults to "<Customer> — <Order number>" if omitted',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  projectName?: string;

  @ApiProperty({ description: 'ISO datetime of the kickoff meeting' })
  @IsDateString()
  meetingDate!: string;

  @ApiPropertyOptional({ enum: KickoffMeetingMode })
  @IsOptional()
  @IsEnum(KickoffMeetingMode)
  meetingMode?: KickoffMeetingMode;

  @ApiPropertyOptional({ description: 'Physical address or virtual link' })
  @IsOptional()
  @IsString()
  meetingLocation?: string;

  @ApiPropertyOptional({
    description: 'Overview & scope; pre-filled from the bid if omitted',
  })
  @IsOptional()
  @IsString()
  overviewAndScope?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  minutesNotes?: string;
}

export class UpdateKickoffDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  projectName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  meetingDate?: string;

  @ApiPropertyOptional({ enum: KickoffMeetingMode })
  @IsOptional()
  @IsEnum(KickoffMeetingMode)
  meetingMode?: KickoffMeetingMode;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  meetingLocation?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  overviewAndScope?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  minutesNotes?: string | null;

  @ApiPropertyOptional({ enum: KickoffStatus })
  @IsOptional()
  @IsEnum(KickoffStatus)
  status?: KickoffStatus;
}

// ── Attendees ────────────────────────────────────────────────────────
export class CreateAttendeeDto {
  @ApiPropertyOptional({
    description: 'Internal attendee — set this OR externalName',
  })
  @IsOptional()
  @IsUUID()
  employeeId?: string;

  @ApiPropertyOptional({
    description: 'External attendee name — set this OR employeeId',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  externalName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  externalOrganization?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  designation?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  department?: string;
}

// ── Milestones ───────────────────────────────────────────────────────
export class CreateMilestoneDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  name!: string;

  @ApiProperty({ description: 'ISO date' })
  @IsDateString()
  targetDate!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  ownerId?: string;

  @ApiPropertyOptional({ enum: KickoffMilestoneStatus })
  @IsOptional()
  @IsEnum(KickoffMilestoneStatus)
  status?: KickoffMilestoneStatus;
}

export class UpdateMilestoneDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @ApiPropertyOptional({ description: 'ISO date' })
  @IsOptional()
  @IsDateString()
  targetDate?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsUUID()
  ownerId?: string | null;

  @ApiPropertyOptional({ enum: KickoffMilestoneStatus })
  @IsOptional()
  @IsEnum(KickoffMilestoneStatus)
  status?: KickoffMilestoneStatus;
}

// ── Action items ─────────────────────────────────────────────────────
export class CreateActionItemDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  description!: string;

  @ApiProperty({
    description: 'Owner — becomes the linked Kanban card assignee',
  })
  @IsUUID()
  ownerId!: string;

  @ApiPropertyOptional({ description: 'ISO date' })
  @IsOptional()
  @IsDateString()
  dueDate?: string;
}

export class UpdateActionItemDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  description?: string;

  @ApiPropertyOptional({ nullable: true, description: 'ISO date' })
  @IsOptional()
  @IsDateString()
  dueDate?: string | null;
}

// ── Risks ────────────────────────────────────────────────────────────
export class CreateRiskDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  description!: string;

  @ApiPropertyOptional({ enum: KickoffRiskLevel })
  @IsOptional()
  @IsEnum(KickoffRiskLevel)
  likelihood?: KickoffRiskLevel;

  @ApiPropertyOptional({ enum: KickoffRiskLevel })
  @IsOptional()
  @IsEnum(KickoffRiskLevel)
  impact?: KickoffRiskLevel;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  mitigationPlan?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  ownerId?: string;
}

export class UpdateRiskDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  description?: string;

  @ApiPropertyOptional({ enum: KickoffRiskLevel })
  @IsOptional()
  @IsEnum(KickoffRiskLevel)
  likelihood?: KickoffRiskLevel;

  @ApiPropertyOptional({ enum: KickoffRiskLevel })
  @IsOptional()
  @IsEnum(KickoffRiskLevel)
  impact?: KickoffRiskLevel;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  mitigationPlan?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsUUID()
  ownerId?: string | null;

  @ApiPropertyOptional({ enum: KickoffRiskStatus })
  @IsOptional()
  @IsEnum(KickoffRiskStatus)
  status?: KickoffRiskStatus;
}

// ── Delivery classification (per order line item) ────────────────────
export class UpdateDeliveryItemDto {
  @ApiPropertyOptional({ enum: OrderLineDeliveryType, nullable: true })
  @IsOptional()
  @IsEnum(OrderLineDeliveryType)
  deliveryType?: OrderLineDeliveryType;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Approved Vendor Master link',
  })
  @IsOptional()
  @IsUUID()
  vendorId?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'Vendor-name snapshot retained for history and unmatched legacy lines.',
  })
  @IsOptional()
  @IsString()
  vendorName?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  vendorContactInfo?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  vendorExpectedLeadTime?: string | null;
}
