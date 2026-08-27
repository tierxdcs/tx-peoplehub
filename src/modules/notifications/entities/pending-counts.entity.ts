import { ApiProperty } from '@nestjs/swagger';
import type { PendingQueue } from '../../../common/types/pending-queue';

/**
 * One pending-approval queue: how many items are waiting and when the oldest
 * started waiting. The frontend colours the badge from `oldestPendingAt` on the
 * app-wide urgency scale (web/app/lib/urgency.ts), so a queue's badge reflects
 * how long it has been stuck rather than just how big it is.
 */
export class PendingQueueEntity {
  @ApiProperty({ description: 'Items awaiting the caller in this queue' })
  count!: number;

  @ApiProperty({
    nullable: true,
    description:
      'When the oldest still-pending item started waiting (its submitted-at, or created-at where the row is created already-pending). null when the queue is empty, or when the oldest item carries no waiting-since stamp — the UI then treats it as not-yet-aging rather than inventing urgency.',
  })
  oldestPendingAt!: string | null;

  constructor(queue: PendingQueue) {
    this.count = queue.count;
    this.oldestPendingAt = queue.oldestPendingAt
      ? queue.oldestPendingAt.toISOString()
      : null;
  }
}

/**
 * Pending-approval queues across every approval surface in the app. Every key
 * is always present — a queue that doesn't apply to the caller's role reports
 * count 0 (never omitted), so the frontend can treat the shape uniformly. The
 * key set is mirrored by ApprovalQueueKey in web/app/lib/approval-queues.ts,
 * which owns the href + label each queue badges against.
 */
export class PendingCountsEntity {
  @ApiProperty({
    type: PendingQueueEntity,
    description: "Leave requests awaiting the caller's approval",
  })
  leaveApprovals!: PendingQueueEntity;

  @ApiProperty({
    type: PendingQueueEntity,
    description: 'Bids (>10% discount) awaiting the caller',
  })
  bidDiscountApprovals!: PendingQueueEntity;

  @ApiProperty({
    type: PendingQueueEntity,
    description: 'Bid/No-Bid assessments awaiting review',
  })
  bidAssessmentApprovals!: PendingQueueEntity;

  @ApiProperty({
    type: PendingQueueEntity,
    description: 'Employees awaiting an access grant',
  })
  hrPendingAccess!: PendingQueueEntity;

  @ApiProperty({
    type: PendingQueueEntity,
    description: 'Confirmation sheets awaiting internal countersignature',
  })
  confirmationSheetsPending!: PendingQueueEntity;

  @ApiProperty({
    type: PendingQueueEntity,
    description: "Offer letters awaiting the caller's vertical-owner approval",
  })
  offerLetterApprovals!: PendingQueueEntity;

  @ApiProperty({
    type: PendingQueueEntity,
    description:
      "Onboarding provisioning requests awaiting the caller's approval",
  })
  provisioningApprovals!: PendingQueueEntity;

  @ApiProperty({
    type: PendingQueueEntity,
    description: "Candidate requisitions awaiting the caller's approval",
  })
  candidateRequisitionApprovals!: PendingQueueEntity;

  @ApiProperty({
    type: PendingQueueEntity,
    description: 'BOMs awaiting R&D Head release approval',
  })
  bomReleaseApprovals!: PendingQueueEntity;

  @ApiProperty({
    type: PendingQueueEntity,
    description: 'Expense claims awaiting approval or payout',
  })
  expenseClaimApprovals!: PendingQueueEntity;

  @ApiProperty({
    type: PendingQueueEntity,
    description: 'Ad-hoc purchase orders awaiting CEO approval',
  })
  adHocPoApprovals!: PendingQueueEntity;

  @ApiProperty({
    type: PendingQueueEntity,
    description: 'Engineering changes (ECRs) awaiting Design Head approval',
  })
  designChangeApprovals!: PendingQueueEntity;

  constructor(queues: Record<keyof PendingCountsEntity, PendingQueue>) {
    for (const [key, queue] of Object.entries(queues)) {
      (this as unknown as Record<string, PendingQueueEntity>)[key] =
        new PendingQueueEntity(queue);
    }
  }
}
