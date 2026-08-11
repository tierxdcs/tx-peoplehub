import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ExpenseClaimStatus } from '@prisma/client';

export class ExpenseCategoryEntity {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() defaultExpenseLedgerId!: string;
  @ApiProperty({ description: 'Ledger code, e.g. "6100"' })
  ledgerCode!: string;
  @ApiProperty({ description: 'Ledger name, e.g. "Administrative Expenses"' })
  ledgerName!: string;
  @ApiProperty() isActive!: boolean;

  constructor(partial: Partial<ExpenseCategoryEntity>) {
    Object.assign(this, partial);
  }
}

/** Returned by create-upload-url: the presigned PUT + the new receipt id. */
export class ExpenseReceiptUploadTicketEntity {
  @ApiProperty() receiptId!: string;
  @ApiProperty({ description: 'Presigned PUT URL the browser uploads to' })
  uploadUrl!: string;
  @ApiProperty() expiresInSeconds!: number;

  constructor(partial: Partial<ExpenseReceiptUploadTicketEntity>) {
    Object.assign(this, partial);
  }
}

export class ExpenseReceiptEntity {
  @ApiProperty() id!: string;
  @ApiProperty() filename!: string;
  @ApiProperty() contentType!: string;
  @ApiProperty() sizeBytes!: number;
  @ApiProperty() status!: string;

  constructor(partial: Partial<ExpenseReceiptEntity>) {
    Object.assign(this, partial);
  }
}

export class ExpenseClaimLineEntity {
  @ApiProperty() id!: string;
  @ApiProperty() expenseDate!: string;
  @ApiProperty() categoryId!: string;
  @ApiProperty() categoryName!: string;
  @ApiProperty() description!: string;
  @ApiProperty() amount!: number;
  @ApiProperty() receiptId!: string;
  @ApiProperty() receiptFilename!: string;

  constructor(partial: Partial<ExpenseClaimLineEntity>) {
    Object.assign(this, partial);
  }
}

export class ExpenseClaimEntity {
  @ApiProperty() id!: string;
  @ApiProperty() claimNumber!: string;
  @ApiProperty() employeeId!: string;
  @ApiProperty({ nullable: true }) employeeName!: string | null;
  @ApiProperty() title!: string;
  @ApiProperty({ enum: ExpenseClaimStatus }) status!: ExpenseClaimStatus;
  @ApiProperty() totalAmount!: number;

  @ApiPropertyOptional({ nullable: true }) submittedAt!: string | null;
  @ApiPropertyOptional({ nullable: true }) approvedById!: string | null;
  @ApiPropertyOptional({ nullable: true }) approvedByName!: string | null;
  @ApiPropertyOptional({ nullable: true }) approvedAt!: string | null;
  @ApiPropertyOptional({ nullable: true }) rejectedByName!: string | null;
  @ApiPropertyOptional({ nullable: true }) rejectedAt!: string | null;
  @ApiPropertyOptional({ nullable: true }) rejectionComment!: string | null;
  @ApiPropertyOptional({ nullable: true }) paidByName!: string | null;
  @ApiPropertyOptional({ nullable: true }) paidAt!: string | null;
  @ApiPropertyOptional({ nullable: true }) approvalJournalId!: string | null;
  @ApiPropertyOptional({ nullable: true }) paymentJournalId!: string | null;

  @ApiProperty({ type: [ExpenseClaimLineEntity] })
  lines!: ExpenseClaimLineEntity[];

  @ApiProperty() createdAt!: string;

  constructor(partial: Partial<ExpenseClaimEntity>) {
    Object.assign(this, partial);
  }
}
