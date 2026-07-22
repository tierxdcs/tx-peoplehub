import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ContraVoucherStatus } from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { FinanceAccessService } from '../finance/finance-access.service';
import { FinanceService } from '../finance/finance.service';
import { CreateContraVoucherDto } from './dto/contra.dto';

const CONTRA_INCLUDE = {
  fromLedgerAccount: true,
  toLedgerAccount: true,
  createdBy: { select: { id: true, firstName: true, lastName: true } },
  approvedBy: { select: { id: true, firstName: true, lastName: true } },
};

/**
 * Bank/cash-eligible account GROUP codes, seeded in prisma/seed.ts
 * (ACCOUNT_GROUPS `isBankOrCash: true`). A Contra voucher's two legs must
 * both sit under one of these groups — a transfer between two non-bank/cash
 * ledgers (e.g. two expense accounts) belongs in a Journal Voucher instead.
 * Kept in sync with the seed by code, not by a persisted DB flag, since the
 * grouping is itself just parentId — see Increment 2 discovery notes.
 */
const BANK_OR_CASH_GROUP_CODES = ['GRP-BANK', 'GRP-CASH'];

@Injectable()
export class ContraService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: FinanceAccessService,
    private readonly finance: FinanceService,
  ) {}

  /** Both the ledger itself AND its parent group may be bank/cash-eligible. */
  private async assertBankOrCashLedger(id: string, label: string) {
    const account = await this.prisma.ledgerAccount.findUnique({
      where: { id },
      include: { parent: true },
    });
    if (!account) throw new NotFoundException(`${label} ledger not found`);
    const eligible =
      BANK_OR_CASH_GROUP_CODES.includes(account.code) ||
      (account.parent && BANK_OR_CASH_GROUP_CODES.includes(account.parent.code));
    if (!eligible)
      throw new BadRequestException(
        `${label} ledger "${account.name}" is not a bank or cash account — a transfer between non-bank/cash ledgers is a Journal Voucher, not a Contra`,
      );
    return account;
  }

  async create(dto: CreateContraVoucherDto, user: AuthenticatedUser) {
    await this.access.assertCanUseFinance(user);
    if (dto.fromLedgerAccountId === dto.toLedgerAccountId)
      throw new BadRequestException(
        'From and To ledgers must be different accounts',
      );
    await this.assertBankOrCashLedger(dto.fromLedgerAccountId, 'From');
    await this.assertBankOrCashLedger(dto.toLedgerAccountId, 'To');
    const voucherDate = this.day(dto.voucherDate);
    return this.prisma.$transaction(async (tx) => {
      const year = voucherDate.getUTCFullYear();
      const seq = await tx.financeSequence.upsert({
        where: { entity_year: { entity: 'CONTRA', year } },
        create: { entity: 'CONTRA', year, lastValue: 1 },
        update: { lastValue: { increment: 1 } },
      });
      const voucherNumber = `CV-${year}-${String(seq.lastValue).padStart(5, '0')}`;
      return tx.contraVoucher.create({
        data: {
          voucherNumber,
          voucherDate,
          fromLedgerAccountId: dto.fromLedgerAccountId,
          toLedgerAccountId: dto.toLedgerAccountId,
          amount: dto.amount,
          narration: dto.narration,
          createdById: user.id,
        },
        include: CONTRA_INCLUDE,
      });
    });
  }

  async list(query: PaginationQueryDto, user: AuthenticatedUser) {
    await this.access.assertCanUseFinance(user);
    const [items, total] = await this.prisma.$transaction([
      this.prisma.contraVoucher.findMany({
        include: CONTRA_INCLUDE,
        orderBy: { voucherDate: 'desc' },
        skip: query.skip,
        take: query.limit,
      }),
      this.prisma.contraVoucher.count(),
    ]);
    return { items, total, page: query.page, limit: query.limit };
  }

  async findOne(id: string, user: AuthenticatedUser) {
    await this.access.assertCanUseFinance(user);
    return this.findOrThrow(id);
  }

  async submit(id: string, user: AuthenticatedUser) {
    await this.access.assertCanUseFinance(user);
    const voucher = await this.findOrThrow(id);
    if (
      !(
        [ContraVoucherStatus.DRAFT, ContraVoucherStatus.REJECTED] as ContraVoucherStatus[]
      ).includes(voucher.status)
    )
      throw new BadRequestException(
        'Only a draft or rejected contra voucher can be submitted',
      );
    return this.prisma.contraVoucher.update({
      where: { id },
      data: {
        status: ContraVoucherStatus.PENDING_APPROVAL,
        submittedById: user.id,
        submittedAt: new Date(),
        rejectionComment: null,
      },
      include: CONTRA_INCLUDE,
    });
  }

  async approve(id: string, user: AuthenticatedUser) {
    await this.access.assertAccountsHead(user);
    const voucher = await this.findOrThrow(id);
    if (voucher.status !== ContraVoucherStatus.PENDING_APPROVAL)
      throw new BadRequestException(
        'Only a pending contra voucher can be approved',
      );
    if (voucher.createdById === user.id)
      throw new BadRequestException(
        'The Finance Head cannot approve a contra voucher they created',
      );
    return this.post(voucher, user.id);
  }

  async reject(id: string, comment: string, user: AuthenticatedUser) {
    await this.access.assertAccountsHead(user);
    const voucher = await this.findOrThrow(id);
    if (voucher.status !== ContraVoucherStatus.PENDING_APPROVAL)
      throw new BadRequestException(
        'Only a pending contra voucher can be rejected',
      );
    return this.prisma.contraVoucher.update({
      where: { id },
      data: {
        status: ContraVoucherStatus.REJECTED,
        rejectionComment: comment,
      },
      include: CONTRA_INCLUDE,
    });
  }

  /** Posts the balanced Dr To-ledger / Cr From-ledger journal via the shared helper. */
  private async post(voucher: any, approverId: string) {
    return this.prisma.$transaction(async (tx) => {
      const journal = await this.finance.postJournalTx(tx, {
        entryDate: voucher.voucherDate,
        description: `Contra voucher ${voucher.voucherNumber}`,
        reference: voucher.voucherNumber,
        createdById: voucher.createdById,
        submittedById: voucher.submittedById,
        submittedAt: voucher.submittedAt,
        approvedById: approverId,
        lines: [
          {
            accountId: voucher.toLedgerAccountId,
            debit: voucher.amount,
            credit: 0,
          },
          {
            accountId: voucher.fromLedgerAccountId,
            debit: 0,
            credit: voucher.amount,
          },
        ],
      });
      return tx.contraVoucher.update({
        where: { id: voucher.id },
        data: {
          status: ContraVoucherStatus.POSTED,
          approvedById: approverId,
          approvedAt: new Date(),
          journalEntryId: journal.id,
        },
        include: CONTRA_INCLUDE,
      });
    });
  }

  private async findOrThrow(id: string) {
    const voucher = await this.prisma.contraVoucher.findUnique({
      where: { id },
      include: CONTRA_INCLUDE,
    });
    if (!voucher) throw new NotFoundException('Contra voucher not found');
    return voucher;
  }

  private day(value: string) {
    return new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  }
}
