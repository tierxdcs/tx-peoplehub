import { Injectable, NotFoundException } from '@nestjs/common';
import { NotificationType } from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { NotificationEntity } from './entities/notification.entity';

/**
 * The generic in-app Notification (things worth KNOWING — you were assigned a
 * card, someone commented on yours). DISTINCT from the pending-approvals
 * counters (things needing ACTION) in NotificationsService. Kanban write-paths
 * call the create* methods; the recipient reads/clears via the endpoints.
 *
 * HARD RULE, enforced in one place: never notify someone about their own
 * action — every create* takes the actor and no-ops if recipient === actor.
 */
@Injectable()
export class KanbanNotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create a notification, skipping the self-notify case. `recipientId` may be
   * null (e.g. an unassigned card has no one to notify) — then it's a no-op.
   */
  private async notify(params: {
    recipientId: string | null;
    actorId: string;
    type: NotificationType;
    cardId: string;
    message: string;
  }): Promise<void> {
    const { recipientId, actorId, type, cardId, message } = params;
    if (!recipientId || recipientId === actorId) {
      return; // no recipient, or would be self-notification — skip.
    }
    await this.prisma.notification.create({
      data: {
        employeeId: recipientId,
        type,
        relatedCardId: cardId,
        message,
      },
    });
  }

  /**
   * A vendor submitted their self-assessment questionnaire — notify the SCM
   * employee who created it. Not card-linked (relatedCardId stays null). Skips
   * self-notify. Kept here so all in-app notification writes share one path.
   */
  async notifyVendorQuestionnaireSubmitted(params: {
    recipientId: string;
    actorId: string | null;
    vendorId: string;
    vendorName: string;
  }): Promise<void> {
    // actorId is the vendor (external, no employee id) — pass null so we never
    // suppress; recipient is always the SCM creator.
    if (params.actorId && params.actorId === params.recipientId) return;
    await this.prisma.notification.create({
      data: {
        employeeId: params.recipientId,
        type: NotificationType.VENDOR_QUESTIONNAIRE_SUBMITTED,
        relatedVendorId: params.vendorId,
        message: `${params.vendorName} submitted their vendor self-assessment questionnaire`,
      },
    });
  }

  /**
   * A raw-material supplier submitted their questionnaire — notify the SCM
   * creator. Card-less (relatedSupplierId set instead). Distinct from the
   * vendor variant above.
   */
  async notifySupplierQuestionnaireSubmitted(params: {
    recipientId: string;
    actorId: string | null;
    supplierId: string;
    supplierName: string;
  }): Promise<void> {
    if (params.actorId && params.actorId === params.recipientId) return;
    await this.prisma.notification.create({
      data: {
        employeeId: params.recipientId,
        type: NotificationType.SUPPLIER_QUESTIONNAIRE_SUBMITTED,
        relatedSupplierId: params.supplierId,
        message: `${params.supplierName} submitted their supplier self-assessment questionnaire`,
      },
    });
  }

  /**
   * BOM workflow notifications (R&D). Submitted → notify each R&D Head;
   * approved/rejected → notify the BOM creator. Card-less (relatedBomId set).
   * Skips self-notify.
   */
  async notifyBomWorkflow(params: {
    recipientId: string;
    actorId: string | null;
    type:
      | typeof NotificationType.BOM_SUBMITTED
      | typeof NotificationType.BOM_APPROVED
      | typeof NotificationType.BOM_REJECTED;
    bomId: string;
    message: string;
  }): Promise<void> {
    if (params.actorId && params.actorId === params.recipientId) return;
    await this.prisma.notification.create({
      data: {
        employeeId: params.recipientId,
        type: params.type,
        relatedBomId: params.bomId,
        message: params.message,
      },
    });
  }

  /** New assignee was set — notify them (unless they assigned themselves). */
  async notifyAssigned(params: {
    assigneeId: string | null;
    actorId: string;
    cardId: string;
    cardTitle: string;
  }): Promise<void> {
    await this.notify({
      recipientId: params.assigneeId,
      actorId: params.actorId,
      type: NotificationType.CARD_ASSIGNED,
      cardId: params.cardId,
      message: `You were assigned to "${params.cardTitle}"`,
    });
  }

  /** A comment was added — notify the card's current assignee (if not author). */
  async notifyCommented(params: {
    assigneeId: string | null;
    actorId: string;
    cardId: string;
    cardTitle: string;
  }): Promise<void> {
    await this.notify({
      recipientId: params.assigneeId,
      actorId: params.actorId,
      type: NotificationType.CARD_COMMENTED,
      cardId: params.cardId,
      message: `New comment on "${params.cardTitle}"`,
    });
  }

  /** A meaningful field changed — notify the assignee (if not the actor). */
  async notifyUpdated(params: {
    assigneeId: string | null;
    actorId: string;
    cardId: string;
    summary: string;
  }): Promise<void> {
    await this.notify({
      recipientId: params.assigneeId,
      actorId: params.actorId,
      type: NotificationType.CARD_UPDATED,
      cardId: params.cardId,
      message: params.summary,
    });
  }

  async notifyQmsAction(params: { recipientId: string; actorId: string; message: string; overdue?: boolean }): Promise<void> {
    if (params.recipientId === params.actorId && !params.overdue) return;
    await this.prisma.notification.create({ data: { employeeId: params.recipientId, type: params.overdue ? NotificationType.QMS_ACTION_OVERDUE : NotificationType.QMS_ACTION_ASSIGNED, message: params.message } });
  }

  // ── read side ────────────────────────────────────────────────────────

  /** The caller's notifications, most recent first. */
  async listMine(user: AuthenticatedUser): Promise<NotificationEntity[]> {
    const rows = await this.prisma.notification.findMany({
      where: { employeeId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return rows.map((n) => this.toEntity(n));
  }

  async unreadCount(user: AuthenticatedUser): Promise<{ count: number }> {
    const count = await this.prisma.notification.count({
      where: { employeeId: user.id, isRead: false },
    });
    return { count };
  }

  /** Mark one of the caller's notifications read (404 if not theirs). */
  async markRead(id: string, user: AuthenticatedUser): Promise<void> {
    const notification = await this.prisma.notification.findUnique({
      where: { id },
    });
    if (!notification || notification.employeeId !== user.id) {
      throw new NotFoundException('Notification not found');
    }
    await this.prisma.notification.update({
      where: { id },
      data: { isRead: true },
    });
  }

  async markAllRead(user: AuthenticatedUser): Promise<{ updated: number }> {
    const res = await this.prisma.notification.updateMany({
      where: { employeeId: user.id, isRead: false },
      data: { isRead: true },
    });
    return { updated: res.count };
  }

  private toEntity(n: {
    id: string;
    type: NotificationType;
    relatedCardId: string | null;
    relatedVendorId: string | null;
    relatedSupplierId: string | null;
    relatedBomId: string | null;
    message: string;
    isRead: boolean;
    createdAt: Date;
  }): NotificationEntity {
    return new NotificationEntity({
      id: n.id,
      type: n.type,
      relatedCardId: n.relatedCardId,
      relatedVendorId: n.relatedVendorId,
      relatedSupplierId: n.relatedSupplierId,
      relatedBomId: n.relatedBomId,
      message: n.message,
      isRead: n.isRead,
      createdAt: n.createdAt.toISOString(),
    });
  }
}
