import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  NotificationType,
  PlmUpdateReporterType,
  PlmVendorUpdateType,
  Role,
} from '@prisma/client';
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
        aggregate: jest
          .fn()
          .mockResolvedValue({ _max: { completedSteps: null } }),
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
      financeCompanySettings: {
        findFirst: jest.fn().mockResolvedValue({ legalName: 'Phaze Dynamics' }),
      },
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
    const email = {
      send: jest.fn().mockResolvedValue({
        id: 'msg-1',
        recipients: ['ops@balaji.example'],
        blocked: [],
      }),
    };
    const config = {
      get: jest.fn((key: string) =>
        key === 'frontendOrigin' ? 'https://app.example.com' : 'Asia/Kolkata',
      ),
    };
    return {
      service: new PlmVendorUpdateService(
        prisma as never,
        access as never,
        storage as never,
        notifications as never,
        email as never,
        config as never,
      ),
      prisma,
      access,
      storage,
      notifications,
      email,
      config,
      tx,
    };
  }

  /** The invite shape sendInviteEmail selects, distinct from the public-resolve one. */
  function emailableInvite(overrides: Record<string, unknown> = {}): {
    token: string;
    expiresAt: Date;
    revokedAt: Date | null;
    passwordHash: string | null;
    tracker: {
      ownerId: string;
      order: { orderNumber: string };
      kickoff: { vendorUpdateCadenceDays: number };
      vendor: {
        companyName: string;
        contactEmail: string | null;
        contactPersonName: string | null;
      } | null;
      orderLine: {
        adHocProductName: string | null;
        product: { name: string } | null;
      };
    };
  } {
    return {
      token: 'tok_abc123',
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
      passwordHash: null,
      tracker: {
        ownerId: 'owner-1',
        order: { orderNumber: 'ORD-2026-0001' },
        kickoff: { vendorUpdateCadenceDays: 7 },
        vendor: {
          companyName: 'Balaji MetalTech',
          contactEmail: 'ops@balaji.example',
          contactPersonName: 'R. Iyer',
        },
        orderLine: { adHocProductName: null, product: { name: 'Rack' } },
      },
      ...overrides,
    };
  }

  it('records a vendor self-report with vendor provenance and no internal actor', async () => {
    const { service, tx, notifications } = setup();
    await service.submitPublic('token', {
      completedSteps: 5,
      notes: 'Welding complete, moving to coating',
    });

    expect(tx.plmProductionUpdate.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          reporterType: PlmUpdateReporterType.VENDOR_SELF_REPORT,
          updateType: PlmVendorUpdateType.FULL_PROGRESS,
          reporterDisplayName: 'Balaji MetalTech',
          internalReporterId: null,
          completedSteps: 5,
        }),
      }),
    );
    expect(tx.plmTrackerEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ actorId: null }),
      }),
    );
    expect(notifications.notifyPlm).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientId: 'owner-1',
        type: NotificationType.PLM_PRODUCTION_UPDATE,
        trackerId: 'tracker-1',
      }),
    );
  });

  it('rejects a progress update that rolls back below the furthest confirmed step', async () => {
    const { service, tx } = setup();
    tx.plmProductionUpdate.aggregate.mockResolvedValue({
      _max: { completedSteps: 6 },
    });

    await expect(
      service.submitPublic('token', { completedSteps: 4 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.plmProductionUpdate.create).not.toHaveBeenCalled();
  });

  it('allows a progress update that keeps or advances the furthest confirmed step', async () => {
    const { service, tx } = setup();
    tx.plmProductionUpdate.aggregate.mockResolvedValue({
      _max: { completedSteps: 6 },
    });

    await service.submitPublic('token', { completedSteps: 7 });
    expect(tx.plmProductionUpdate.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ completedSteps: 7 }),
      }),
    );
  });

  it('records a quick comment without changing progress percentages', async () => {
    const { service, tx } = setup();

    await service.submitPublicComment('token', {
      notes: 'Material received; welding resumes tomorrow.',
    });

    expect(tx.plmProductionUpdate.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          updateType: PlmVendorUpdateType.COMMENT_ONLY,
          completedSteps: null,
          notes: 'Material received; welding resumes tomorrow.',
        }),
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
        completedSteps: 1,
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

  describe('sendInviteEmail', () => {
    const staff = {
      id: 'owner-1',
      email: 'pm@example.com',
      role: Role.MANAGER,
      verticalId: null,
    };

    it('emails the vendor contact on file, with the public link and a tag', async () => {
      const { service, prisma, email } = setup();
      prisma.plmVendorUpdateInvite.findUnique.mockResolvedValue(
        emailableInvite(),
      );

      const result = await service.sendInviteEmail('invite-1', {}, staff);

      expect(email.send).toHaveBeenCalledTimes(1);
      const sent = email.send.mock.calls[0][0];
      expect(sent.to).toBe('ops@balaji.example');
      expect(sent.subject).toBe('Production updates for ORD-2026-0001 — Rack');
      expect(sent.html).toContain(
        'https://app.example.com/public/plm-vendor-update/tok_abc123',
      );
      expect(sent.text).toContain('We ask for an update every 7 days');
      expect(sent.tags).toEqual([
        { name: 'kind', value: 'plm-vendor-update-invite' },
      ]);
      expect(result.messageId).toBe('msg-1');
      expect(result.recipients).toEqual(['ops@balaji.example']);
    });

    it('sends to an explicit recipient instead of the vendor contact', async () => {
      const { service, prisma, email } = setup();
      prisma.plmVendorUpdateInvite.findUnique.mockResolvedValue(
        emailableInvite(),
      );

      await service.sendInviteEmail(
        'invite-1',
        { to: 'shopfloor@balaji.example' },
        staff,
      );

      expect(email.send.mock.calls[0][0].to).toBe('shopfloor@balaji.example');
    });

    it('names our own product rather than forwarding the customer’s PO wording', async () => {
      // customerFacingProductName is the customer's, and is deliberately not
      // even selected — so a change upstream cannot start leaking it here.
      const { service, prisma, email } = setup();
      prisma.plmVendorUpdateInvite.findUnique.mockResolvedValue(
        emailableInvite(),
      );
      await service.sendInviteEmail('invite-1', {}, staff);
      const selected = prisma.plmVendorUpdateInvite.findUnique.mock.calls[0][0];
      expect(
        selected.select.tracker.select.orderLine.select,
      ).not.toHaveProperty('customerFacingProductName');
      expect(email.send.mock.calls[0][0].subject).toContain('Rack');
    });

    it('falls back to the ad-hoc product name when the line has no catalogue product', async () => {
      const { service, prisma, email } = setup();
      const invite = emailableInvite();
      invite.tracker.orderLine = {
        adHocProductName: 'Custom bollard',
        product: null,
      };
      prisma.plmVendorUpdateInvite.findUnique.mockResolvedValue(invite);

      await service.sendInviteEmail('invite-1', {}, staff);
      expect(email.send.mock.calls[0][0].subject).toContain('Custom bollard');
    });

    it('refuses to email a revoked link rather than mailing a dead URL', async () => {
      const { service, prisma, email } = setup();
      prisma.plmVendorUpdateInvite.findUnique.mockResolvedValue(
        emailableInvite({ revokedAt: new Date() }),
      );

      await expect(
        service.sendInviteEmail('invite-1', {}, staff),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(email.send).not.toHaveBeenCalled();
    });

    it('refuses to email an expired link', async () => {
      const { service, prisma, email } = setup();
      prisma.plmVendorUpdateInvite.findUnique.mockResolvedValue(
        emailableInvite({ expiresAt: new Date('2026-08-01T00:00:00.000Z') }),
      );

      await expect(
        service.sendInviteEmail(
          'invite-1',
          {},
          staff,
          new Date('2026-08-30T00:00:00.000Z'),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(email.send).not.toHaveBeenCalled();
    });

    it('asks for a recipient when the vendor has no contact email on file', async () => {
      const { service, prisma, email } = setup();
      const invite = emailableInvite();
      invite.tracker.vendor = {
        companyName: 'Balaji MetalTech',
        contactEmail: null,
        contactPersonName: 'R. Iyer',
      };
      prisma.plmVendorUpdateInvite.findUnique.mockResolvedValue(invite);

      await expect(
        service.sendInviteEmail('invite-1', {}, staff),
      ).rejects.toThrow(/no valid contact email/);
      expect(email.send).not.toHaveBeenCalled();
    });

    it('rejects a malformed override address before calling the provider', async () => {
      const { service, prisma, email } = setup();
      prisma.plmVendorUpdateInvite.findUnique.mockResolvedValue(
        emailableInvite(),
      );

      await expect(
        service.sendInviteEmail('invite-1', { to: 'not-an-address' }, staff),
      ).rejects.toThrow(/not valid/);
      expect(email.send).not.toHaveBeenCalled();
    });

    it('enforces the same operate permission as revoking the link', async () => {
      const { service, prisma, access, email } = setup();
      prisma.plmVendorUpdateInvite.findUnique.mockResolvedValue(
        emailableInvite(),
      );
      access.assertCanOperate.mockRejectedValue(new Error('forbidden'));

      await expect(
        service.sendInviteEmail('invite-1', {}, staff),
      ).rejects.toThrow('forbidden');
      expect(access.assertCanOperate).toHaveBeenCalledWith(staff, 'owner-1');
      expect(email.send).not.toHaveBeenCalled();
    });

    it('404s an unknown invite', async () => {
      const { service, prisma } = setup();
      prisma.plmVendorUpdateInvite.findUnique.mockResolvedValue(null);

      await expect(
        service.sendInviteEmail('nope', {}, staff),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('reports a held send as skipped rather than as a delivery', async () => {
      const { service, prisma, email } = setup();
      prisma.plmVendorUpdateInvite.findUnique.mockResolvedValue(
        emailableInvite(),
      );
      email.send.mockResolvedValue({
        id: null,
        recipients: [],
        blocked: ['ops@balaji.example'],
        skipped: 'suppressed-by-allowlist',
      });

      const result = await service.sendInviteEmail('invite-1', {}, staff);
      expect(result.skipped).toBe('suppressed-by-allowlist');
      expect(result.recipients).toEqual([]);
      expect(result.blocked).toEqual(['ops@balaji.example']);
    });

    it('mentions the password without ever including it', async () => {
      const { service, prisma, email } = setup();
      prisma.plmVendorUpdateInvite.findUnique.mockResolvedValue(
        emailableInvite({ passwordHash: '$2b$10$hash' }),
      );

      await service.sendInviteEmail('invite-1', {}, staff);
      const sent = email.send.mock.calls[0][0];
      expect(sent.text).toContain('password-protected');
      expect(sent.html).not.toContain('$2b$10$hash');
    });
  });

  it('requires the Internal Auditor capability for site-visit updates', async () => {
    const { service, access } = setup();
    access.assertInternalAuditor.mockRejectedValue(new Error('forbidden'));
    await expect(
      service.submitInternal(
        tracker.id,
        {
          completedSteps: 1,
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
