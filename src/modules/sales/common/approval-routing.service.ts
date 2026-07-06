import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';
import { AuthenticatedUser } from '../../../common/decorators/current-user.decorator';
import { isAdmin } from './sales-access.service';

/**
 * Manager-escalation / self-approval guard for bid discount approval —
 * the same rule already built and tested for leave requests
 * (LeaveRequestsService.resolveApprover / assertCanActOnRequest), lifted
 * here so bids reuse identical semantics:
 *
 * - The resolved approver for a submitter is their reportingManagerId. If
 *   the submitter IS a manager (their reportingManagerId would be their own
 *   manager), the same walk naturally escalates one level up — a manager's
 *   own bid routes to THEIR manager, never themselves.
 * - Self-approval is always blocked.
 * - Admin/SuperAdmin may act on anything (override).
 */
@Injectable()
export class ApprovalRoutingService {
  constructor(private readonly prisma: PrismaService) {}

  /** The employee who must approve a bid created by `createdById`, or null. */
  async resolveApprover(createdById: string): Promise<string | null> {
    const creator = await this.prisma.employee.findUnique({
      where: { id: createdById },
      select: { reportingManagerId: true },
    });
    let approverId = creator?.reportingManagerId ?? null;

    // Defensive one-level escalation if the chain ever self-references —
    // structurally unreachable today, kept as insurance (mirrors leave).
    if (approverId === createdById) {
      const manager = await this.prisma.employee.findUnique({
        where: { id: approverId },
        select: { reportingManagerId: true },
      });
      approverId = manager?.reportingManagerId ?? null;
    }
    return approverId;
  }

  /**
   * Throws unless `currentUser` may approve/reject a bid created by
   * `createdById`. Self-approval blocked; Admin overrides; otherwise the
   * caller must be the resolved approver.
   */
  async assertCanActOnBid(
    createdById: string,
    currentUser: AuthenticatedUser,
  ): Promise<void> {
    if (createdById === currentUser.id) {
      throw new ForbiddenException('Cannot approve or reject your own bid');
    }
    if (isAdmin(currentUser)) {
      return;
    }
    const approverId = await this.resolveApprover(createdById);
    if (approverId !== currentUser.id) {
      throw new ForbiddenException(
        'Only the bid creator’s manager (or an Admin) may act on this bid',
      );
    }
  }
}
