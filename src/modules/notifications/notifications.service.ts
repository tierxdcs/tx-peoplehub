import { Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { EMPTY_PENDING_QUEUE } from '../../common/types/pending-queue';
import { LeaveRequestsService } from '../leave/leave-requests.service';
import { EmployeesService } from '../employees/employees.service';
import { BidsService } from '../sales/bids.service';
import { BidAssessmentsService } from '../sales/bid-assessments.service';
import { ConfirmationSheetsService } from '../sales/confirmation-sheets.service';
import { OfferLettersService } from '../offer-letters/offer-letters.service';
import { ProvisioningService } from '../provisioning/provisioning.service';
import { CandidateRequisitionsService } from '../candidate-requisitions/candidate-requisitions.service';
import { BomService } from '../bom/bom.service';
import { ExpenseClaimsService } from '../expense-claims/expense-claims.service';
import { PurchaseOrderService } from '../scm-purchasing/purchase-order.service';
import { DesignService } from '../design/design.service';
import { PendingCountsEntity } from './entities/pending-counts.entity';

/**
 * Cross-cutting pending-approval queues. Every queue delegates to the SAME
 * scoped query that backs its category's list endpoint (a count() + "oldest
 * first" findFirst reusing the identical where-clause), so a badge can never
 * disagree with the list it summarizes. Each per-category method already
 * returns an empty queue for a caller the category doesn't apply to, so the
 * aggregate is role-safe by construction.
 *
 * The `oldestPendingAt` stamp is what lets the UI colour a badge by how long
 * the queue's oldest item has actually waited (web/app/lib/urgency.ts).
 */
@Injectable()
export class NotificationsService {
  constructor(
    private readonly leaveRequests: LeaveRequestsService,
    private readonly employees: EmployeesService,
    private readonly bids: BidsService,
    private readonly bidAssessments: BidAssessmentsService,
    private readonly confirmationSheets: ConfirmationSheetsService,
    private readonly offerLetters: OfferLettersService,
    private readonly provisioning: ProvisioningService,
    private readonly candidateRequisitions: CandidateRequisitionsService,
    // BomModule imports NotificationsModule, so NotificationsModule resolves
    // BomModule through forwardRef — see notifications.module.ts.
    private readonly bom: BomService,
    private readonly expenseClaims: ExpenseClaimsService,
    private readonly purchaseOrders: PurchaseOrderService,
    private readonly design: DesignService,
  ) {}

  async getPendingCounts(
    user: AuthenticatedUser,
  ): Promise<PendingCountsEntity> {
    const isAdmin = user.role === Role.ADMIN || user.role === Role.SUPER_ADMIN;

    const [
      leaveApprovals,
      bidDiscountApprovals,
      bidAssessmentApprovals,
      confirmationSheetsPending,
      offerLetterApprovals,
      provisioningApprovals,
      candidateRequisitionApprovals,
      bomReleaseApprovals,
      expenseClaimApprovals,
      adHocPoApprovals,
      designChangeApprovals,
      // HR pending-access is a company-wide, ADMIN-only surface — the query
      // itself has no per-user scope, so gate by role here (empty otherwise).
      hrPendingAccess,
    ] = await Promise.all([
      this.leaveRequests.pendingApprovalQueue(user),
      this.bids.pendingApprovalQueue(user),
      this.bidAssessments.pendingReviewQueue(user),
      this.confirmationSheets.pendingReviewQueue(user),
      this.offerLetters.pendingApprovalQueue(user),
      this.provisioning.pendingApprovalQueue(user),
      this.candidateRequisitions.pendingApprovalQueue(user),
      this.bom.pendingReleaseQueue(user),
      this.expenseClaims.pendingReviewQueue(user),
      this.purchaseOrders.pendingApprovalQueue(user),
      this.design.pendingChangeApprovalQueue(user),
      isAdmin
        ? this.employees.pendingAccessQueue()
        : Promise.resolve(EMPTY_PENDING_QUEUE),
    ]);

    return new PendingCountsEntity({
      leaveApprovals,
      bidDiscountApprovals,
      bidAssessmentApprovals,
      hrPendingAccess,
      confirmationSheetsPending,
      offerLetterApprovals,
      provisioningApprovals,
      candidateRequisitionApprovals,
      bomReleaseApprovals,
      expenseClaimApprovals,
      adHocPoApprovals,
      designChangeApprovals,
    });
  }
}
