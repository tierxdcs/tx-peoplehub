import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AccountType, Prisma } from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import {
  CreateExpenseCategoryDto,
  UpdateExpenseCategoryDto,
} from './dto/expense-claims.dto';
import { ExpenseCategoryEntity } from './entities/expense-claims.entity';

/**
 * Admin-managed expense-category catalogue. Each category maps to the expense
 * ledger its claim lines debit on approval. Deactivation is soft
 * (isActive=false): the row is retained so historical claims keep their
 * category, but it drops out of the claimant's picker. Mirrors the
 * MilestoneTemplate admin-lookup pattern.
 */
@Injectable()
export class ExpenseCategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  /** All categories (active + inactive) for admin management. */
  async list(): Promise<ExpenseCategoryEntity[]> {
    const rows = await this.prisma.expenseCategory.findMany({
      include: { defaultExpenseLedger: true },
      orderBy: { name: 'asc' },
    });
    return rows.map((r) => this.toEntity(r));
  }

  /**
   * The ledger accounts a category may map to — active accounts of an expense
   * type. Exposed for the admin category form's ledger picker so it needn't
   * pull the whole (finance-gated) chart of accounts.
   */
  async expenseLedgers(): Promise<
    { id: string; code: string; name: string }[]
  > {
    return this.prisma.ledgerAccount.findMany({
      where: {
        isActive: true,
        accountType: {
          in: [
            AccountType.EXPENSE,
            AccountType.OTHER_EXPENSE,
            AccountType.COST_OF_GOODS_SOLD,
          ],
        },
      },
      select: { id: true, code: true, name: true },
      orderBy: { code: 'asc' },
    });
  }

  /** Only ACTIVE categories — for the claim line picker. */
  async listActive(): Promise<ExpenseCategoryEntity[]> {
    const rows = await this.prisma.expenseCategory.findMany({
      where: { isActive: true },
      include: { defaultExpenseLedger: true },
      orderBy: { name: 'asc' },
    });
    return rows.map((r) => this.toEntity(r));
  }

  async create(dto: CreateExpenseCategoryDto): Promise<ExpenseCategoryEntity> {
    const name = dto.name.trim();
    if (!name) throw new BadRequestException('Name is required');
    await this.assertExpenseLedger(dto.defaultExpenseLedgerId);
    try {
      const row = await this.prisma.expenseCategory.create({
        data: { name, defaultExpenseLedgerId: dto.defaultExpenseLedgerId },
        include: { defaultExpenseLedger: true },
      });
      return this.toEntity(row);
    } catch (err) {
      throw this.rethrowDuplicate(err);
    }
  }

  async update(
    id: string,
    dto: UpdateExpenseCategoryDto,
  ): Promise<ExpenseCategoryEntity> {
    const current = await this.prisma.expenseCategory.findUnique({
      where: { id },
    });
    if (!current) throw new NotFoundException('Expense category not found');
    const name = dto.name?.trim();
    if (dto.name !== undefined && !name)
      throw new BadRequestException('Name cannot be blank');
    if (dto.defaultExpenseLedgerId !== undefined)
      await this.assertExpenseLedger(dto.defaultExpenseLedgerId);
    try {
      const row = await this.prisma.expenseCategory.update({
        where: { id },
        data: {
          ...(name !== undefined ? { name } : {}),
          ...(dto.defaultExpenseLedgerId !== undefined
            ? { defaultExpenseLedgerId: dto.defaultExpenseLedgerId }
            : {}),
          ...(dto.isActive !== undefined
            ? { isActive: Boolean(dto.isActive) }
            : {}),
        },
        include: { defaultExpenseLedger: true },
      });
      return this.toEntity(row);
    } catch (err) {
      throw this.rethrowDuplicate(err);
    }
  }

  /**
   * A category must point at a real, active ledger of an expense type — posting
   * would otherwise debit a non-expense account (or fail on approval). The
   * check is done here so a bad mapping is rejected at config time, not at the
   * point a claim is being approved.
   */
  private async assertExpenseLedger(ledgerId: string): Promise<void> {
    const ledger = await this.prisma.ledgerAccount.findUnique({
      where: { id: ledgerId },
      select: { isActive: true, accountType: true },
    });
    if (!ledger || !ledger.isActive)
      throw new BadRequestException('Ledger account is missing or inactive');
    if (
      ledger.accountType !== AccountType.EXPENSE &&
      ledger.accountType !== AccountType.OTHER_EXPENSE &&
      ledger.accountType !== AccountType.COST_OF_GOODS_SOLD
    )
      throw new BadRequestException(
        'The mapped ledger must be an expense-type account',
      );
  }

  private rethrowDuplicate(err: unknown): Error {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002'
    ) {
      return new ConflictException(
        'An expense category with this name already exists',
      );
    }
    return err as Error;
  }

  private toEntity(row: {
    id: string;
    name: string;
    defaultExpenseLedgerId: string;
    isActive: boolean;
    defaultExpenseLedger: { code: string; name: string };
  }): ExpenseCategoryEntity {
    return new ExpenseCategoryEntity({
      id: row.id,
      name: row.name,
      defaultExpenseLedgerId: row.defaultExpenseLedgerId,
      ledgerCode: row.defaultExpenseLedger.code,
      ledgerName: row.defaultExpenseLedger.name,
      isActive: row.isActive,
    });
  }
}
