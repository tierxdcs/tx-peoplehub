/**
 * The complete set of events that send a push notification, and the exact
 * content each one shows.
 *
 * **Adding an event means editing this file**, which is why the copy lives here
 * rather than being inlined at each call site — the list of things that can reach
 * someone's lock screen should be readable in one place. The list is closed, and
 * short on purpose: a channel that buzzes a phone is held to a higher bar than an
 * in-app badge, so it carries only things a person is expected to *act* on.
 *
 * What pushes:
 *  1. A Ping you received.
 *  2. A Kanban card assigned to you.
 *  3. A comment on a Kanban card YOU created.
 *  4. An approval waiting on you — the seven gates in `ApprovalPushKind`.
 *  5. A vendor submitted (or revised) a quote on your RFQ.
 *  6. A vendor has gone quiet past your PLM tracker's agreed update cadence.
 *  7. A design review on your project was recorded REJECTED.
 *  8. An order of yours cleared final QC, or a challan for it was dispatched.
 *
 * What deliberately does NOT push, and must not be added here casually: Kanban
 * card edits and moves, comments on a card you merely watch or are assigned (only
 * the creator is pushed — see `cardCommentedPush`), PLM stage advances short of
 * dispatch, vendor production updates that arrive on time, questionnaire
 * submissions, GRN/inventory movement, Vault uploads, efficiency-score and
 * analytics changes. Those stay in-app.
 *
 * Pure functions: no Prisma, no DI, no clock. Each returns a PushNotification for
 * PushNotificationService to deliver.
 */
import { clampText, type PushNotification } from '../../core/push/push-payload';

/**
 * A phone shows roughly two lines of body text before truncating, and a lock
 * screen less than that. Clamping here (rather than relying on the payload
 * builder's 400-char limit) keeps a long ping from becoming a wall of text on the
 * notification shade — a preview is meant to be read at a glance.
 */
export const PUSH_PREVIEW_LENGTH = 140;

/** Where a Ping notification opens: the recipient's own Pings list. */
export const PINGS_URL = '/my-pings';

/**
 * A Ping arrived. The sender's name is the whole point of the title — "You have a
 * new ping" tells the recipient nothing they can act on.
 *
 * `tag` is keyed to the ping so a repeat about the same one replaces rather than
 * stacks; two different pings still arrive as two notifications.
 */
export function pingReceivedPush(params: {
  pingId: string;
  senderName: string;
  message: string;
}): PushNotification {
  return {
    title: `${params.senderName} pinged you`,
    body: clampText(params.message, PUSH_PREVIEW_LENGTH),
    url: PINGS_URL,
    tag: `ping:${params.pingId}`,
    data: { kind: 'ping', pingId: params.pingId },
  };
}

/**
 * A Kanban card was assigned (or reassigned) to someone.
 *
 * The url is the existing deep-link resolver route, not a board url: /kanban/
 * cards/:id already decides where the tap should land — the board with the card's
 * modal open for a board member, a standalone card view for someone who is only
 * the assignee. Reusing it means the notification cannot send a non-member to a
 * board they have no access to.
 *
 * `tag` is keyed to the card: being assigned, unassigned and reassigned the same
 * card should leave one current notification, not three.
 */
export function cardAssignedPush(params: {
  cardId: string;
  cardTitle: string;
  assignerName: string;
}): PushNotification {
  return {
    title: `${params.assignerName} assigned you a task`,
    body: clampText(params.cardTitle, PUSH_PREVIEW_LENGTH),
    url: `/kanban/cards/${params.cardId}`,
    tag: `card:${params.cardId}`,
    data: { kind: 'card-assigned', cardId: params.cardId },
  };
}

/**
 * Someone commented on a card its recipient CREATED.
 *
 * The creator, and only the creator. A card's assignee already gets the in-app
 * CARD_COMMENTED notification and is deliberately not pushed: they are working
 * the card and will see the thread anyway, whereas the person who raised it has
 * no other reason to look. This is the narrowest form of "comments push" and the
 * distinction is the whole reason it is allowed at all.
 *
 * Body carries the card title *and* a preview of the comment: the title alone
 * ("New comment on Draft the vendor audit") makes the creator open the app to
 * find out whether it needs them, which is exactly what a push should save them.
 *
 * `tag` is keyed to the CARD, not the comment — unlike a Ping, where each message
 * is its own event. A back-and-forth on one card is one thing to go and read, so
 * the fifth comment replaces the fourth rather than buzzing five times.
 */
