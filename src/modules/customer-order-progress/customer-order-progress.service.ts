import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DeliveryChallanStatus,
  NotificationType,
  PlmStage,
  Prisma,
  Role,
} from '@prisma/client';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import {
  assertInviteUsable,
  computeExpiry,
  generateInviteToken,
  hashInvitePassword,
} from '../../common/utils/token-invite';
import { PrismaService } from '../../core/database/prisma.service';
import { CustomerDeliverySignoffDto } from './dto/customer-order-progress.dto';
import { deriveProductionProgress } from '../plm/plm-production-progress';

const DAY_MS = 86_400_000;

/**
 * Customer-facing stages mirror the internal PLM StageStrip exactly — same
 * per-flow sequence and same labels — so staff and customers see identical
 * stage names. Kept in sync with web/app/lib/plm.ts (PLM_STAGE_LABEL) and the
 * NPD_STAGES / STANDARD_STAGES arrays in the PLM section.
 */
const PLM_STAGE_LABEL: Record<PlmStage, string> = {
  DESIGN: 'Design',
  DESIGN_REVIEW: 'Design Review',
  DRAWING_RELEASE: 'Drawing Release',
  RELEASE_TO_SCM: 'Release to SCM',
  MATERIAL_PLANNING: 'Material Planning',
  PRODUCTION: 'Production',
  QC: 'QC',
  DISPATCH: 'Dispatch',
  COMPLETED: 'Completed',
};

const NPD_STAGES: PlmStage[] = [
  'DESIGN',
  'DESIGN_REVIEW',
  'DRAWING_RELEASE',
  'RELEASE_TO_SCM',
  'MATERIAL_PLANNING',
  'PRODUCTION',
  'QC',
  'DISPATCH',
  'COMPLETED',
];
const STANDARD_STAGES: PlmStage[] = [
  'RELEASE_TO_SCM',
  'MATERIAL_PLANNING',
  'PRODUCTION',
  'QC',
  'DISPATCH',
  'COMPLETED',
];

/** The stage sequence a line follows, chosen by its PLM flow type. */
function stagesForFlow(flowType: string | null | undefined): PlmStage[] {
  return flowType === 'NPD' ? NPD_STAGES : STANDARD_STAGES;
}

/** Pure shared arithmetic: exactly the done-list based PLM production signal. */
export function productionPercent(
  cards: Array<{ list: { isDoneList: boolean } }>,
): number {
  return deriveProductionProgress(cards).percent;
}

export function deliveryCountdown(
  promisedDeliveryDate: Date | null,
  delivered: boolean,
  now = new Date(),
) {
  if (delivered) return { state: 'DELIVERED' as const, days: 0 };
  if (!promisedDeliveryDate) return { state: 'UNKNOWN' as const, days: null };
  const today = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  const due = Date.UTC(
    promisedDeliveryDate.getUTCFullYear(),
    promisedDeliveryDate.getUTCMonth(),
    promisedDeliveryDate.getUTCDate(),
  );
  const difference = Math.ceil((due - today) / DAY_MS);
  return difference >= 0
    ? { state: 'DUE' as const, days: difference }
    : { state: 'OVERDUE' as const, days: Math.abs(difference) };
}

@Injectable()
export class CustomerOrderProgressService {
  constructor(private readonly prisma: PrismaService) {}

  async createLink(
    orderId: string,
    password: string | undefined,
    user: AuthenticatedUser,
  ) {
    await this.assertCanManage(orderId, user);
    const row = await this.prisma.orderCustomerProgressInvite.create({
      data: {
        orderId,
        token: generateInviteToken(),
        expiresAt: computeExpiry(24 * 365),
        passwordHash: await hashInvitePassword(password),
        createdById: user.id,
      },
      select: {
        id: true,
        token: true,
        expiresAt: true,
        revokedAt: true,
        passwordHash: true,
        createdAt: true,
      },
    });
    return this.toInternalLink(row);
  }

