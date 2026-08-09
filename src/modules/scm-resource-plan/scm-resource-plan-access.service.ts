import { ForbiddenException, Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { ItemCostService } from '../bom/item-cost.service';

/**
 * Three-tier access for SCM Resource Planning (§6):
 *
 *  - VIEW (incl. benchmark cost): SCM-vertical, CEO/SUPER_ADMIN, Finance.
 *    Delegated to ItemCostService.canViewCost — the resource plan surfaces item
 *    benchmark cost, so "who may view a plan" is exactly "who may see item cost"
 *    (the rule amended for the Item Master cost feature). Production/Store, who
 *    cannot see cost, therefore cannot see resource plans either.
 *  - GENERATE / REGENERATE: SCM-vertical Manager+ or SUPER_ADMIN. Rebuilding the
 *    plan re-snapshots benchmark costs and rewrites quantities, so it stays at
 *    the SCM Manager level (plain ADMIN is account-management-only).
 *  - EDIT negotiated prices: any SCM-vertical employee (or SUPER_ADMIN). Data
 *    entry on their own negotiation is open to the whole vertical; Finance may
 *    see the numbers but not enter them.
 */
@Injectable()
export class ScmResourcePlanAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly itemCost: ItemCostService,
  ) {}

  private isSuperAdmin(user: AuthenticatedUser): boolean {
    return user.role === Role.SUPER_ADMIN;
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

  /** SCM-vertical staff at MANAGER level (Manager-or-above in the SCM vertical). */
  private async isScmManager(user: AuthenticatedUser): Promise<boolean> {
    if (user.role !== Role.MANAGER) return false;
    return this.isScmStaff(user);
  }

  // ── View ────────────────────────────────────────────────────────────
  async canView(user: AuthenticatedUser): Promise<boolean> {
    return this.itemCost.canViewCost(user);
  }

  async assertCanView(user: AuthenticatedUser): Promise<void> {
    if (!(await this.canView(user))) {
      throw new ForbiddenException(
        'You do not have access to SCM resource plans',
      );
    }
  }

  // ── Generate / Regenerate ───────────────────────────────────────────
  async assertCanGenerate(user: AuthenticatedUser): Promise<void> {
    if (this.isSuperAdmin(user)) return;
    if (!(await this.isScmManager(user))) {
      throw new ForbiddenException(
        'Only an SCM-vertical Manager or SUPER_ADMIN may generate or regenerate a resource plan',
      );
    }
  }

  // ── Edit negotiated prices ──────────────────────────────────────────
  async assertCanEdit(user: AuthenticatedUser): Promise<void> {
    if (this.isSuperAdmin(user)) return;
    if (!(await this.isScmStaff(user))) {
      throw new ForbiddenException(
        'Only SCM-vertical staff or SUPER_ADMIN may edit negotiated prices',
      );
    }
  }
}