export function cardCommentedPush(params: {
  cardId: string;
  cardTitle: string;
  commenterName: string;
  comment: string;
}): PushNotification {
  return {
    title: `${params.commenterName} commented on your card`,
    body: clampText(
      `${params.cardTitle} — ${params.comment}`,
      PUSH_PREVIEW_LENGTH,
    ),
    url: `/kanban/cards/${params.cardId}`,
    tag: `card-comment:${params.cardId}`,
    data: { kind: 'card-commented', cardId: params.cardId },
  };
}

/**
 * The approval gates that push. One entry per gate — the union is what stops
 * "just one more approval push" from being added without a decision.
 *
 * Each is a gate where work stops until a *named* person acts, which is what
 * earns a phone buzz. A gate that merely ages (a badge going amber) does not.
 */
export type ApprovalPushKind =
  | 'offer-letter'
  | 'candidate-requisition'
  | 'bom-release'
  | 'rfq-pm-approval'
  | 'ad-hoc-po'
  | 'design-change'
  | 'expense-claim';

/**
 * How each gate names itself on a lock screen. Deliberately the words the
 * approver's own screen uses, not the internal model name — "Engineering change
 * request", not "DesignChange".
 */
const APPROVAL_LABEL: Record<ApprovalPushKind, string> = {
  'offer-letter': 'Offer letter',
  'candidate-requisition': 'Candidate requisition',
  'bom-release': 'BOM release',
  'rfq-pm-approval': 'RFQ',
  'ad-hoc-po': 'Ad-hoc purchase order',
  'design-change': 'Engineering change request',
  'expense-claim': 'Expense claim',
};

/**
 * Something is waiting on this person's decision.
 *
 * One builder for all seven gates rather than seven near-identical ones: the
 * shape of the message is genuinely the same ("X needs your approval — which one,
 * and from whom"), and a single builder means a new gate cannot quietly invent its
 * own phrasing. What differs per gate is only the label and the deep link, and
 * both are inputs.
 *
 * `requestedBy` is what makes this actionable rather than a chore reminder — an
 * approver triages by who asked. It is optional because two gates have no single
 * human requester (an RFQ raised by SCM process, a system-generated PO).
 *
 * `tag` is keyed to the record, so a resubmission after a rejection replaces the
 * earlier notification instead of stacking a second one about the same document.
 */
export function approvalRequiredPush(params: {
  kind: ApprovalPushKind;
  /** The record as its own screen names it: "REQ-2026-0007 — Design Engineer". */
  reference: string;
  requestedBy?: string | null;
  recordId: string;
  /** Deep link to this record, resolved by the caller (routes differ per gate). */
  url: string;
}): PushNotification {
  const requester = params.requestedBy?.trim();
  return {
    title: `${APPROVAL_LABEL[params.kind]} needs your approval`,
    body: clampText(
      requester ? `${params.reference} — from ${requester}` : params.reference,
      PUSH_PREVIEW_LENGTH,
    ),
    url: params.url,
    tag: `approval:${params.kind}:${params.recordId}`,
    data: {
      kind: 'approval-required',
      approval: params.kind,
      recordId: params.recordId,
    },
  };
}

/**
 * A vendor priced our RFQ. Goes to the RFQ's creator, who is the person running
 * the comparison.
 *
 * A revision is called out explicitly: after an RFQ closes, a negotiated revision
 * is a *different* event to the owner — it means the number they were comparing
 * against has just changed.
 *
 * `tag` is keyed to the invitee, not the RFQ: three vendors quoting the same RFQ
 * are three things to look at, and collapsing them would hide two. A vendor's
 * revision does replace their own earlier submission notification.
 */
export function rfqQuoteSubmittedPush(params: {
  rfqId: string;
  rfqNumber: string;
  inviteeId: string;
  vendorName: string;
  isRevision: boolean;
}): PushNotification {
  return {
    title: params.isRevision
      ? `${params.vendorName} revised their quote`
      : `${params.vendorName} submitted a quote`,
    body: clampText(params.rfqNumber, PUSH_PREVIEW_LENGTH),
    url: `/scm/rfqs/${params.rfqId}`,
    tag: `rfq-quote:${params.inviteeId}`,
    data: { kind: 'rfq-quote-submitted', rfqId: params.rfqId },
  };
}

/**
 * A vendor has missed the production-update cadence agreed at kickoff — the RED
 * state the PLM dashboard already colours, delivered to the tracker owner instead
 * of waiting to be noticed.
 *
 * The body names the vendor and what they are building, because an owner tracking
 * a dozen lines cannot act on "a vendor is late".
 *
 * `tag` is keyed to the tracker: this is swept daily while the breach lasts, and
 * the owner should end up with one standing notification per silent vendor, not a
 * new one every morning.
 */
