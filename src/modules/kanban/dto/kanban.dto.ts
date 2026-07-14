import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { KanbanSprintDuration, LeadPriority } from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
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

  @ApiProperty({ description: 'Ordering position within the board' })
  @IsInt()
  position!: number;
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

  @ApiPropertyOptional({ description: 'Must be a member of the board' })
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

export class SetCardSprintDto {
  @ApiPropertyOptional({
    nullable: true,
    description: 'Sprint to assign, or null to clear. Scrum Master/SuperAdmin.',
  })
  @IsOptional()
  @IsUUID()
  sprintId?: string | null;
}