  async listLinks(orderId: string, user: AuthenticatedUser) {
    await this.assertCanManage(orderId, user);
    const rows = await this.prisma.orderCustomerProgressInvite.findMany({
      where: { orderId },
      select: {
        id: true,
        token: true,
        expiresAt: true,
        revokedAt: true,
        passwordHash: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((row) => this.toInternalLink(row));
  }

  async revokeLink(orderId: string, linkId: string, user: AuthenticatedUser) {
    await this.assertCanManage(orderId, user);
    const result = await this.prisma.orderCustomerProgressInvite.updateMany({
      where: { id: linkId, orderId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (!result.count)
      throw new NotFoundException('Active progress link not found');
    return { revoked: true };
  }

  async resolvePublic(token: string, password?: string) {
    const invite = await this.findInvite(token);
    // A missing password is a normal page-entry state, not an authorization
    // failure. Still validate revoke/expiry before revealing this challenge.
    if (invite.passwordHash && !password) {
      await assertInviteUsable({ ...invite, passwordHash: null }, undefined);
      return { requiresPassword: true as const };
    }
    await assertInviteUsable(invite, password);
    return this.serializePublic(invite.orderId);
  }

  async submitSignoff(token: string, dto: CustomerDeliverySignoffDto) {
    const invite = await this.resolveInvite(token, dto.password);
    const publicView = await this.serializePublic(invite.orderId);
    if (!publicView.canSignoff) {
      throw new ForbiddenException(
        'Delivery acknowledgement is available after dispatch',
      );
    }
    if (publicView.signoffSubmitted) {
      throw new ConflictException(
        'Delivery acknowledgement has already been submitted',
      );
    }

    const submittedAt = new Date();
    const lockedExpiry = new Date(submittedAt.getTime() + 3 * DAY_MS);
    try {
      await this.prisma.$transaction([
        this.prisma.orderCustomerSignoff.create({
          data: {
            orderId: invite.orderId,
            inviteId: invite.id,
            customerName: dto.customerName.trim(),
            designation: dto.designation.trim(),
            receiptConfirmed: true,
            comments: dto.comments?.trim() || null,
            satisfactionRating: dto.satisfactionRating ?? null,
            submittedAt,
          },
        }),
        this.prisma.orderCustomerProgressInvite.update({
          where: { id: invite.id },
          data: { expiresAt: lockedExpiry },
        }),
        this.prisma.notification.create({
          data: {
            employeeId: invite.order.ownerId,
            type: NotificationType.CUSTOMER_DELIVERY_SIGNOFF,
            message: `Customer confirmed receipt for order ${invite.order.orderNumber}`,
          },
        }),
      ]);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'Delivery acknowledgement has already been submitted',
        );
      }
      throw error;
    }
    return {
      submittedAt: submittedAt.toISOString(),
      expiresAt: lockedExpiry.toISOString(),
    };
  }

  private async assertCanManage(orderId: string, user: AuthenticatedUser) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { ownerId: true },
    });
    if (!order) throw new NotFoundException('Order not found');
    if (user.role === Role.SUPER_ADMIN || order.ownerId === user.id) return;
    if (!user.verticalId) {
      throw new ForbiddenException(
        'Only Sales staff or the Order owner may share progress',
      );
    }
    const vertical = await this.prisma.vertical.findUnique({
      where: { id: user.verticalId },
      select: { code: true },
    });
    if (vertical?.code !== 'SALES') {
      throw new ForbiddenException(
        'Only Sales staff or the Order owner may share progress',
      );
    }
  }

  private async resolveInvite(token: string, password?: string) {
    const invite = await this.findInvite(token);
    await assertInviteUsable(invite, password);
    return invite;
  }

  private async findInvite(token: string) {
    const invite = await this.prisma.orderCustomerProgressInvite.findUnique({
      where: { token },
      include: { order: { select: { ownerId: true, orderNumber: true } } },
    });
    if (!invite) throw new NotFoundException('Progress link not found');
    return invite;
  }

  /**
   * Dedicated allow-list serializer. Its query deliberately never selects
   * employees, vendors, suppliers, pricing, flowType, comments, or card text.
   */
  private async serializePublic(orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        orderNumber: true,
        customer: { select: { name: true } },
        customerSignoff: { select: { submittedAt: true } },
        confirmationSheets: {
          where: { status: 'EXECUTED' },
          orderBy: { revisionNumber: 'desc' },
          take: 1,
          select: { deliveryDate: true },
        },
        lineItems: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            adHocProductName: true,
            customerFacingProductName: true,
            product: { select: { name: true } },
            deliveryChallanLines: {
              where: {
                deliveryChallan: {
                  status: DeliveryChallanStatus.DELIVERED,
                },
              },
              select: { id: true },
            },
            // One tracker per vendor delivery split. The line is represented by
            // its least-advanced split below.
            plmTrackers: {
              select: {
                currentStage: true,
                flowType: true,
                createdAt: true,
                kickoff: {
                  select: { meetingDate: true, status: true },
                },
                events: {
                  orderBy: { createdAt: 'asc' },
                  select: { toStage: true, createdAt: true },
                },
                productionCards: {
                  where: { status: 'ACTIVE' },
                  select: { list: { select: { isDoneList: true } } },
                },
              },
            },
          },
        },
      },
    });
    if (!order) throw new NotFoundException('Order not found');

    const promised = order.confirmationSheets[0]?.deliveryDate ?? null;
    const signoffSubmitted = !!order.customerSignoff;
    const lines = order.lineItems.map((line) => {
      // A line now carries one tracker per vendor delivery split. Represent it
      // by its LEAST-ADVANCED split — the line isn't done until every vendor
      // portion is — comparing progress as a fraction of each split's own flow
      // (NPD = 9 stages, standard = 6, plus the leading Project Kickoff stage).
      const representative = line.plmTrackers
        .map((t) => {
          const seq = stagesForFlow(t.flowType);
          const completed = t.kickoff.status === 'COMPLETED';
          const index = completed
            ? Math.max(1, seq.indexOf(t.currentStage) + 1)
            : 0;
          return {
            tracker: t,
            seq,
            completed,
            fraction: index / (seq.length + 1),
          };
        })
        .sort((a, b) => a.fraction - b.fraction)[0];
      const tracker = representative?.tracker ?? null;
      // Each line mirrors its representative split's PLM flow.
      const stageSeq = representative?.seq ?? stagesForFlow(undefined);
      const kickoffCompleted = representative?.completed ?? false;
      const delivered =
        signoffSubmitted || line.deliveryChallanLines.length > 0;
      const trackedIndex = tracker
        ? stageSeq.indexOf(tracker.currentStage)
        : -1;
      const currentIndex = delivered
        ? stageSeq.length
        : kickoffCompleted
          ? Math.max(1, trackedIndex + 1)
          : 0;
      const start = tracker?.kickoff.meetingDate ?? tracker?.createdAt ?? null;
      const totalDays =
        start && promised
          ? Math.max(
              1,
              Math.ceil((promised.getTime() - start.getTime()) / DAY_MS),
            )
          : null;
      const elapsedDays = start
        ? Math.max(0, Math.floor((Date.now() - start.getTime()) / DAY_MS))
        : null;
      const toStage = (stage: PlmStage) => ({
        key: stage,
        label: PLM_STAGE_LABEL[stage],
        changedAt:
          tracker?.events
            .filter((event) => event.toStage === stage)
            .at(-1)
            ?.createdAt.toISOString() ?? null,
      });
      const publicStages = [
        {
          key: 'PROJECT_KICKOFF',
          label: 'Project Kickoff',
          changedAt: kickoffCompleted
            ? tracker.kickoff.meetingDate.toISOString()
            : null,
        },
        ...stageSeq.map(toStage),
      ];
      return {
        lineId: line.id,
        // The portal is THE customer-facing surface — their wording first.
        productName:
          line.customerFacingProductName ??
          line.product?.name ??
          line.adHocProductName ??
          'Unnamed product',
        currentStage: publicStages[currentIndex],
        stages: publicStages.map((stage, index) => ({
          ...stage,
          state:
            index < currentIndex
              ? ('DONE' as const)
              : index === currentIndex
                ? ('CURRENT' as const)
                : ('UPCOMING' as const),
        })),
        productionPercent: productionPercent(tracker?.productionCards ?? []),
        pace:
          totalDays != null && elapsedDays != null
            ? {
                elapsedDays,
                totalDays,
                percent: Math.min(
                  100,
                  Math.round((elapsedDays / totalDays) * 100),
                ),
              }
            : null,
      };
    });
    // A line at its final stage (COMPLETED) is treated as delivered.
    const orderDelivered =
      signoffSubmitted ||
      (lines.length > 0 &&
        lines.every((line) => line.currentStage.key === 'COMPLETED'));
    const canSignoff =
      !signoffSubmitted &&
      lines.some((line) =>
        ['DISPATCH', 'COMPLETED'].includes(line.currentStage.key),
      );
    return {
      orderNumber: order.orderNumber,
      customerName: order.customer?.name ?? 'Internal',
      productNames: lines.map((line) => line.productName),
      promisedDeliveryDate: promised?.toISOString() ?? null,
      countdown: deliveryCountdown(promised, orderDelivered),
      lines,
      canSignoff,
      signoffSubmitted,
      signoffSubmittedAt:
        order.customerSignoff?.submittedAt.toISOString() ?? null,
    };
  }

  private toInternalLink(row: {
    id: string;
    token: string;
    expiresAt: Date;
    revokedAt: Date | null;
    passwordHash: string | null;
    createdAt: Date;
  }) {
    return {
      id: row.id,
      token: row.token,
      expiresAt: row.expiresAt.toISOString(),
      revokedAt: row.revokedAt?.toISOString() ?? null,
      passwordProtected: !!row.passwordHash,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
