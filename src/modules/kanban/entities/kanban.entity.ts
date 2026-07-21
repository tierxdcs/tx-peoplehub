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
  @ApiProperty() isDoneList!: boolean;
  @ApiProperty({ description: 'Count of ACTIVE cards in this list' })
  cardCount!: number;
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
  @ApiProperty({ description: 'Count of ACTIVE cards in this sprint' })
  cardCount!: number;
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
  @ApiProperty({ description: "The card's board (via its list)" })
  boardId?: string;
  @ApiProperty() title!: string;
  @ApiProperty({ nullable: true }) description!: string | null;
  @ApiProperty({ nullable: true }) assigneeId!: string | null;
  @ApiProperty({ nullable: true }) assigneeName!: string | null;
  @ApiProperty({ nullable: true, description: "Vertical this card's work belongs to" })
  verticalId!: string | null;
  @ApiProperty({ nullable: true }) verticalName!: string | null;
  @ApiProperty({ nullable: true, description: 'Vertical code, e.g. PRODUCTION' })
  verticalCode!: string | null;
  @ApiProperty({ nullable: true }) startDate!: string | null;
  @ApiProperty({ nullable: true }) dueDate!: string | null;
  @ApiProperty({ enum: LeadPriority }) priority!: LeadPriority;
  @ApiProperty({ nullable: true }) sprintId!: string | null;
  @ApiProperty() position!: number;
  @ApiProperty() createdById!: string;
  @ApiProperty({ enum: KanbanCardStatus }) status!: KanbanCardStatus;
  @ApiProperty({
    description: 'Computed: dueDate is past AND the list is not a done-list',
  })
  isOverdue!: boolean;
  @ApiProperty({ type: () => [KanbanLabelEntity], required: false })
  labels?: KanbanLabelEntity[];
  @ApiProperty() createdAt!: string;
  @ApiProperty() updatedAt!: string;

  constructor(partial: Partial<KanbanCardEntity>) {
    Object.assign(this, partial);
  }
}

/**
 * Per-vertical completion for a board: for each vertical that has cards, how
 * many are done (sitting in an isDoneList list) vs total ACTIVE. Powers the
 * cross-department progress readout on a project board (e.g. "Production 2/7").
 * Cards with no vertical tag are grouped under a null verticalId row.
 */
export class BoardVerticalProgressEntity {
  @ApiProperty({ nullable: true, description: 'null = untagged cards' })
  verticalId!: string | null;
  @ApiProperty({ nullable: true }) verticalName!: string | null;
  @ApiProperty({ nullable: true }) verticalCode!: string | null;
  @ApiProperty({ description: 'ACTIVE cards tagged with this vertical' })
  total!: number;
  @ApiProperty({ description: 'Of those, cards in a done-type list' })
  done!: number;

  constructor(partial: Partial<BoardVerticalProgressEntity>) {
    Object.assign(this, partial);
  }
}

export class KanbanLabelEntity {
  @ApiProperty() id!: string;
  @ApiProperty() boardId!: string;
  @ApiProperty() name!: string;
  @ApiProperty() color!: string;

  constructor(partial: Partial<KanbanLabelEntity>) {
    Object.assign(this, partial);
  }
}

export class KanbanCommentEntity {
  @ApiProperty() id!: string;
  @ApiProperty() cardId!: string;
  @ApiProperty() authorId!: string;
  @ApiProperty({ nullable: true }) authorName!: string | null;
  @ApiProperty() text!: string;
  @ApiProperty() createdAt!: string;

  constructor(partial: Partial<KanbanCommentEntity>) {
    Object.assign(this, partial);
  }
}

export class KanbanActivityEntity {
  @ApiProperty() id!: string;
  @ApiProperty() cardId!: string;
  @ApiProperty() actorId!: string;
  @ApiProperty({ nullable: true }) actorName!: string | null;
  @ApiProperty() description!: string;
  @ApiProperty() createdAt!: string;

  constructor(partial: Partial<KanbanActivityEntity>) {
    Object.assign(this, partial);
  }
}

/** One entry in the combined card feed — a comment or an activity record. */
export class KanbanFeedItemEntity {
  @ApiProperty({ enum: ['COMMENT', 'ACTIVITY'] })
  kind!: 'COMMENT' | 'ACTIVITY';
  @ApiProperty() id!: string;
  @ApiProperty() actorId!: string;
  @ApiProperty({ nullable: true }) actorName!: string | null;
  /** For COMMENT: the comment text. For ACTIVITY: the generated description. */
  @ApiProperty() text!: string;
  @ApiProperty() createdAt!: string;

  constructor(partial: Partial<KanbanFeedItemEntity>) {
    Object.assign(this, partial);
  }
}

/** A file attached to a card (ACTIVE only when surfaced). */
export class KanbanAttachmentEntity {
  @ApiProperty() id!: string;
  @ApiProperty() cardId!: string;
  @ApiProperty() filename!: string;
  @ApiProperty() contentType!: string;
  @ApiProperty({ description: 'Size in bytes' }) sizeBytes!: number;
  @ApiProperty() uploadedById!: string;
  @ApiProperty({ nullable: true }) uploadedByName!: string | null;
  @ApiProperty() createdAt!: string;

  constructor(partial: Partial<KanbanAttachmentEntity>) {
    Object.assign(this, partial);
  }
}

/** Returned by create-upload-url: the presigned PUT + the new attachment id. */
export class KanbanAttachmentUploadTicketEntity {
  @ApiProperty() attachmentId!: string;
  @ApiProperty({ description: 'Presigned PUT URL the browser uploads to' })
  uploadUrl!: string;
  @ApiProperty() expiresInSeconds!: number;

  constructor(partial: Partial<KanbanAttachmentUploadTicketEntity>) {
    Object.assign(this, partial);
  }
}

/**
 * A card assigned to the current user, flattened for the personal dashboard —
 * carries board context + the done/overdue flags the dashboard needs without
 * the full card payload. `isDone` = the card sits in an isDoneList list.
 */
export class MyCardEntity {
  @ApiProperty() id!: string;
  @ApiProperty() title!: string;
  @ApiProperty() boardId!: string;
  @ApiProperty({ nullable: true }) boardName!: string | null;
  @ApiProperty({ nullable: true }) dueDate!: string | null;
  @ApiProperty({ description: 'Card sits in a done-type list' })
  isDone!: boolean;
  @ApiProperty({ description: 'dueDate past AND not in a done list' })
  isOverdue!: boolean;

  constructor(partial: Partial<MyCardEntity>) {
    Object.assign(this, partial);
  }
}
