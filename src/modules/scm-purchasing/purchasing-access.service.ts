import { ForbiddenException, Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';

/**
 * Access rules for Purchasing (Purchase Orders). Mirrors the Supplier/Vendor
 * qualification policy: company-wide READ (no assert), SCM-vertical Manager+ or
 * SUPER_ADMIN to create/edit/issue/cancel.
 */
@Injectable()
export class PurchasingAccessService {
  constructor(private readonly prisma: PrismaService) {}

  isSuperAdmin(user: AuthenticatedUser): boolean {
    return user.role === Role.SUPER_ADMIN;
  }

  private async isScmManager(user: AuthenticatedUser): Promise<boolean> {
    if (user.role !== Role.MANAGER) return false;
    if (!user.verticalId) return false;
    const vertical = await this.prisma.vertical.findUnique({
      where: { id: user.verticalId },
    });
    return vertical?.code === 'SCM';
  }

  /** Create / edit / issue / cancel a PO — SCM-vertical Manager+ or SUPER_ADMIN. */
  async assertCanManagePurchaseOrders(user: AuthenticatedUser): Promise<void> {
    if (this.isSuperAdmin(user)) return;
    if (!(await this.isScmManager(user))) {
      throw new ForbiddenException(
        'Only an SCM-vertical Manager or SUPER_ADMIN may manage purchase orders',
      );
    }
  }
}
