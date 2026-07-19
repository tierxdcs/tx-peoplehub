import { ApiProperty } from '@nestjs/swagger';
import { MaterialIndentStatus } from '@prisma/client';
import { MaterialIssueNoteEntity } from './material-issue-note.entity';

export class MaterialIndentEntity {
  @ApiProperty() id!: string;
  @ApiProperty() indentNumber!: string;
  @ApiProperty({
    enum: MaterialIndentStatus,
    description: 'DERIVED from cumulative issued vs requested — never set by hand',
  })
  status!: MaterialIndentStatus;

  @ApiProperty({ nullable: true }) projectKickoffId!: string | null;
  @ApiProperty({ nullable: true }) projectName!: string | null;

  @ApiProperty() itemId!: string;
  @ApiProperty({ nullable: true }) itemCode!: string | null;
  @ApiProperty({ nullable: true }) itemName!: string | null;

  @ApiProperty({ description: 'Decimal serialized as string' })
  requestedQuantity!: string;
  @ApiProperty({ description: 'Cumulative issued across all issue notes' })
  issuedQuantity!: string;
  @ApiProperty({ description: 'requested − issued (never below zero)' })
  outstandingQuantity!: string;

  @ApiProperty({ nullable: true }) requiredByDate!: string | null;
  @ApiProperty({ nullable: true }) notes!: string | null;

  @ApiProperty() raisedById!: string;
  @ApiProperty({ nullable: true }) raisedByName!: string | null;

  @ApiProperty({ type: [MaterialIssueNoteEntity] })
  issueNotes!: MaterialIssueNoteEntity[];

  @ApiProperty() createdAt!: string;
  @ApiProperty() updatedAt!: string;

  constructor(p: Partial<MaterialIndentEntity>) {
    Object.assign(this, p);
  }
}
