import { Injectable, Logger } from '@nestjs/common';
import { DesignReviewType, EmployeeStatus, Role } from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { PushNotificationService } from '../../core/push/push.service';
import {
  approvalRequiredPush,
  describeProducts,
  designReviewRejectedPush,
  orderDispatchedPush,
  orderReadyToDispatchPush,
  plmVendorCadenceBreachPush,
  rfqQuoteSubmittedPush,
  type ApprovalPushKind,
} from './push-triggers';

/**
 * The approver pools a gate can address, by the authority that gates it rather
 * than by role name. Each mirrors exactly one existing permission check, and the
 * mapping to a query lives in `poolWhere` below — so "who can approve this" is
 * stated once for push and cannot drift from the gate that enforces it.
 */
export type PushApproverPool =
  | 'SUPER_ADMIN'
  | 'RD_HEAD'
  | 'DESIGN_HEAD'
  | 'ACCOUNTS_HEAD_OR_SUPER_ADMIN'
  | 'PROJECT_MANAGER_OR_SUPER_ADMIN';

/**
 * Who to reach. Either a pool this service resolves, or an explicit set — the
 * latter for gates whose recipient is a specific person derived from the record
 * (an offer letter's vertical owner, a BOM's R&D Head list already loaded by the
 * caller). Explicit ids keep a bespoke routing rule in the module that owns it,
 * instead of half-copying it here where it would rot.
 */
export type PushAudience =
  { pool: PushApproverPool } | { employeeIds: (string | null | undefined)[] };

/** How a design review type reads to the lead designer whose plan just changed. */
const DESIGN_REVIEW_LABEL: Record<DesignReviewType, string> = {
  REQUIREMENTS_REVIEW: 'Requirements review',
  CONCEPT_REVIEW: 'Concept review',
  PRELIMINARY_DESIGN_REVIEW: 'Preliminary design review',
  CRITICAL_DESIGN_REVIEW: 'Critical design review',
  MANUFACTURING_READINESS_REVIEW: 'Manufacturing readiness review',
  CHANGE_REVIEW: 'Change review',
  FINAL_DESIGN_REVIEW: 'Final design review',
};

/**
 * Fires the push notifications for events that are NOT Kanban — approvals, RFQ
 * quotes, PLM cadence breaches, design-review rejections and dispatch.
 *
 * Why this exists as one service rather than a `push.trySendToEmployee()` call in
 * each of the nine modules that trigger these events:
 *
 *  - **Recipient resolution is the hard part, and it is shared.** "Every active
 *    SuperAdmin", "every Design Head except the requester" is the same query in
 *    four places. Written once, it cannot disagree with itself.
 *  - **The never-notify-your-own-action rule is enforced in one place**, the same
 *    way KanbanNotificationsService enforces it for in-app notifications.
 *  - **Every method is unconditionally best-effort.** Not one of these events may
 *    fail, delay or roll back the business action that produced it, so nothing
 *    escapes these methods — not a push failure, not an unconfigured VAPID
 *    keypair, not a lookup for a row that has since been deleted. Callers `void`
 *    the promise; it never rejects.
 *
 * It holds NO decision about *whether* something is push-worthy — that list is
 * `push-triggers.ts`, which also owns every word of copy. This service only
 * answers "who" and delivers.
 */
@Injectable()
export class PushEventsService {
  private readonly logger = new Logger(PushEventsService.name);

  constructor(
    private readonly prisma: PrismaService,
    // Both modules are @Global, so nothing has to import anything to use this.
    private readonly push: PushNotificationService,
  ) {}

  // ── Approvals ────────────────────────────────────────────────────────

  /**
   * Something has reached a state that needs a named person's decision.
   *
   * Call this AFTER the state change has committed. A push about an approval that
   * then failed to save is worse than no push: the approver opens a record that
   * isn't waiting on them.
   */
  async approvalRequired(params: {
    kind: ApprovalPushKind;
    audience: PushAudience;
    /** The record as its own screen names it: "REQ-2026-0007 — Design Engineer". */
    reference: string;
    /**
     * Who asked. Give an employee id and the name is looked up here — no caller
     * needs to widen a query or hand-assemble "first last" just to say who is
     * waiting. `requestedBy` is the escape hatch for a name already in hand.
     */
    requestedById?: string | null;
    requestedBy?: string | null;
    recordId: string;
    url: string;
    /** The person who caused this. Never notified about their own action. */
    actorId?: string | null;
  }): Promise<void> {
    await this.dispatch(`approval:${params.kind}`, async () => {
      const recipients = await this.resolve(params.audience, params.actorId);
      // Resolve the name only once we know someone is actually being notified.
      if (recipients.length === 0) return;
      const requestedBy =
        params.requestedBy ?? (await this.employeeName(params.requestedById));
      await this.push.trySendToEmployees(
        recipients,
        approvalRequiredPush({
          kind: params.kind,
          reference: params.reference,
          requestedBy,
          recordId: params.recordId,
          url: params.url,
        }),
        `${params.kind} approval required`,
      );
    });
  }

  // ── RFQ quote submitted ──────────────────────────────────────────────

