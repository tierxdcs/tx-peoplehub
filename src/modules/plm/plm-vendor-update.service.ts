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
} from '@prisma/client';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import {
  assertInviteUsable,
  computeExpiry,
  generateInviteToken,
  hashInvitePassword,
} from '../../common/utils/token-invite';
import { PrismaService } from '../../core/database/prisma.service';
import {
  assertExtensionAllowed,
  assertSizeWithinCap,
} from '../vault/vault-guardrails';
import { VaultStorageService } from '../vault/vault-storage.service';
import {
  CreatePlmVendorInviteDto,
  PlmPhotoUploadUrlDto,
  PlmProductionUpdateDto,
} from './dto/plm.dto';
import { PlmAccessService } from './plm-access.service';
import { KanbanNotificationsService } from '../notifications/kanban-notifications.service';

@Injectable()
export class PlmVendorUpdateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: PlmAccessService,
    private readonly storage: VaultStorageService,
    private readonly notifications: KanbanNotificationsService,
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
    return { downloadUrl: signed.url, expiresInSeconds: signed.expiresInSeconds };
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
      PlmUpdateReporterType.VENDOR_SELF_REPORT,
      null,
      tracker.vendor!.companyName,
    );
    await this.notifications.notifyPlm({
      recipientId: tracker.ownerId,
      actorId: null,
      type: NotificationType.PLM_PRODUCTION_UPDATE,
      trackerId: tracker.id,
      message: `${tracker.vendor!.companyName} reported production progress for ${tracker.order.orderNumber} · ${tracker.orderLine.product.name}`,
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
      PlmUpdateReporterType.INTERNAL_AUDITOR_VISIT,
      user.id,
      `${employee?.firstName ?? ''} ${employee?.lastName ?? ''}`.trim() || user.email,
    );
    await this.notifications.notifyPlm({
      recipientId: tracker.ownerId,
      actorId: user.id,
      type: NotificationType.PLM_PRODUCTION_UPDATE,
      trackerId: tracker.id,
      message: `Site-visit production update recorded for ${tracker.order.orderNumber} · ${tracker.orderLine.product.name}`,
    });
    return update;
  }

  private async photoUploadUrl(trackerId: string, dto: PlmPhotoUploadUrlDto) {
    assertExtensionAllowed(dto.name);
    assertSizeWithinCap(dto.sizeBytes);
    if (!dto.mimeType.startsWith('image/')) {
      throw new BadRequestException('Only image files may be uploaded as progress photos');
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
    dto: PlmProductionUpdateDto,
    reporterType: PlmUpdateReporterType,
    internalReporterId: string | null,
    reporterDisplayName: string,
  ) {
    if (tracker.flowType !== 'VENDOR' || !tracker.vendor) {
      throw new BadRequestException('Production updates apply only to Vendor-flow trackers');
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
    for (const photo of dto.photos ?? []) {
      if (!photo.storageKey.startsWith(`plm/${tracker.id}/updates/`)) {
        throw new BadRequestException('A progress photo does not belong to this tracker');
      }
      const head = await this.storage.headObject(photo.storageKey);
      if (!head) throw new BadRequestException('A progress photo upload was not found');
      assertSizeWithinCap(head.sizeBytes);
      if (!head.contentType?.startsWith('image/')) {
        throw new BadRequestException('Only image files may be confirmed as progress photos');
      }
      photos.push({
        storageKey: photo.storageKey,
        fileName: photo.fileName,
        sizeBytes: head.sizeBytes,
        mimeType: head.contentType,
      });
    }
    return this.prisma.$transaction(async (tx) => {
      const update = await tx.plmProductionUpdate.create({
        data: {
          trackerId: tracker.id,
          reporterType,
          internalReporterId,
          reporterDisplayName,
          fabricationPercent: dto.fabricationPercent,
          surfaceFinishPercent: dto.surfaceFinishPercent,
          assemblyPercent: dto.assemblyPercent,
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
            reporterDisplayName,
            fabricationPercent: dto.fabricationPercent,
            surfaceFinishPercent: dto.surfaceFinishPercent,
            assemblyPercent: dto.assemblyPercent,
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
        orderLine: { include: { product: { select: { name: true, sku: true } } } },
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
        photos: await Promise.all(
          update.photos.map(async (photo) => ({
            id: photo.id,
            fileName: photo.fileName,
            sizeBytes: photo.sizeBytes,
            mimeType: photo.mimeType,
            downloadUrl: (await this.storage.createDownloadUrl(photo.storageKey)).url,
          })),
        ),
      })),
    );
    return {
      trackerId,
      orderNumber: tracker.order.orderNumber,
      product: tracker.orderLine.product,
      vendorName: tracker.vendor?.companyName,
      currentStage: tracker.currentStage,
      updates: publicUpdates,
    };
  }
}
