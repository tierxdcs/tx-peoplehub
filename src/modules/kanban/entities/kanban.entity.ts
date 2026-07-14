import { ApiProperty } from '@nestjs/swagger';
import {
  KanbanBoardStatus,
  KanbanCardStatus,
  KanbanSprintDuration,
  LeadPriority,
} from '@prisma/client';

export class KanbanBoardMemberEntity {
  @ApiProperty() id!: string;
  @ApiProperty() boardId!: string;
  @ApiProperty() employeeId!: string;
  @ApiProperty({ nullable: true }) employeeName!: string | null;
  @ApiProperty({ nullable: true }) employeeEmail!: string | null;
  @ApiProperty() addedById!: string;
  @ApiProperty() addedAt!: string;

  constructor(partial: Partial<KanbanBoardMemberEntity>) {
    Object.assign(this, partial);
  }
}

export class KanbanBoardEntity {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() createdById!: string;
  @ApiProperty({ enum: KanbanBoardStatus }) status!: KanbanBoardStatus;
  @ApiProperty({ description: 'Number of members on the board' })
  memberCount!: number;
  @ApiProperty() createdAt!: string;
  @ApiProperty() updatedAt!: string;

  constructor(partial: Partial<KanbanBoardEntity>) {
    Object.assign(this, partial);
  }
}

export class KanbanListEntity {
  @ApiProperty() id!: string;
  @ApiProperty() boardId!: string;
  @ApiProperty() name!: string;
  @ApiProperty() position!: number;
  @ApiProperty() createdById!: string;
  @ApiProperty() createdAt!: string;
  @ApiProperty() updatedAt!: string;

  constructor(partial: Partial<KanbanListEntity>) {
    Object.assign(this, partial);
  }
}

/** Sprint status is COMPUTED from dates, never stored. */
export type KanbanSprintStatus = 'UPCOMING' | 'ACTIVE' | 'COMPLETED';

export class KanbanSprintEntity {
  @ApiProperty() id!: string;
  @ApiProperty() boardId!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ enum: KanbanSprintDuration })
  durationWeeks!: KanbanSprintDuration;
  @ApiProperty() startDate!: string;
  @ApiProperty() endDate!: string;
  @ApiProperty({
    description: 'Computed from dates: UPCOMING / ACTIVE / COMPLETED',
  })
  status!: KanbanSprintStatus;
  @ApiProperty() createdById!: string;
  @ApiProperty() createdAt!: string;
  @ApiProperty() updatedAt!: string;

  constructor(partial: Partial<KanbanSprintEntity>) {
    Object.assign(this, partial);
  }
}

export class KanbanCardEntity {
  @ApiProperty() id!: string;
  @ApiProperty() listId!: string;
  @ApiProperty() title!: string;
  @ApiProperty({ nullable: true }) description!: string | null;
  @ApiProperty({ nullable: true }) assigneeId!: string | null;
  @ApiProperty({ nullable: true }) assigneeName!: string | null;
  @ApiProperty({ nullable: true }) startDate!: string | null;
  @ApiProperty({ nullable: true }) dueDate!: string | null;
  @ApiProperty({ enum: LeadPriority }) priority!: LeadPriority;
  @ApiProperty({ nullable: true }) sprintId!: string | null;
  @ApiProperty() position!: number;
  @ApiProperty() createdById!: string;
  @ApiProperty({ enum: KanbanCardStatus }) status!: KanbanCardStatus;
  @ApiProperty() createdAt!: string;
  @ApiProperty() updatedAt!: string;

  constructor(partial: Partial<KanbanCardEntity>) {
    Object.assign(this, partial);
  }
}
