import { ForbiddenException, Injectable } from '@nestjs/common';
import { GoodsReceiptNoteStatus, Prisma } from '@prisma/client';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../core/database/prisma.service';
import { FinanceAccessService } from '../finance/finance-access.service';

export interface CurrentItemCost {
  amount: Prisma.Decimal | null;
  source: 'LATEST_ACCEPTED_GRN' | 'MANUAL_STANDARD' | null;
}

@Injectable()
export class ItemCostService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly financeAccess: FinanceAccessService,
  ) {}

  /**
   * Who may SEE an item's cost — CEO/SuperAdmin, Finance, and SCM-vertical
   * staff. SCM is included deliberately: their Resource Planning work compares
   * negotiated prices against this benchmark cost, which is impossible without
   * visibility into it. This is strictly broader than who may EDIT the cost
   * (see canManageCost) — SCM reads the benchmark, it does not set it.
   */
  async canViewCost(user: AuthenticatedUser): Promise<boolean> {
    if (await this.canManageCost(user)) return true;
    return this.isScmStaff(user);
  }

  /**
   * Who may EDIT an item's manualStandardCost — CEO/SuperAdmin + Finance only.
   * Deliberately excludes SCM: the benchmark cost is theirs to consult, not to
   * change (that would let procurement move its own yardstick).
   */
  async canManageCost(user: AuthenticatedUser): Promise<boolean> {
    if (user.role === 'SUPER_ADMIN') return true;
    return (await this.financeAccess.accessFor(user)).isFinanceUser;
  }

  async assertCanManageCost(user: AuthenticatedUser): Promise<void> {
    if (!(await this.canManageCost(user))) {
      throw new ForbiddenException(
        'Only CEO/SuperAdmin or Finance users may update item cost',
      );
    }
  }

  /** SCM-vertical membership (any role) — resolves verticalId → code 'SCM'. */
  private async isScmStaff(user: AuthenticatedUser): Promise<boolean> {
    if (!user.verticalId) return false;
    const vertical = await this.prisma.vertical.findUnique({
      where: { id: user.verticalId },
      select: { code: true },
    });
    return vertical?.code === 'SCM';
  }

  async currentCost(itemId: string): Promise<CurrentItemCost> {
    const accepted = await this.prisma.goodsReceiptNoteLine.findFirst({
      where: {
        itemId,
        acceptedQuantity: { gt: 0 },
        grn: {
          status: {
            in: [
              GoodsReceiptNoteStatus.QC_PASSED,
              GoodsReceiptNoteStatus.QC_PARTIAL,
            ],
          },
        },
      },
      orderBy: [{ grn: { inspectedAt: 'desc' } }, { createdAt: 'desc' }],
      select: {
        purchaseOrderLine: { select: { unitPrice: true } },
      },
    });
    if (accepted) {
      return {
        amount: accepted.purchaseOrderLine.unitPrice,
        source: 'LATEST_ACCEPTED_GRN',
      };
    }
    const item = await this.prisma.item.findUnique({
      where: { id: itemId },
      select: { manualStandardCost: true },
    });
    return {
      amount: item?.manualStandardCost ?? null,
      source: item?.manualStandardCost ? 'MANUAL_STANDARD' : null,
    };
  }
}