export function plmVendorCadenceBreachPush(params: {
  trackerId: string;
  vendorName: string;
  orderNumber: string;
  productName: string;
  cadenceDays: number;
}): PushNotification {
  const every =
    params.cadenceDays === 1 ? 'daily' : `every ${params.cadenceDays} days`;
  return {
    title: `Vendor update overdue — ${params.vendorName}`,
    body: clampText(
      `${params.orderNumber} — ${params.productName}. Updates are due ${every}.`,
      PUSH_PREVIEW_LENGTH,
    ),
    url: `/plm/trackers/${params.trackerId}`,
    tag: `plm-cadence:${params.trackerId}`,
    data: { kind: 'plm-cadence-breach', trackerId: params.trackerId },
  };
}

/**
 * A design review was recorded REJECTED — the lead designer has rework to plan.
 *
 * Only REJECTED pushes. APPROVED and APPROVED_WITH_CONDITIONS are also outcomes,
 * and neither stops anyone: the first is good news, the second is carried by the
 * review's action items. Rejection is the one that invalidates the plan.
 */
export function designReviewRejectedPush(params: {
  reviewId: string;
  projectId: string;
  projectName: string;
  reviewLabel: string;
}): PushNotification {
  return {
    title: 'Design review rejected',
    body: clampText(
      `${params.projectName} — ${params.reviewLabel}`,
      PUSH_PREVIEW_LENGTH,
    ),
    url: `/design/projects?focus=${encodeURIComponent(params.projectId)}`,
    tag: `design-review:${params.reviewId}`,
    data: { kind: 'design-review-rejected', reviewId: params.reviewId },
  };
}

/**
 * How a set of product names reads in a one-line body: the name itself when
 * there is exactly one, a count when there are several, null when we know none.
 *
 * A dispatch notification is about an order, and an order can carry ten lines.
 * "Platform Emergency Kiosk" is worth the space; "Platform Emergency Kiosk,
 * Mounting Bracket, Cable Harness, …" is not — the owner opens the record for
 * that. Duplicate names collapse, so three lines of the same product read as the
 * product, not "3 products".
 */
export function describeProducts(
  names: (string | null | undefined)[],
): string | null {
  const unique = [...new Set(names.map((n) => n?.trim()).filter(Boolean))];
  if (unique.length === 0) return null;
  if (unique.length === 1) return unique[0]!;
  return `${unique.length} products`;
}

/**
 * Final QC cleared, so the order can now be dispatched. Goes to the order's
 * owner, who is the one who has been promising the customer a date.
 *
 * This is the only PLM/order progress step that pushes. It is the point where
 * something becomes *possible* — a challan can now be raised — rather than one
 * more stage advancing on its own.
 */
export function orderReadyToDispatchPush(params: {
  orderId: string;
  orderNumber: string;
  customerName: string | null;
  /**
   * What is being shipped — a product name, or "3 products" for a multi-line
   * order. Final QC is cleared for the whole order at once, so a single product
   * name only exists when the order has a single line; `describeProducts` decides.
   */
  productSummary: string | null;
}): PushNotification {
  const what = params.productSummary ?? 'The order';
  return {
    title: `Ready to dispatch — ${params.orderNumber}`,
    body: clampText(
      params.customerName
        ? `${what} for ${params.customerName}. Final QC cleared.`
        : `${what}. Final QC cleared.`,
      PUSH_PREVIEW_LENGTH,
    ),
    url: `/sales/orders/${params.orderId}`,
    tag: `order-dispatch-ready:${params.orderId}`,
    data: { kind: 'order-ready-to-dispatch', orderId: params.orderId },
  };
}

/**
 * A delivery challan went out. Opens the challan rather than the order: the thing
 * the owner will want is the document that just became real — its lines, its
 * vehicle, its e-way bill.
 *
 * `tag` is keyed to the challan, so a part-shipped order that goes out in three
 * challans produces three notifications. That is correct: they are three events.
 */
export function orderDispatchedPush(params: {
  challanId: string;
  dcNumber: string;
  orderNumber: string;
  /** What went out: a product name, or "3 products" — see `describeProducts`. */
  productSummary: string | null;
}): PushNotification {
  return {
    title: `Dispatched — ${params.orderNumber}`,
    body: clampText(
      params.productSummary
        ? `${params.dcNumber} · ${params.productSummary}`
        : params.dcNumber,
      PUSH_PREVIEW_LENGTH,
    ),
    url: `/logistics/dispatch/${params.challanId}`,
    tag: `order-dispatched:${params.challanId}`,
    data: { kind: 'order-dispatched', challanId: params.challanId },
  };
}
