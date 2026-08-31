import { randomBytes } from 'crypto';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  NotificationType,
  PlmEventType,
  PlmUpdateReporterType,
  PlmVendorUpdateType,
} from '@prisma/client';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { ConfigService } from '@nestjs/config';
import {
  assertInviteUsable,
  computeExpiry,
  generateInviteToken,
  hashInvitePassword,
  inviteLinkUrl,
} from '../../common/utils/token-invite';
import { PrismaService } from '../../core/database/prisma.service';
import { isValidEmailAddress } from '../../core/email/email-content';
import { EmailSendResultEntity } from '../../core/email/email-send.entity';
import { EmailService } from '../../core/email/email.service';
import { resolveOrganisationName } from '../../core/email/organisation';
import { SendInviteEmailDto } from '../../core/email/send-invite-email.dto';
import { plmVendorUpdateInviteEmail } from '../../core/email/templates/plm-vendor-update-invite';
import {
  assertExtensionAllowed,
  assertSizeWithinCap,
} from '../vault/vault-guardrails';
import { VaultStorageService } from '../vault/vault-storage.service';
import {
  CreatePlmVendorInviteDto,
  PlmPhotoUploadUrlDto,
  PlmProductionUpdateDto,
  PlmQuickCommentDto,
} from './dto/plm.dto';
import { PlmAccessService } from './plm-access.service';
import { KanbanNotificationsService } from '../notifications/kanban-notifications.service';
import { deriveVendorCadence } from './plm-vendor-cadence';
import {
  PLM_PRODUCTION_STEP_COUNT,
  stepsToPercent,
} from './plm-production-steps';

/** The frontend route the public update form lives on, without the token. */
const PUBLIC_VENDOR_UPDATE_PATH = '/public/plm-vendor-update';

/**
 * How to name the product to the vendor building it.
 *
 * Deliberately NOT the same chain the in-app notifications use: those lead with
 * `customerFacingProductName`, which is the customer's own PO wording and is
 * theirs, not something to forward to a third party. A vendor works from our
 * catalogue name, so that goes first here.
 */
function vendorFacingProductLabel(line: {
  adHocProductName: string | null;
  product: { name: string } | null;
}): string {
  return (
    line.product?.name ?? line.adHocProductName ?? 'the item in production'
  );
}

