import { ApiProperty } from '@nestjs/swagger';
import {
  NcrDispositionType,
  NonConformanceReportStatus,
} from '@prisma/client';

export class NonConformanceReportEntity {
  @ApiProperty() id!: string;
  @ApiProperty() ncrNumber!: string;
  @ApiProperty({ enum: NonConformanceReportStatus })
  status!: NonConformanceReportStatus;

  @ApiProperty() grnId!: string;
  @ApiProperty({ nullable: true }) grnNumber!: string | null;
  @ApiProperty() grnLineId!: string;

  @ApiProperty() itemId!: string;
  @ApiProperty({ nullable: true }) itemCode!: string | null;
  @ApiProperty({ nullable: true }) itemName!: string | null;

  @ApiProperty({ description: 'Decimal serialized as string' })
  rejectedQuantity!: string;
  @ApiProperty({ nullable: true }) rejectionReason!: string | null;

  @ApiProperty({ enum: NcrDispositionType, nullable: true })
  disposition!: NcrDispositionType | null;
  @ApiProperty({ nullable: true }) dispositionNotes!: string | null;

  @ApiProperty() raisedById!: string;
  @ApiProperty({ nullable: true }) raisedByName!: string | null;
  @ApiProperty({ nullable: true }) dispositionedById!: string | null;
  @ApiProperty({ nullable: true }) dispositionedByName!: string | null;
  @ApiProperty({ nullable: true }) dispositionedAt!: string | null;

  @ApiProperty() createdAt!: string;
  @ApiProperty() updatedAt!: string;

  constructor(p: Partial<NonConformanceReportEntity>) {
    Object.assign(this, p);
  }
}