  /**
   * A vendor or supplier priced an RFQ. Notifies the RFQ's creator — the person
   * running the comparison, and the only one who can act on a new number.
   *
   * Takes the invitee id and looks the rest up itself, so the public (token-auth)
   * submit path stays a one-line call: it has no employee context at all, which is
   * exactly why this must not be its problem.
   */
  async rfqQuoteSubmitted(params: {
    inviteeId: string;
    isRevision: boolean;
  }): Promise<void> {
    await this.dispatch('rfq-quote-submitted', async () => {
      const invitee = await this.prisma.rfqInvitee.findUnique({
        where: { id: params.inviteeId },
        select: {
          id: true,
          vendor: { select: { companyName: true } },
          supplier: { select: { companyName: true } },
          rfq: { select: { id: true, rfqNumber: true, createdById: true } },
        },
      });
      if (!invitee) return;
      // Exactly one of vendor/supplier is set (CHECK constraint), so this reads
      // as "whichever partner this invitee is" rather than a vendor bias.
      const vendorName =
        invitee.vendor?.companyName ??
        invitee.supplier?.companyName ??
        'A vendor';
      await this.push.trySendToEmployee(
        invitee.rfq.createdById,
        rfqQuoteSubmittedPush({
          rfqId: invitee.rfq.id,
          rfqNumber: invitee.rfq.rfqNumber,
          inviteeId: invitee.id,
          vendorName,
          isRevision: params.isRevision,
        }),
        'rfq quote submitted',
      );
    });
  }

  // ── PLM vendor cadence breach ────────────────────────────────────────

  /**
   * A vendor has gone past the update cadence agreed at kickoff. Notifies the
   * tracker's owner.
   *
   * Everything is passed in rather than looked up: the caller is the daily sweep,
   * which has already loaded and evaluated the tracker. Re-querying here would
   * mean the push could describe a different tracker state than the one that was
   * judged to be in breach.
   */
  async plmVendorCadenceBreach(params: {
    trackerId: string;
    ownerId: string;
    vendorName: string;
    orderNumber: string;
    productName: string;
    cadenceDays: number;
  }): Promise<void> {
    await this.dispatch('plm-cadence-breach', async () => {
      await this.push.trySendToEmployee(
        params.ownerId,
        plmVendorCadenceBreachPush(params),
        'plm vendor cadence breach',
      );
    });
  }

  // ── Design review rejected ───────────────────────────────────────────

  /**
   * A review's outcome was recorded REJECTED. Notifies the project's lead
   * designer, who owns the rework.
   *
   * The caller passes only the review id — the project, its lead designer and the
   * review type all hang off it, and looking them up here keeps `recordReview`
   * from growing an include it has no other use for.
   */
  async designReviewRejected(params: {
    reviewId: string;
    actorId?: string | null;
  }): Promise<void> {
    await this.dispatch('design-review-rejected', async () => {
      const review = await this.prisma.designReview.findUnique({
        where: { id: params.reviewId },
        select: {
          id: true,
          reviewType: true,
          project: { select: { id: true, name: true, leadDesignerId: true } },
        },
      });
      if (!review) return;
      const recipients = await this.resolve(
        { employeeIds: [review.project.leadDesignerId] },
        params.actorId,
      );
      if (recipients.length === 0) return;
      await this.push.trySendToEmployees(
        recipients,
        designReviewRejectedPush({
          reviewId: review.id,
          projectId: review.project.id,
          projectName: review.project.name,
          reviewLabel: DESIGN_REVIEW_LABEL[review.reviewType],
        }),
        'design review rejected',
      );
    });
  }

  // ── Dispatch ─────────────────────────────────────────────────────────

  /**
   * Final QC cleared — the order can now be shipped. Notifies the order's owner.
   *
   * Not fired when the clearance was already recorded: `clearFinalQc` is
   * idempotent and returns the current state for a stale client, and a retry is
   * not a second event.
   */
  async orderReadyToDispatch(params: {
    orderId: string;
    actorId?: string | null;
  }): Promise<void> {
    await this.dispatch('order-ready-to-dispatch', async () => {
      const order = await this.prisma.order.findUnique({
        where: { id: params.orderId },
        select: {
          id: true,
          orderNumber: true,
          ownerId: true,
          customer: { select: { name: true } },
          // Customer-facing override first, matching how every order-derived
          // screen in the app labels a line.
          lineItems: {
            select: {
              customerFacingProductName: true,
              adHocProductName: true,
              product: { select: { name: true } },
            },
          },
        },
      });
      if (!order) return;
      const recipients = await this.resolve(
        { employeeIds: [order.ownerId] },
        params.actorId,
      );
      if (recipients.length === 0) return;
      await this.push.trySendToEmployees(
        recipients,
        orderReadyToDispatchPush({
          orderId: order.id,
          orderNumber: order.orderNumber,
          customerName: order.customer?.name ?? null,
          productSummary: describeProducts(
            order.lineItems.map(
              (line) =>
                line.customerFacingProductName ??
                line.product?.name ??
                line.adHocProductName,
            ),
          ),
        }),
        'order ready to dispatch',
      );
    });
  }