@Injectable()
export class PlmVendorUpdateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: PlmAccessService,
    private readonly storage: VaultStorageService,
    private readonly notifications: KanbanNotificationsService,
    // EmailModule is @Global, so this needs no import edge in PlmModule.
    private readonly email: EmailService,
    private readonly config: ConfigService,
  ) {}

  async createInvite(
    trackerId: string,
    dto: CreatePlmVendorInviteDto,
    user: AuthenticatedUser,
  ) {
    const tracker = await this.trackerOrThrow(trackerId);
    await this.access.assertCanOperate(user, tracker.ownerId);
    if (tracker.flowType !== 'VENDOR' || !tracker.vendor) {
      throw new BadRequestException(
        'Vendor update links require a Vendor-flow tracker linked to a vendor',
      );
    }
    const invite = await this.prisma.plmVendorUpdateInvite.create({
      data: {
        trackerId,
        token: generateInviteToken(),
        expiresAt: computeExpiry(dto.expiresInHours ?? 336),
        passwordHash: await hashInvitePassword(dto.password),
        createdById: user.id,
      },
      select: { id: true, token: true, expiresAt: true, createdAt: true },
    });
    await this.prisma.plmTrackerEvent.create({
      data: {
        trackerId,
        type: PlmEventType.VENDOR_INVITE_CREATED,
        actorId: user.id,
        metadata: { inviteId: invite.id, expiresAt: invite.expiresAt },
      },
    });
    return invite;
  }

  /**
   * Email an existing update link to the vendor's contact.
   *
   * A separate action rather than auto-sending on create — the same reasoning as
   * ScmService.sendInviteEmail: re-sending (bounced, wrong person, a nudge after
   * the vendor has gone quiet) must not mint a new token and silently kill the
   * link the vendor may already be using. That matters more here than for a
   * questionnaire, because this link is a standing channel used for weeks.
   *
   * Strict `send()`: a staff member pressed a send button, so a provider failure
   * has to surface rather than be swallowed into the log.
   */
  async sendInviteEmail(
    inviteId: string,
    dto: SendInviteEmailDto,
    user: AuthenticatedUser,
    now: Date = new Date(),
  ): Promise<EmailSendResultEntity> {
    const invite = await this.prisma.plmVendorUpdateInvite.findUnique({
      where: { id: inviteId },
      select: {
        token: true,
        expiresAt: true,
        revokedAt: true,
        passwordHash: true,
        tracker: {
          select: {
            ownerId: true,
            order: { select: { orderNumber: true } },
            kickoff: { select: { vendorUpdateCadenceDays: true } },
            vendor: {
              select: {
                companyName: true,
                contactEmail: true,
                contactPersonName: true,
              },
            },
            orderLine: {
              select: {
                adHocProductName: true,
                product: { select: { name: true } },
              },
            },
          },
        },
      },
    });
    if (!invite) throw new NotFoundException('Vendor update invite not found');
    await this.access.assertCanOperate(user, invite.tracker.ownerId);
    if (invite.revokedAt) {
      throw new BadRequestException(
        'This link has been revoked — create a new one before emailing it',
      );
    }
    if (invite.expiresAt <= now) {
      throw new BadRequestException(
        'This link has expired — create a new one before emailing it',
      );
    }
    const vendor = invite.tracker.vendor;
    if (!vendor) {
      // createInvite already refuses a vendor-less tracker, so this is only
      // reachable if the vendor link was cleared afterwards.
      throw new BadRequestException(
        'This tracker no longer has a linked vendor to email',
      );
    }
    const to = (dto.to ?? vendor.contactEmail ?? '').trim();
    if (!isValidEmailAddress(to)) {
      throw new BadRequestException(
        dto.to
          ? 'The recipient address is not valid'
          : 'This vendor has no valid contact email — supply a recipient',
      );
    }

    const rendered = plmVendorUpdateInviteEmail({
      vendorName: vendor.companyName,
      contactPersonName: vendor.contactPersonName,
      orderNumber: invite.tracker.order.orderNumber,
      productName: vendorFacingProductLabel(invite.tracker.orderLine),
      url: inviteLinkUrl(
        this.config.get<string>('frontendOrigin') ?? '',
        PUBLIC_VENDOR_UPDATE_PATH,
        invite.token,
      ),
      expiresAt: invite.expiresAt,
      cadenceDays: invite.tracker.kickoff.vendorUpdateCadenceDays,
      passwordProtected: !!invite.passwordHash,
      organisationName: await resolveOrganisationName(this.prisma),
      note: dto.note,
      now,
      timezone: this.config.get<string>('timezone'),
    });
    // No idempotency key on purpose: a second press IS a deliberate re-send,
    // and Resend would silently suppress it as a duplicate for 24h.
    const result = await this.email.send({
      to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      tags: [{ name: 'kind', value: 'plm-vendor-update-invite' }],
    });
    return EmailSendResultEntity.from(result);
  }

  async revokeInvite(inviteId: string, user: AuthenticatedUser) {
    const invite = await this.prisma.plmVendorUpdateInvite.findUnique({
      where: { id: inviteId },
      include: { tracker: { select: { ownerId: true } } },
    });
    if (!invite) throw new NotFoundException('Vendor update invite not found');
    await this.access.assertCanOperate(user, invite.tracker.ownerId);
    if (!invite.revokedAt) {
      await this.prisma.$transaction([
        this.prisma.plmVendorUpdateInvite.update({
          where: { id: inviteId },
          data: { revokedAt: new Date() },
        }),
        this.prisma.plmTrackerEvent.create({
          data: {
            trackerId: invite.trackerId,
            type: PlmEventType.VENDOR_INVITE_REVOKED,
            actorId: user.id,
            metadata: { inviteId },
          },
        }),
      ]);
    }
    return { success: true };
  }

  async listInvites(trackerId: string, user: AuthenticatedUser) {
    const tracker = await this.trackerOrThrow(trackerId);
    await this.access.assertCanOperate(user, tracker.ownerId);
    return this.prisma.plmVendorUpdateInvite.findMany({
      where: { trackerId },
      select: {
        id: true,
        token: true,
        expiresAt: true,
        revokedAt: true,
        createdAt: true,
        createdBy: { select: { firstName: true, lastName: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async photoDownloadUrl(photoId: string, user: AuthenticatedUser) {
    const photo = await this.prisma.plmProductionUpdatePhoto.findUnique({
      where: { id: photoId },
      select: {
        storageKey: true,
        update: { select: { trackerId: true } },
      },
    });
    if (!photo) throw new NotFoundException('Progress photo not found');
    await this.access.assertCanViewTracker(user, photo.update.trackerId);
    const signed = await this.storage.createDownloadUrl(photo.storageKey);
    return {
      downloadUrl: signed.url,
      expiresInSeconds: signed.expiresInSeconds,
    };
  }

  async resolvePublic(token: string, password?: string) {
    const invite = await this.validInvite(token, password);
    return this.publicView(invite.trackerId);
  }

  async publicPhotoUploadUrl(token: string, dto: PlmPhotoUploadUrlDto) {
    const invite = await this.validInvite(token, dto.password);
    return this.photoUploadUrl(invite.trackerId, dto);
  }

  async submitPublic(token: string, dto: PlmProductionUpdateDto) {
    const invite = await this.validInvite(token, dto.password);
    const tracker = await this.trackerOrThrow(invite.trackerId);
    const update = await this.recordUpdate(
      tracker,
      dto,
      PlmVendorUpdateType.FULL_PROGRESS,
      PlmUpdateReporterType.VENDOR_SELF_REPORT,
      null,
      tracker.vendor!.companyName,
    );
    await this.notifications.notifyPlm({
      recipientId: tracker.ownerId,
      actorId: null,
      type: NotificationType.PLM_PRODUCTION_UPDATE,
      trackerId: tracker.id,
      message: `${tracker.vendor!.companyName} reported production progress for ${tracker.order.orderNumber} · ${tracker.orderLine.customerFacingProductName ?? tracker.orderLine.product?.name ?? tracker.orderLine.adHocProductName ?? 'Unnamed product'}`,
    });
    return update;
  }

  async submitPublicComment(token: string, dto: PlmQuickCommentDto) {
    const invite = await this.validInvite(token, dto.password);
    const tracker = await this.trackerOrThrow(invite.trackerId);
    if (!dto.notes.trim()) {
      throw new BadRequestException('Quick comment cannot be empty');
    }
    const update = await this.recordUpdate(
      tracker,
      { notes: dto.notes },
      PlmVendorUpdateType.COMMENT_ONLY,
      PlmUpdateReporterType.VENDOR_SELF_REPORT,
      null,
      tracker.vendor!.companyName,
    );
    await this.notifications.notifyPlm({
      recipientId: tracker.ownerId,
      actorId: null,
      type: NotificationType.PLM_PRODUCTION_UPDATE,
      trackerId: tracker.id,
      message: `${tracker.vendor!.companyName} added a production comment for ${tracker.order.orderNumber} · ${tracker.orderLine.customerFacingProductName ?? tracker.orderLine.product?.name ?? tracker.orderLine.adHocProductName ?? 'Unnamed product'}`,
    });
    return update;
  }

  async internalPhotoUploadUrl(
    trackerId: string,
    dto: PlmPhotoUploadUrlDto,
    user: AuthenticatedUser,
  ) {
    await this.access.assertInternalAuditor(user);
    await this.trackerOrThrow(trackerId);
    return this.photoUploadUrl(trackerId, dto);
  }

  async submitInternal(
    trackerId: string,
    dto: PlmProductionUpdateDto,
    user: AuthenticatedUser,
  ) {
    await this.access.assertInternalAuditor(user);
    const [tracker, employee] = await Promise.all([
      this.trackerOrThrow(trackerId),
      this.prisma.employee.findUnique({
        where: { id: user.id },
        select: { firstName: true, lastName: true },
      }),
    ]);
    const update = await this.recordUpdate(
      tracker,
      dto,
      PlmVendorUpdateType.FULL_PROGRESS,
      PlmUpdateReporterType.INTERNAL_AUDITOR_VISIT,
      user.id,
      `${employee?.firstName ?? ''} ${employee?.lastName ?? ''}`.trim() ||
        user.email,
    );
    await this.notifications.notifyPlm({
      recipientId: tracker.ownerId,
      actorId: user.id,
      type: NotificationType.PLM_PRODUCTION_UPDATE,
      trackerId: tracker.id,
      message: `Site-visit production update recorded for ${tracker.order.orderNumber} · ${tracker.orderLine.customerFacingProductName ?? tracker.orderLine.product?.name ?? tracker.orderLine.adHocProductName ?? 'Unnamed product'}`,
    });
    return update;
  }

  private async photoUploadUrl(trackerId: string, dto: PlmPhotoUploadUrlDto) {
    assertExtensionAllowed(dto.name);
    assertSizeWithinCap(dto.sizeBytes);
    if (!dto.mimeType.startsWith('image/')) {
      throw new BadRequestException(
        'Only image files may be uploaded as progress photos',
      );
    }
    const storageKey = `plm/${trackerId}/updates/${randomBytes(12).toString('hex')}`;
    const signed = await this.storage.createUploadUrl(storageKey, dto.mimeType);
    return {
      storageKey,
      uploadUrl: signed.url,
      expiresInSeconds: signed.expiresInSeconds,
    };
  }

  private async recordUpdate(
    tracker: Awaited<ReturnType<PlmVendorUpdateService['trackerOrThrow']>>,
    dto: PlmProductionUpdateDto | PlmQuickCommentDto,
    updateType: PlmVendorUpdateType,
    reporterType: PlmUpdateReporterType,
    internalReporterId: string | null,
    reporterDisplayName: string,
  ) {
    if (tracker.flowType !== 'VENDOR' || !tracker.vendor) {
      throw new BadRequestException(
        'Production updates apply only to Vendor-flow trackers',
      );
    }
    if (tracker.currentStage !== 'PRODUCTION') {
      throw new BadRequestException(
        'Production progress can only be reported while this tracker is in Production',
      );
    }
    const photos: Array<{
      storageKey: string;
      fileName: string;
      sizeBytes: number;
      mimeType: string;
    }> = [];
    const progressDto =
      updateType === PlmVendorUpdateType.FULL_PROGRESS
        ? (dto as PlmProductionUpdateDto)
        : null;
    for (const photo of progressDto?.photos ?? []) {
      if (!photo.storageKey.startsWith(`plm/${tracker.id}/updates/`)) {
        throw new BadRequestException(
          'A progress photo does not belong to this tracker',
        );
      }
      const head = await this.storage.headObject(photo.storageKey);
      if (!head)
        throw new BadRequestException('A progress photo upload was not found');
      assertSizeWithinCap(head.sizeBytes);
      if (!head.contentType?.startsWith('image/')) {
        throw new BadRequestException(
          'Only image files may be confirmed as progress photos',
        );
      }
      photos.push({
        storageKey: photo.storageKey,
        fileName: photo.fileName,
        sizeBytes: head.sizeBytes,
        mimeType: head.contentType,
      });
    }
    const completedSteps = progressDto?.completedSteps ?? null;
    return this.prisma.$transaction(async (tx) => {
      // Routing steps are confirmed one at a time and cannot be rolled back:
      // a new full-progress update may only keep or advance the highest step
      // count already recorded for this tracker. Enforced here (not just in the
      // UI) because the public vendor link can POST any value.
      if (completedSteps !== null) {
        const furthest = await tx.plmProductionUpdate.aggregate({
          where: { trackerId: tracker.id, completedSteps: { not: null } },
          _max: { completedSteps: true },
        });
        const highest = furthest._max.completedSteps ?? 0;
        if (completedSteps < highest) {
          throw new BadRequestException(
            `Confirmed steps cannot be rolled back — ${highest} of ${PLM_PRODUCTION_STEP_COUNT} step(s) are already confirmed`,
          );
        }
      }
      const update = await tx.plmProductionUpdate.create({
        data: {
          trackerId: tracker.id,
          reporterType,
          updateType,
          internalReporterId,
          reporterDisplayName,
          completedSteps,
          notes: dto.notes?.trim() || null,
          photos: { create: photos },
        },
        include: { photos: true },
      });
      await tx.plmTrackerEvent.create({
        data: {
          trackerId: tracker.id,
          type: PlmEventType.PRODUCTION_UPDATE_REPORTED,
          actorId: internalReporterId,
          comment: dto.notes?.trim() || null,
          metadata: {
            updateId: update.id,
            reporterType,
            updateType,
            reporterDisplayName,
            completedSteps,
            percentComplete:
              completedSteps === null ? null : stepsToPercent(completedSteps),
          },
        },
      });
      return update;
    });
  }

  private async validInvite(token: string, password?: string) {
    const invite = await this.prisma.plmVendorUpdateInvite.findUnique({
      where: { token },
    });
    if (!invite) throw new NotFoundException('Invalid vendor update link');
    await assertInviteUsable(invite, password);
    return invite;
  }

  private async trackerOrThrow(id: string) {
    const tracker = await this.prisma.plmTracker.findUnique({
      where: { id },
      include: {
        vendor: { select: { id: true, companyName: true } },
        order: { select: { orderNumber: true } },
        kickoff: { select: { vendorUpdateCadenceDays: true } },
        events: {
          where: { toStage: 'PRODUCTION' },
          select: { createdAt: true },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
        orderLine: {
          include: { product: { select: { name: true, sku: true } } },
        },
      },
    });
    if (!tracker) throw new NotFoundException('PLM tracker not found');
    return tracker;
  }

  private async publicView(trackerId: string) {
    const tracker = await this.trackerOrThrow(trackerId);
    const updates = await this.prisma.plmProductionUpdate.findMany({
      where: { trackerId },
      include: { photos: true },
      orderBy: { createdAt: 'desc' },
    });
    const publicUpdates = await Promise.all(
      updates.map(async (update) => ({
        ...update,
        // Derived so the UI never recomputes the routing weighting itself.
        percentComplete:
          update.completedSteps === null
            ? null
            : stepsToPercent(update.completedSteps),
        photos: await Promise.all(
          update.photos.map(async (photo) => ({
            id: photo.id,
            fileName: photo.fileName,
            sizeBytes: photo.sizeBytes,
            mimeType: photo.mimeType,
            downloadUrl: (
              await this.storage.createDownloadUrl(photo.storageKey)
            ).url,
          })),
        ),
      })),
    );
    const latest = updates[0]?.createdAt ?? null;
    const cadenceReference =
      latest ?? tracker.events[0]?.createdAt ?? tracker.createdAt;
    const cadence = deriveVendorCadence(
      cadenceReference,
      tracker.kickoff.vendorUpdateCadenceDays,
    );
    return {
      trackerId,
      orderNumber: tracker.order.orderNumber,
      product: tracker.orderLine.product,
      vendorName: tracker.vendor?.companyName,
      currentStage: tracker.currentStage,
      vendorUpdateCadenceDays: tracker.kickoff.vendorUpdateCadenceDays,
      lastVendorUpdateAt: latest?.toISOString() ?? null,
      vendorCadenceStatus: cadence.status,
      vendorUpdateDueAt: cadence.dueAt.toISOString(),
      updates: publicUpdates,
    };
  }
}
