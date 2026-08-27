import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ExpenseClaimStatus,
  ExpenseReceiptStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import {
  EMPTY_PENDING_QUEUE,
  PendingQueue,
} from '../../common/types/pending-queue';
import { SalesNumberingService } from '../sales/common/sales-numbering.service';
import { FinanceService } from '../finance/finance.service';
import { FinanceAccessService } from '../finance/finance-access.service';
import { VaultStorageService } from '../vault/vault-storage.service';
import {
  assertExtensionAllowed,
  assertSizeWithinCap,
} from '../vault/vault-guardrails';
import {
  AddExpenseClaimLineDto,
  CreateExpenseClaimDto,
  CreateReceiptUploadUrlDto,
  RejectExpenseClaimDto,
  UpdateExpenseClaimDto,
} from './dto/expense-claims.dto';
import {
  ExpenseClaimEntity,
  ExpenseClaimLineEntity,
  ExpenseReceiptUploadTicketEntity,
} from './entities/expense-claims.entity';

/** Ledger codes credited/debited by the two claim journals. */
const REIMBURSEMENTS_PAYABLE_CODE = '2500';
const CASH_AND_BANK_CODE = '1000';

const NAME_SELECT = { select: { firstName: true, lastName: true } } as const;

const CLAIM_INCLUDE = {
  employee: NAME_SELECT,
  approvedBy: NAME_SELECT,
  rejectedBy: NAME_SELECT,
  paidBy: NAME_SELECT,
  lines: {
    orderBy: { expenseDate: 'asc' as const },
    include: {
      category: { select: { name: true, defaultExpenseLedgerId: true } },
      receipt: { select: { filename: true } },
    },
  },
} as const;

type ClaimWithRelations = Prisma.ExpenseClaimGetPayload<{
  include: typeof CLAIM_INCLUDE;
}>;

/**
 * Employee expense claims. Any employee raises a claim for themselves, attaches
 * a mandatory receipt to each line, and submits it. The designated Accounts Head
 * (or a SUPER_ADMIN, who may also approve their own) approves or rejects it; on
 * approval a balanced journal debits the mapped expense ledger(s) and credits
 * "Employee Reimbursements Payable" (2500). Marking the claim Paid posts a second
 * journal clearing 2500 against Cash and Bank (1000). Every GL side goes through
 * FinanceService.postJournalTx so it lands as a normal POSTED journal.
 */