  /** A delivery challan was dispatched. Notifies the order's owner. */
  async orderDispatched(params: {
    challanId: string;
    actorId?: string | null;
  }): Promise<void> {
    await this.dispatch('order-dispatched', async () => {
      const dc = await this.prisma.deliveryChallan.findUnique({
        where: { id: params.challanId },
        select: {
          id: true,
          dcNumber: true,
          order: { select: { orderNumber: true, ownerId: true } },
          // The challan's OWN lines, not the order's: a part shipment describes
          // what actually left, which is the point of the notification.
          lines: {
            select: {
              description: true,
              orderLine: {
                select: {
                  customerFacingProductName: true,
                  adHocProductName: true,
                  product: { select: { name: true } },
                },
              },
            },
          },
        },
      });
      if (!dc) return;
      const recipients = await this.resolve(
        { employeeIds: [dc.order.ownerId] },
        params.actorId,
      );
      if (recipients.length === 0) return;
      await this.push.trySendToEmployees(
        recipients,
        orderDispatchedPush({
          challanId: dc.id,
          dcNumber: dc.dcNumber,
          orderNumber: dc.order.orderNumber,
          productSummary: describeProducts(
            dc.lines.map(
              (line) =>
                line.orderLine.customerFacingProductName ??
                line.orderLine.product?.name ??
                line.orderLine.adHocProductName ??
                line.description,
            ),
          ),
        }),
        'order dispatched',
      );
    });
  }

  // ── internals ────────────────────────────────────────────────────────

  /**
   * The single outer guard that makes every public method above safe to `void`.
   *
   * `trySendToEmployee` already swallows delivery failures, but not the lookups
   * around it: a deleted row, a Prisma connection blip or a bad include would
   * otherwise surface as an unhandled rejection and, worse, could take down the
   * request that triggered it. Nothing in this file is important enough to do
   * that, so nothing gets to.
   */
  private async dispatch(
    context: string,
    work: () => Promise<void>,
  ): Promise<void> {
    try {
      await work();
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Push event "${context}" skipped: ${detail}`);
    }
  }

  /**
   * Turn an audience into a de-duplicated list of employee ids, dropping the
   * actor.
   *
   * Nobody is told about their own action — the same rule
   * KanbanNotificationsService enforces for in-app notifications, and it matters
   * more here: several of these gates can legitimately be self-approved (a
   * SuperAdmin raising an ad-hoc PO, a Project Manager creating an RFQ), and
   * buzzing someone's phone about the button they just pressed reads as a bug.
   */
  private async resolve(
    audience: PushAudience,
    actorId?: string | null,
  ): Promise<string[]> {
    const ids =
      'pool' in audience
        ? await this.poolIds(audience.pool)
        : audience.employeeIds;
    return [
      ...new Set(
        ids.filter((id): id is string => !!id && id !== (actorId ?? null)),
      ),
    ];
  }

  /**
   * "First Last" for a push body, or null when there is nobody to name — a
   * requester id that no longer resolves, or none given. Null is a normal answer,
   * not a failure: `approvalRequiredPush` drops the "from …" clause and the
   * notification still says what is waiting.
   */
  private async employeeName(id?: string | null): Promise<string | null> {
    if (!id) return null;
    const employee = await this.prisma.employee.findUnique({
      where: { id },
      select: { firstName: true, lastName: true },
    });
    if (!employee) return null;
    return `${employee.firstName} ${employee.lastName}`.trim() || null;
  }

  /**
   * Active holders of an approval authority. INACTIVE employees are excluded:
   * they cannot log in to act, and a departed Accounts Head's stale devices would
   * absorb notifications nobody reads.
   */
  private async poolIds(pool: PushApproverPool): Promise<string[]> {
    const rows = await this.prisma.employee.findMany({
      where: {
        status: EmployeeStatus.ACTIVE,
        ...PushEventsService.poolWhere(pool),
      },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  /**
   * Each pool as a where-clause, mirroring the gate that enforces it:
   * `PurchaseOrderService.assertCeo` (SUPER_ADMIN), `BomService` release
   * (isRdHead), `DesignAccessService.assertHead` (isDesignHead),
   * `ExpenseClaimsService.isApprover` (isAccountsHead OR SUPER_ADMIN) and
   * `RfqAccessService.assertCanApprove` (isProjectManager OR SUPER_ADMIN).
   */
  private static poolWhere(pool: PushApproverPool) {
    switch (pool) {
      case 'SUPER_ADMIN':
        return { role: Role.SUPER_ADMIN };
      case 'RD_HEAD':
        return { isRdHead: true };
      case 'DESIGN_HEAD':
        return { isDesignHead: true };
      case 'ACCOUNTS_HEAD_OR_SUPER_ADMIN':
        return {
          OR: [{ isAccountsHead: true }, { role: Role.SUPER_ADMIN }],
        };
      case 'PROJECT_MANAGER_OR_SUPER_ADMIN':
        return {
          OR: [{ isProjectManager: true }, { role: Role.SUPER_ADMIN }],
        };
    }
  }
}
