import { ForbiddenException, Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';

/**
 * Access rules for BOM / Item Master / Inventory.
 *
 * Verticals used: 'RND' (R&D — authors BOMs, edits item technical data),
 * 'PRODUCTION' (the Store/inventory owner). The repo has no dedicated Store
 * capability flag or vertical, so — per the task's "smallest consistent access
 * rule" instruction — we treat the existing PRODUCTION vertical as the Store
 * team (documented in BOM_INVENTORY.md). SUPER_ADMIN is a universal override
 * for management actions, EXCEPT technical BOM approval, which requires a real
 * isRdHead holder (SUPER_ADMIN must not auto-approve BOMs, per spec §1).
 */
@Injectable()
export class BomAccessService {
  constructor(private readonly prisma: PrismaService) {}

  isSuperAdmin(user: AuthenticatedUser): boolean {
    return user.role === Role.SUPER_ADMIN;
  }

  private async verticalCode(user: AuthenticatedUser): Promise<string | null> {
    if (!user.verticalId) return null;
    const vertical = await this.prisma.vertical.findUnique({
      where: { id: user.verticalId },
      select: { code: true },
    });
    return vertical?.code ?? null;
  }

  /** Any member of the R&D vertical (or SUPER_ADMIN). */
  async isRndStaff(user: AuthenticatedUser): Promise<boolean> {
    if (this.isSuperAdmin(user)) return true;
    return (await this.verticalCode(user)) === 'RND';
  }

  /** Store/inventory team — the PRODUCTION vertical (or SUPER_ADMIN). */
  async isStoreStaff(user: AuthenticatedUser): Promise<boolean> {
    if (this.isSuperAdmin(user)) return true;
    return (await this.verticalCode(user)) === 'PRODUCTION';
  }

  /** A real R&D Head designation. Does NOT include SUPER_ADMIN (spec §1). */
  async isRdHead(user: AuthenticatedUser): Promise<boolean> {
    const me = await this.prisma.employee.findUnique({
      where: { id: user.id },
      select: { isRdHead: true },
    });
    return !!me?.isRdHead;
  }

  // ── Assertions ──────────────────────────────────────────────────────

  /** Read access to items — R&D staff, Store staff, or SUPER_ADMIN. */
  async assertCanReadItems(user: AuthenticatedUser): Promise<void> {
    if (this.isSuperAdmin(user)) return;
    if ((await this.isRndStaff(user)) || (await this.isStoreStaff(user))) return;
    throw new ForbiddenException(
      'Only R&D or Store users may view the Item Master',
    );
  }

  /** Create/update item technical data — R&D Head or SUPER_ADMIN. */
  async assertCanManageItems(user: AuthenticatedUser): Promise<void> {
    if (this.isSuperAdmin(user)) return;
    if (await this.isRdHead(user)) return;
    throw new ForbiddenException(
      'Only an R&D Head or SUPER_ADMIN may create or update items',
    );
  }

  /**
   * Read BOMs in the context of the kickoff stock report — R&D staff, Store
   * staff, or SUPER_ADMIN. Store needs this so it can generate/read the
   * material stock-availability report, which reads the released BOM.
   */
  async assertCanReadBoms(user: AuthenticatedUser): Promise<void> {
    if (this.isSuperAdmin(user)) return;
    if ((await this.isRndStaff(user)) || (await this.isStoreStaff(user))) return;
    throw new ForbiddenException('Only R&D or Store users may view BOMs');
  }

  /**
   * Browse the BOM (Engineering) module — R&D vertical only (SUPER_ADMIN
   * included via isRndStaff). Stricter than assertCanReadBoms: Store users do
   * NOT get the Engineering BOM pages; they still reach released-BOM data
   * indirectly through the kickoff stock report.
   */
  async assertCanBrowseBoms(user: AuthenticatedUser): Promise<void> {
    if (await this.isRndStaff(user)) return;
    throw new ForbiddenException('Only R&D users may view the BOM module');
  }

  /** Create/edit/submit draft BOMs — R&D vertical only (or SUPER_ADMIN). */
  async assertCanAuthorBoms(user: AuthenticatedUser): Promise<void> {
    if (await this.isRndStaff(user)) return;
    throw new ForbiddenException(
      'Only an R&D-vertical employee may create or edit BOMs',
    );
  }

  /**
   * Approve/reject a submitted BOM — requires a real R&D Head designation.
   * SUPER_ADMIN is deliberately NOT sufficient here (spec §1).
   */
  async assertCanApproveBoms(user: AuthenticatedUser): Promise<void> {
    if (await this.isRdHead(user)) return;
    throw new ForbiddenException(
      'Only a designated R&D Head may approve or reject a BOM',
    );
  }

  /** Read inventory — R&D staff, Store staff, or SUPER_ADMIN. */
  async assertCanReadInventory(user: AuthenticatedUser): Promise<void> {
    if (this.isSuperAdmin(user)) return;
    if ((await this.isStoreStaff(user)) || (await this.isRndStaff(user))) return;
    throw new ForbiddenException('Only Store or R&D users may view inventory');
  }

  /** Adjust stock / manage reservations — Store staff or SUPER_ADMIN. */
  async assertCanManageInventory(user: AuthenticatedUser): Promise<void> {
    if (await this.isStoreStaff(user)) return;
    throw new ForbiddenException(
      'Only a Store (Production-vertical) user or SUPER_ADMIN may adjust stock or manage reservations',
    );
  }
}
