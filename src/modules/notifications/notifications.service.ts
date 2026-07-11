import { Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { LeaveRequestsService } from '../leave/leave-requests.service';
import { EmployeesService } from '../employees/employees.service';
import { BidsService } from '../sales/bids.service';
import { BidAssessmentsService } from '../sales/bid-assessments.service';
import { ConfirmationSheetsService } from '../sales/confirmation-sheets.service';
import { PendingCountsEntity } from './entities/pending-counts.entity';

/**
 * Cross-cutting pending-approval counters. Every count delegates to the SAME
 * scoped query that backs its category's list endpoint (a count() reusing the
 * identical where-clause), so a count can never disagree with the list it
 * summarizes. Each per-category method already returns 0 for a caller the
 * category doesn't apply to, so the aggregate is role-safe by construction.
 */
@Injectable()
export class NotificationsService {
  constructor(
    private readonly leaveRequests: LeaveRequestsService,
    private readonly employees: EmployeesService,
    private readonly bids: BidsService,
    private readonly bidAssessments: BidAssessmentsService,
    private readonly confirmationSheets: ConfirmationSheetsService,
  ) {}

  async getPendingCounts(
    user: AuthenticatedUser,
  ): Promise<PendingCountsEntity> {
    const isAdmin =
      user.role === Role.ADMIN || user.role === Role.SUPER_ADMIN;

    const [
      leaveApprovals,
      bidDiscountApprovals,
      bidAssessmentApprovals,
      confirmationSheetsPending,
    ] = await Promise.all([
      this.leaveRequests.countPendingApproval(user),
      this.bids.countPendingApproval(user),
      this.bidAssessments.countPendingForReviewer(user),
      this.confirmationSheets.countPendingForReviewer(user),
    ]);

    // HR pending-access is a company-wide, ADMIN-only surface — the count
    // query itself has no per-user scope, so gate by role here (0 otherwise).
    const hrPendingAccess = isAdmin
      ? await this.employees.countPendingAccess()
      : 0;

    return new PendingCountsEntity({
      leaveApprovals,
      bidDiscountApprovals,
      bidAssessmentApprovals,
      hrPendingAccess,
      confirmationSheetsPending,
    });
  }
}
