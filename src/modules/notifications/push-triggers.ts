/**
 * The complete set of events that send a push notification, and the exact
 * content each one shows.
 *
 * There are two, deliberately: a Ping you received, and a Kanban card assigned
 * to you. Nothing else pushes — not comments, not status changes, not approvals,
 * not escalations or staleness reminders. That restraint is the point: Pings was
 * built around not over-notifying, and a channel that buzzes a phone has to be
 * held to a higher bar than an in-app badge. **Adding a third event means editing
 * this file**, which is why the copy lives here rather than being inlined at each
 * call site — the list of things that can reach someone's lock screen should be
 * readable in one place.
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
