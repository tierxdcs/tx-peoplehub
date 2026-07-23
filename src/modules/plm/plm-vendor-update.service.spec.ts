import { BadRequestException } from '@nestjs/common';
import { NotificationType, PlmUpdateReporterType, Role } from '@prisma/client';
import { PlmVendorUpdateService } from './plm-vendor-update.service';

describe('PlmVendorUpdateService', () => {
  const tracker = {
    id: 'tracker-1',
    ownerId: 'owner-1',
    flowType: 'VENDOR',
    currentStage: 'PRODUCTION',
    vendor: { id: 'vendor-1', companyName: 'Balaji MetalTech' },
    order: { orderNumber: 'ORD-2026-0001' },
    orderLine: { product: { name: 'Rack', sku: 'RACK-1' } },
  };

  function setup() {
    const tx = {
      plmProductionUpdate: {
        create: jest.fn().mockResolvedValue({ id: 'update-1', photos: [] }),
      },
      plmTrackerEvent: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      plmVendorUpdateInvite: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'invite-1',
          trackerId: tracker.id,
          revokedAt: null,
          expiresAt: new Date(Date.now() + 60_000),
          passwordHash: null,
        }),
      },
      plmTracker: { findUnique: jest.fn().mockResolvedValue(tracker) },
      plmProductionUpdate: { findMany: jest.fn().mockResolvedValue([]) },
      employee: { findUnique: jest.fn() },
      $transaction: jest.fn((callback) => callback(tx)),
    };
    const access = {
      assertCanOperate: jest.fn(),
      assertInternalAuditor: jest.fn(),
    };
    const storage = {
      headObject: jest.fn(),
      createUploadUrl: jest.fn(),
      createDownloadUrl: jest.fn(),
    };
    const notifications = { notifyPlm: jest.fn().mockResolvedValue(undefined) };
    return {
      service: new PlmVendorUpdateService(
        prisma as never,
        access as never,
        storage as never,
        notifications as never,
      ),
      prisma,
      access,
      storage,
      notifications,
      tx,
    };
  }

  it('records a vendor self-report with vendor provenance and no internal actor', async () => {
    const { service, tx, notifications } = setup();
    await service.submitPublic('token', {
      fabricationPercent: 80,
      surfaceFinishPercent: 40,
      assemblyPercent: 10,
      notes: 'Fabrication nearly complete',
    });

    expect(tx.plmProductionUpdate.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          reporterType: PlmUpdateReporterType.VENDOR_SELF_REPORT,
          reporterDisplayName: 'Balaji MetalTech',
          internalReporterId: null,
        }),
      }),
    );
    expect(tx.plmTrackerEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ actorId: null }) }),
    );
    expect(notifications.notifyPlm).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientId: 'owner-1',
        type: NotificationType.PLM_PRODUCTION_UPDATE,
        trackerId: 'tracker-1',
      }),
    );
  });

  it('rechecks actual photo type during confirmation', async () => {
    const { service, storage } = setup();
    storage.headObject.mockResolvedValue({
      sizeBytes: 100,
      contentType: 'application/pdf',
    });
    await expect(
      service.submitPublic('token', {
        fabricationPercent: 10,
        surfaceFinishPercent: 0,
        assemblyPercent: 0,
        photos: [
          {
            storageKey: 'plm/tracker-1/updates/photo',
            fileName: 'photo.jpg',
          },
        ],
      }),
    ).rejects.toThrow(
      new BadRequestException(
        'Only image files may be confirmed as progress photos',
      ),
    );
  });

  it('requires the Internal Auditor capability for site-visit updates', async () => {
    const { service, access } = setup();
    access.assertInternalAuditor.mockRejectedValue(new Error('forbidden'));
    await expect(
      service.submitInternal(
        tracker.id,
        {
          fabricationPercent: 10,
          surfaceFinishPercent: 0,
          assemblyPercent: 0,
        },
        {
          id: 'auditor-1',
          email: 'auditor@example.com',
          role: Role.MANAGER,
          verticalId: null,
        },
      ),
    ).rejects.toThrow('forbidden');
  });
});
