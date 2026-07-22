import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { KanbanSprintDuration, LeadPriority } from '@prisma/client';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  MinLength,
} from 'class-validator';

export class CreateBoardDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  name!: string;
}

export class AddBoardMemberDto {
  @ApiProperty({ description: 'Employee to add as a board member' })
  @IsUUID()
  employeeId!: string;
}

export class CreateListDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  name!: string;

  @ApiProperty({ description: 'Fractional ordering position within the board' })
  @IsNumber()
  position!: number;

  @ApiPropertyOptional({
    description: 'Mark as a "done"-type list (cards here are never overdue)',
  })
  @IsOptional()
  @IsBoolean()
  isDoneList?: boolean;
}

export class UpdateListDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isDoneList?: boolean;
}

export class ReorderListDto {
  @ApiProperty({
    description: 'New fractional position (midpoint of neighbours)',
  })
  @IsNumber()
  position!: number;
}

export class CreateLabelDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  name!: string;

  @ApiProperty({ description: 'Color token (hex or named swatch)' })
  @IsString()
  @MinLength(1)
  color!: string;
}

export class UpdateLabelDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  color?: string;
}

/**
 * Board-wide card filter. All optional; combined with AND. `sprintId` accepts
 * the literal 'none' to match cards not assigned to any sprint.
 */
export class CardFilterQueryDto {
  @ApiPropertyOptional({ description: 'dueDate <= this (ISO date)' })
  @IsOptional()
  @IsDateString()
  dueBefore?: string;

  @ApiPropertyOptional({ description: 'dueDate >= this (ISO date)' })
  @IsOptional()
  @IsDateString()
  dueAfter?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  createdBy?: string;

  @ApiPropertyOptional({
    description: "Sprint id, or the literal 'none' for no-sprint cards",
  })
  @IsOptional()
  @IsString()
  sprintId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  assigneeId?: string;

  @ApiPropertyOptional({ enum: LeadPriority })
  @IsOptional()
  @IsEnum(LeadPriority)
  priority?: LeadPriority;
}

export class CreateSprintDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  name!: string;

  @ApiProperty({ enum: KanbanSprintDuration })
  @IsEnum(KanbanSprintDuration)
  durationWeeks!: KanbanSprintDuration;

  @ApiProperty({ description: 'Sprint start date (ISO)' })
  @IsDateString()
  startDate!: string;
}

export class CreateCardDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  title!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ enum: LeadPriority })
  @IsOptional()
  @IsEnum(LeadPriority)
  priority?: LeadPriority;

  @ApiPropertyOptional({ description: 'ISO date' })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({ description: 'ISO date' })
  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @ApiPropertyOptional({
    description:
      'Any active employee — need not be a board member (grants card-only access)',
  })
  @IsOptional()
  @IsUUID()
  assigneeId?: string;
}

/**
 * General card edit. Deliberately has NO `sprintId` — with the global
 * forbidNonWhitelisted pipe, sending sprintId here is rejected (400), so a
 * regular member can't slip a sprint change through the shared handler. Sprint
 * assignment goes through the dedicated privileged endpoint instead.
 * `assigneeId` accepts null to unassign.
 */
export class UpdateCardDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  title?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  description?: string | null;

  @ApiPropertyOptional({ enum: LeadPriority })
  @IsOptional()
  @IsEnum(LeadPriority)
  priority?: LeadPriority;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsDateString()
  startDate?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsDateString()
  dueDate?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'null to unassign' })
  @IsOptional()
  @IsUUID()
  assigneeId?: string | null;
}

export class MoveCardDto {
  @ApiProperty({ description: 'Target list (may be a different list)' })
  @IsUUID()
  listId!: string;

  @ApiProperty({
    description:
      'Fractional position: pass the midpoint between the neighbours you drop between.',
  })
  @IsNumber()
  position!: number;
}

export class CreateCommentDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  text!: string;
}

export class SetCardSprintDto {
  @ApiPropertyOptional({
    nullable: true,
    description: 'Sprint to assign, or null to clear. Scrum Master/SuperAdmin.',
  })
  @IsOptional()
  @IsUUID()
  sprintId?: string | null;
}

export class CreateAttachmentUploadUrlDto {
  @ApiProperty({ description: 'Original file name' })
  @IsString()
  @MinLength(1)
  filename!: string;

  @ApiProperty({ description: 'MIME type of the file' })
  @IsString()
  @MinLength(1)
  contentType!: string;

  @ApiProperty({ description: 'File size in bytes' })
  @IsNumber()
  @Min(1)
  sizeBytes!: number;
}

export class ConfirmAttachmentDto {}