@Injectable()
export class ExpenseClaimsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: SalesNumberingService,
    private readonly finance: FinanceService,
    private readonly financeAccess: FinanceAccessService,
    private readonly storage: VaultStorageService,
  ) {}

  // ── Receipts (two-step presigned upload) ───────────────────────────────────

  private receiptStorageKey(receiptId: string): string {
    return `expenses/receipts/${receiptId}`;
  }

  /**
   * Step 1 — validate, create a PENDING receipt row owned by the caller so we
   * own the id (and therefore the storage key), then presign the PUT.
   */
  async createReceiptUploadUrl(
    dto: CreateReceiptUploadUrlDto,
    user: AuthenticatedUser,
  ): Promise<ExpenseReceiptUploadTicketEntity> {
    assertExtensionAllowed(dto.filename);
    assertSizeWithinCap(dto.sizeBytes);

    const receipt = await this.prisma.expenseClaimReceipt.create({
      data: {
        uploadedById: user.id,
        filename: dto.filename,
        contentType: dto.contentType,
        sizeBytes: BigInt(dto.sizeBytes),
        storageKey: '', // set below once we have the id
        status: ExpenseReceiptStatus.PENDING,
      },
    });
    const storageKey = this.receiptStorageKey(receipt.id);
    await this.prisma.expenseClaimReceipt.update({
      where: { id: receipt.id },
      data: { storageKey },
    });

    const { url, expiresInSeconds } = await this.storage.createUploadUrl(
      storageKey,
      dto.contentType || 'application/octet-stream',
    );
    return new ExpenseReceiptUploadTicketEntity({
      receiptId: receipt.id,
      uploadUrl: url,
      expiresInSeconds,
    });
  }

  /**
   * Step 2 — HEAD-check the object actually landed in R2 (existence + declared
   * size) before flipping the receipt ACTIVE. Idempotent: an already-ACTIVE
   * receipt returns cleanly so a client retry is a no-op. Only the uploader may
   * confirm their own receipt.
   */
  async confirmReceipt(
    receiptId: string,
    user: AuthenticatedUser,
  ): Promise<{ id: string; status: string }> {
    const receipt = await this.prisma.expenseClaimReceipt.findUnique({
      where: { id: receiptId },
    });
    if (!receipt || receipt.uploadedById !== user.id)
      throw new NotFoundException('Receipt not found');
    if (receipt.status === ExpenseReceiptStatus.ACTIVE)
      return { id: receipt.id, status: receipt.status };

    const head = await this.storage.headObject(receipt.storageKey);
    if (!head)
      throw new BadRequestException(
        'No uploaded object found at the expected storage key — upload may not have completed',
      );
    if (head.sizeBytes !== Number(receipt.sizeBytes))
      throw new BadRequestException(
        `Uploaded size (${head.sizeBytes}) does not match the declared size (${receipt.sizeBytes})`,
      );

    const updated = await this.prisma.expenseClaimReceipt.update({
      where: { id: receiptId },
      data: { status: ExpenseReceiptStatus.ACTIVE },
    });
    return { id: updated.id, status: updated.status };
  }

  /**
   * A short-lived presigned download URL. The claimant sees their own receipts;
   * an approver (Accounts Head / SUPER_ADMIN) sees any — so a receipt is
   * reviewable at approval time.
   */
  async receiptDownloadUrl(
    receiptId: string,
    user: AuthenticatedUser,
  ): Promise<{ url: string; expiresInSeconds: number }> {
    const receipt = await this.prisma.expenseClaimReceipt.findUnique({
      where: { id: receiptId },
    });
    if (!receipt || receipt.status !== ExpenseReceiptStatus.ACTIVE)
      throw new NotFoundException('Receipt not found');
    if (receipt.uploadedById !== user.id && !(await this.isApprover(user)))
      throw new ForbiddenException('You cannot view this receipt');
    return this.storage.createDownloadUrl(receipt.storageKey);
  }

  // ── Claims (CRUD while DRAFT) ───────────────────────────────────────────────

  async createClaim(
    dto: CreateExpenseClaimDto,
    user: AuthenticatedUser,
  ): Promise<ExpenseClaimEntity> {
    const title = dto.title.trim();
    if (!title) throw new BadRequestException('Title is required');
    const claim = await this.prisma.$transaction(async (tx) => {
      const claimNumber = await this.numbering.nextNumber(
        'EXP',
        'expense_claim',
        new Date().getFullYear(),
        tx,
      );
      return tx.expenseClaim.create({
        data: {
          claimNumber,
          employeeId: user.id,
          title,
          status: ExpenseClaimStatus.DRAFT,
        },
      });
    });
    return this.getClaim(claim.id, user);
  }

  async updateClaim(
    id: string,
    dto: UpdateExpenseClaimDto,
    user: AuthenticatedUser,
  ): Promise<ExpenseClaimEntity> {
    const claim = await this.ownedDraft(id, user);
    const title = dto.title?.trim();
    if (dto.title !== undefined && !title)
      throw new BadRequestException('Title cannot be blank');
    await this.prisma.expenseClaim.update({
      where: { id: claim.id },
      data: { ...(title !== undefined ? { title } : {}) },
    });
    return this.getClaim(id, user);
  }

  /** Claims raised by the caller (their own self-service list). */
  async listMine(user: AuthenticatedUser): Promise<ExpenseClaimEntity[]> {
    const rows = await this.prisma.expenseClaim.findMany({
      where: { employeeId: user.id },
      include: CLAIM_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => this.toEntity(r));
  }

  /**
   * The approver queue — SUBMITTED (awaiting approve/reject) and APPROVED
   * (awaiting payout). Approver-only.
   */
  async listForReview(user: AuthenticatedUser): Promise<ExpenseClaimEntity[]> {
    await this.assertApprover(user);
    const rows = await this.prisma.expenseClaim.findMany({
      where: ExpenseClaimsService.REVIEW_QUEUE_WHERE,
      include: CLAIM_INCLUDE,
      orderBy: { submittedAt: 'asc' },
    });
    return rows.map((r) => this.toEntity(r));
  }

  /** Shared scope for the approver queue (list + badge summary). */
  private static readonly REVIEW_QUEUE_WHERE = {
    status: {
      in: [ExpenseClaimStatus.SUBMITTED, ExpenseClaimStatus.APPROVED],
    },
  };

  /**
   * Badge summary for the approver queue — count plus when the oldest claim was
   * submitted. Same where-clause and oldest-first ordering as listForReview, so
   * it covers both stages that need action (approve, then pay out): a claim
   * approved but never paid keeps ageing, which is the point. Returns an empty
   * queue for non-approvers instead of throwing.
   */
  async pendingReviewQueue(user: AuthenticatedUser): Promise<PendingQueue> {
    if (!(await this.isApprover(user))) return EMPTY_PENDING_QUEUE;
    const where = ExpenseClaimsService.REVIEW_QUEUE_WHERE;
    const [count, oldest] = await Promise.all([
      this.prisma.expenseClaim.count({ where }),
      this.prisma.expenseClaim.findFirst({
        where,
        orderBy: { submittedAt: 'asc' },
        select: { submittedAt: true, createdAt: true },
      }),
    ]);
    return {
      count,
      oldestPendingAt: oldest ? (oldest.submittedAt ?? oldest.createdAt) : null,
    };
  }

  async getClaim(
    id: string,
    user: AuthenticatedUser,
  ): Promise<ExpenseClaimEntity> {
    const claim = await this.prisma.expenseClaim.findUnique({
      where: { id },
      include: CLAIM_INCLUDE,
    });
    if (!claim) throw new NotFoundException('Expense claim not found');
    if (claim.employeeId !== user.id && !(await this.isApprover(user)))
      throw new ForbiddenException('You cannot view this claim');
    return this.toEntity(claim);
  }

  // ── Lines ───────────────────────────────────────────────────────────────────

  /**
   * Add a line. The receipt is MANDATORY and enforced here, not just in the UI:
   * the receipt must be ACTIVE, owned by the claimant, and not already attached
   * to another line. The DB backs this too — expense_claim_lines.receiptId is a
   * required, unique FK — so a receipt-less or receipt-shared line cannot exist.
   */
  async addLine(
    claimId: string,
    dto: AddExpenseClaimLineDto,
    user: AuthenticatedUser,
  ): Promise<ExpenseClaimEntity> {
    const claim = await this.ownedDraft(claimId, user);

    const category = await this.prisma.expenseCategory.findUnique({
      where: { id: dto.categoryId },
    });
    if (!category || !category.isActive)
      throw new BadRequestException('Expense category is missing or inactive');

    const receipt = await this.prisma.expenseClaimReceipt.findUnique({
      where: { id: dto.receiptId },
      include: { line: { select: { id: true } } },
    });
    if (!receipt || receipt.uploadedById !== user.id)
      throw new BadRequestException('Receipt not found');
    if (receipt.status !== ExpenseReceiptStatus.ACTIVE)
      throw new BadRequestException(
        'Receipt upload is not confirmed yet — every line must have a confirmed receipt',
      );
    if (receipt.line)
      throw new BadRequestException(
        'That receipt is already attached to another line',
      );

    await this.prisma.$transaction(async (tx) => {
      await tx.expenseClaimLine.create({
        data: {
          claimId: claim.id,
          expenseDate: new Date(dto.expenseDate),
          categoryId: dto.categoryId,
          description: dto.description.trim(),
          amount: new Prisma.Decimal(dto.amount),
          receiptId: dto.receiptId,
        },
      });
      await this.recomputeTotal(tx, claim.id);
    });
    return this.getClaim(claimId, user);
  }

  async removeLine(
    claimId: string,
    lineId: string,
    user: AuthenticatedUser,
  ): Promise<ExpenseClaimEntity> {
    const claim = await this.ownedDraft(claimId, user);
    const line = await this.prisma.expenseClaimLine.findUnique({
      where: { id: lineId },
    });
    if (!line || line.claimId !== claim.id)
      throw new NotFoundException('Line not found');
    await this.prisma.$transaction(async (tx) => {
      await tx.expenseClaimLine.delete({ where: { id: lineId } });
      await this.recomputeTotal(tx, claim.id);
    });
    return this.getClaim(claimId, user);
  }

  // ── Lifecycle transitions ─────────────────────────────────────────────────

  /**
   * DRAFT → SUBMITTED. Requires at least one line; the receipt-per-line
   * invariant is guaranteed by the schema, but re-checked here as
   * defense-in-depth so submission can never bypass it.
   */
  async submit(
    id: string,
    user: AuthenticatedUser,
  ): Promise<ExpenseClaimEntity> {
    const claim = await this.ownedDraft(id, user);
    const lines = await this.prisma.expenseClaimLine.findMany({
      where: { claimId: claim.id },
      select: { id: true, receiptId: true },
    });
    if (lines.length === 0)
      throw new BadRequestException(
        'Add at least one line before submitting the claim',
      );
    if (lines.some((l) => !l.receiptId))
      throw new BadRequestException(
        'Every line must have a receipt attached before submitting',
      );
    await this.prisma.expenseClaim.update({
      where: { id: claim.id },
      data: { status: ExpenseClaimStatus.SUBMITTED, submittedAt: new Date() },
    });
    return this.getClaim(id, user);
  }

  /**
   * SUBMITTED → APPROVED. Posts the approval journal (debit each mapped expense
   * ledger, grouped by ledger; credit 2500 for the total) atomically with the
   * status flip.
   */
  async approve(
    id: string,
    user: AuthenticatedUser,
  ): Promise<ExpenseClaimEntity> {
    const claim = await this.loadForAction(id);
    await this.assertCanApprove(claim.employeeId, user);
    if (claim.status !== ExpenseClaimStatus.SUBMITTED)
      throw new BadRequestException('Only submitted claims can be approved');
    if (claim.lines.length === 0)
      throw new BadRequestException('Cannot approve a claim with no lines');

    await this.prisma.$transaction(async (tx) => {
      const now = new Date();
      // Group debits by the category's mapped expense ledger, so a mixed-
      // category claim posts one debit leg per distinct ledger.
      const debitByLedger = new Map<string, Prisma.Decimal>();
      for (const line of claim.lines) {
        const ledgerId = line.category.defaultExpenseLedgerId;
        const prev = debitByLedger.get(ledgerId) ?? new Prisma.Decimal(0);
        debitByLedger.set(ledgerId, prev.add(line.amount));
      }
      const total = Array.from(debitByLedger.values()).reduce(
        (acc, v) => acc.add(v),
        new Prisma.Decimal(0),
      );
      const payableId = await this.ledgerIdByCode(
        tx,
        REIMBURSEMENTS_PAYABLE_CODE,
      );

      const lines = [
        ...Array.from(debitByLedger.entries()).map(([accountId, amount]) => ({
          accountId,
          debit: amount,
          credit: new Prisma.Decimal(0),
        })),
        {
          accountId: payableId,
          debit: new Prisma.Decimal(0),
          credit: total,
        },
      ];

      const journal = await this.finance.postJournalTx(tx, {
        entryDate: now,
        description: `Expense claim ${claim.claimNumber} — ${claim.title}`,
        reference: claim.claimNumber,
        createdById: claim.employeeId,
        submittedById: claim.employeeId,
        submittedAt: claim.submittedAt,
        approvedById: user.id,
        approvedAt: now,
        lines,
      });

      await tx.expenseClaim.update({
        where: { id: claim.id },
        data: {
          status: ExpenseClaimStatus.APPROVED,
          approvedById: user.id,
          approvedAt: now,
          approvalJournalId: journal.id,
        },
      });
    });
    return this.getClaim(id, user);
  }

  /** SUBMITTED → REJECTED. Rejection requires a comment. */
  async reject(
    id: string,
    dto: RejectExpenseClaimDto,
    user: AuthenticatedUser,
  ): Promise<ExpenseClaimEntity> {
    const claim = await this.loadForAction(id);
    await this.assertCanApprove(claim.employeeId, user);
    if (claim.status !== ExpenseClaimStatus.SUBMITTED)
      throw new BadRequestException('Only submitted claims can be rejected');
    const comment = dto.comment?.trim();
    if (!comment)
      throw new BadRequestException('A rejection comment is required');
    await this.prisma.expenseClaim.update({
      where: { id: claim.id },
      data: {
        status: ExpenseClaimStatus.REJECTED,
        rejectedById: user.id,
        rejectedAt: new Date(),
        rejectionComment: comment,
      },
    });
    return this.getClaim(id, user);
  }

  /**
   * APPROVED → PAID. Posts the payment journal (debit 2500 for the claim total,
   * credit Cash and Bank) atomically with the status flip.
   */
  async markPaid(
    id: string,
    user: AuthenticatedUser,
  ): Promise<ExpenseClaimEntity> {
    const claim = await this.loadForAction(id);
    await this.assertCanApprove(claim.employeeId, user);
    if (claim.status !== ExpenseClaimStatus.APPROVED)
      throw new BadRequestException('Only approved claims can be marked paid');

    await this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const payableId = await this.ledgerIdByCode(
        tx,
        REIMBURSEMENTS_PAYABLE_CODE,
      );
      const cashId = await this.ledgerIdByCode(tx, CASH_AND_BANK_CODE);
      const total = new Prisma.Decimal(claim.totalAmount);

      const journal = await this.finance.postJournalTx(tx, {
        entryDate: now,
        description: `Expense claim ${claim.claimNumber} reimbursement — ${claim.title}`,
        reference: claim.claimNumber,
        createdById: claim.employeeId,
        approvedById: user.id,
        approvedAt: now,
        lines: [
          {
            accountId: payableId,
            debit: total,
            credit: new Prisma.Decimal(0),
          },
          {
            accountId: cashId,
            debit: new Prisma.Decimal(0),
            credit: total,
          },
        ],
      });

      await tx.expenseClaim.update({
        where: { id: claim.id },
        data: {
          status: ExpenseClaimStatus.PAID,
          paidById: user.id,
          paidAt: now,
          paymentJournalId: journal.id,
        },
      });
    });
    return this.getClaim(id, user);
  }

  // ── internals ────────────────────────────────────────────────────────────

  /** Load a claim that must be the caller's own DRAFT (for edits). */
  private async ownedDraft(id: string, user: AuthenticatedUser) {
    const claim = await this.prisma.expenseClaim.findUnique({ where: { id } });
    if (!claim) throw new NotFoundException('Expense claim not found');
    if (claim.employeeId !== user.id)
      throw new ForbiddenException('You can only edit your own claims');
    if (claim.status !== ExpenseClaimStatus.DRAFT)
      throw new BadRequestException(
        'Only draft claims can be edited — this claim has already been submitted',
      );
    return claim;
  }

  private async loadForAction(id: string): Promise<ClaimWithRelations> {
    const claim = await this.prisma.expenseClaim.findUnique({
      where: { id },
      include: CLAIM_INCLUDE,
    });
    if (!claim) throw new NotFoundException('Expense claim not found');
    return claim;
  }

  /** True if the user may act on claims (approve/reject/pay/view all). */
  private async isApprover(user: AuthenticatedUser): Promise<boolean> {
    if (user.role === 'SUPER_ADMIN') return true;
    const access = await this.financeAccess.accessFor(user);
    return access.isAccountsHead;
  }

  private async assertApprover(user: AuthenticatedUser): Promise<void> {
    if (!(await this.isApprover(user)))
      throw new ForbiddenException(
        'Only the Accounts Head or a Super Admin may review expense claims',
      );
  }

  /**
   * Approval authority. A SUPER_ADMIN may approve anything, including their own
   * claim. Otherwise the caller must be the designated Accounts Head AND must
   * not be the claimant — a self-claim by the Accounts Head falls to a Super
   * Admin. (Note: this deliberately adds the Super-Admin self-approval override
   * the spec calls for, which the AP approval flow does not have.)
   */
  private async assertCanApprove(
    claimantId: string,
    user: AuthenticatedUser,
  ): Promise<void> {
    if (user.role === 'SUPER_ADMIN') return;
    await this.financeAccess.assertAccountsHead(user);
    if (claimantId === user.id)
      throw new ForbiddenException(
        'The Accounts Head cannot approve their own expense claim — it must be approved by a Super Admin',
      );
  }

  private async ledgerIdByCode(
    tx: Prisma.TransactionClient,
    code: string,
  ): Promise<string> {
    const ledger = await tx.ledgerAccount.findUnique({ where: { code } });
    if (!ledger || !ledger.isActive)
      throw new BadRequestException(
        `Required ledger account ${code} is missing or inactive`,
      );
    return ledger.id;
  }

  private async recomputeTotal(
    tx: Prisma.TransactionClient,
    claimId: string,
  ): Promise<void> {
    const agg = await tx.expenseClaimLine.aggregate({
      where: { claimId },
      _sum: { amount: true },
    });
    await tx.expenseClaim.update({
      where: { id: claimId },
      data: { totalAmount: agg._sum.amount ?? new Prisma.Decimal(0) },
    });
  }

  private fullName(
    e: { firstName: string; lastName: string } | null | undefined,
  ): string | null {
    return e ? `${e.firstName} ${e.lastName}` : null;
  }

  private toEntity(claim: ClaimWithRelations): ExpenseClaimEntity {
    return new ExpenseClaimEntity({
      id: claim.id,
      claimNumber: claim.claimNumber,
      employeeId: claim.employeeId,
      employeeName: this.fullName(claim.employee),
      title: claim.title,
      status: claim.status,
      totalAmount: Number(claim.totalAmount),
      submittedAt: claim.submittedAt?.toISOString() ?? null,
      approvedById: claim.approvedById,
      approvedByName: this.fullName(claim.approvedBy),
      approvedAt: claim.approvedAt?.toISOString() ?? null,
      rejectedByName: this.fullName(claim.rejectedBy),
      rejectedAt: claim.rejectedAt?.toISOString() ?? null,
      rejectionComment: claim.rejectionComment,
      paidByName: this.fullName(claim.paidBy),
      paidAt: claim.paidAt?.toISOString() ?? null,
      approvalJournalId: claim.approvalJournalId,
      paymentJournalId: claim.paymentJournalId,
      lines: claim.lines.map(
        (l) =>
          new ExpenseClaimLineEntity({
            id: l.id,
            expenseDate: l.expenseDate.toISOString(),
            categoryId: l.categoryId,
            categoryName: l.category.name,
            description: l.description,
            amount: Number(l.amount),
            receiptId: l.receiptId,
            receiptFilename: l.receipt.filename,
          }),
      ),
      createdAt: claim.createdAt.toISOString(),
    });
  }
}
