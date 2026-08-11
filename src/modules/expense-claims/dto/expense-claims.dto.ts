import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

// ── Expense categories (admin config) ───────────────────────────────────────

export class CreateExpenseCategoryDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @ApiProperty({ description: 'Ledger account (id) this category posts to' })
  @IsUUID()
  defaultExpenseLedgerId!: string;
}

export class UpdateExpenseCategoryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({ description: 'Re-map the posting ledger account' })
  @IsOptional()
  @IsUUID()
  defaultExpenseLedgerId?: string;

  @ApiPropertyOptional({ description: 'Soft deactivate — hides from the picker' })
  @IsOptional()
  isActive?: boolean;
}

// ── Claim header ─────────────────────────────────────────────────────────────

export class CreateExpenseClaimDto {
  @ApiProperty({ description: 'A short human title for the claim' })
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  title!: string;
}

export class UpdateExpenseClaimDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  title?: string;
}

// ── Receipts (two-step presigned upload) ─────────────────────────────────────

export class CreateReceiptUploadUrlDto {
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

export class ConfirmReceiptDto {}

// ── Claim lines ──────────────────────────────────────────────────────────────

export class AddExpenseClaimLineDto {
  @ApiProperty({ description: 'Date the expense was incurred (ISO)' })
  @IsDateString()
  expenseDate!: string;

  @ApiProperty()
  @IsUUID()
  categoryId!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  description!: string;

  @ApiProperty({ description: 'Amount claimed for this line' })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount!: number;

  @ApiProperty({
    description:
      'An ACTIVE receipt (confirmed upload) belonging to the claimant. Mandatory — a line cannot be created without one.',
  })
  @IsUUID()
  receiptId!: string;
}

// ── Approval / rejection ─────────────────────────────────────────────────────

export class RejectExpenseClaimDto {
  @ApiProperty({ description: 'Reason for rejection (required)' })
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  comment!: string;
}
