import {
  MAX_PUSH_DEVICES,
  PushSubscriptionsService,
} from './push-subscriptions.service';

/**
 * Managing one's own push devices.
 *
 * The properties that matter: every read and write is scoped to the calling
 * employee, registering is idempotent (the client re-posts on every load, which
 * is how a rotated subscription heals), and the endpoint — not the employee — is
 * the identity of a device, so a shared phone cannot deliver one person's
 * notifications to another.
 */
describe('PushSubscriptionsService', () => {
  const user = { id: 'emp-1', email: 'a@b.com' } as never;
  const IPHONE_UA =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1';

  let prisma: any;
  let push: any;
  let service: PushSubscriptionsService;

  const row = (overrides: Record<string, unknown> = {}) => ({
    id: 'sub-1',
    userAgent: IPHONE_UA,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    lastPushAt: null,
    ...overrides,
  });

  beforeEach(() => {
    prisma = {
      pushSubscription: {
        findMany: jest.fn(async () => [row()]),
        upsert: jest.fn(async () => row()),
        deleteMany: jest.fn(async () => ({ count: 1 })),
      },
    };
    push = {
      isConfigured: jest.fn(() => true),
      publicKey: 'BPublicKey',
      sendToEmployee: jest.fn(async () => ({
        delivered: 1,
        expired: 0,
        failed: 0,
        results: [],
      })),
    };
    service = new PushSubscriptionsService(prisma as never, push as never);
  });

  const dto = (overrides: Record<string, unknown> = {}) =>
    ({
      endpoint: 'https://push.example.com/aaa',
      keys: { p256dh: 'key-1', auth: 'auth-1' },
      userAgent: IPHONE_UA,
      ...overrides,
    }) as never;

  describe('config', () => {
    it('hands out the public key so the browser can subscribe', () => {
      expect(service.config()).toEqual({
        configured: true,
        publicKey: 'BPublicKey',
      });
    });

    it('reports unconfigured so the UI can hide the control', () => {
      push.isConfigured.mockReturnValue(false);
      push.publicKey = null;
      expect(service.config()).toEqual({ configured: false, publicKey: null });
    });
  });

  describe('list', () => {
    it('returns the caller’s own devices with readable labels and no secrets', async () => {
      const devices = await service.list(user);

      expect(prisma.pushSubscription.findMany).toHaveBeenCalledWith({
        where: { employeeId: 'emp-1' },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          userAgent: true,
          createdAt: true,
          lastPushAt: true,
        },
      });
      expect(devices[0]).toEqual({
        id: 'sub-1',
        label: 'iPhone · Safari',
        createdAt: new Date('2026-08-01T00:00:00.000Z'),
        lastPushAt: null,
      });
      // The endpoint and encryption keys are never selected, let alone returned.
      expect(JSON.stringify(devices)).not.toContain('push.example.com');
    });
  });

  describe('register', () => {
    it('upserts on the endpoint and claims it for the caller', async () => {
      await service.register(user, dto());

      expect(prisma.pushSubscription.upsert).toHaveBeenCalledWith({
        where: { endpoint: 'https://push.example.com/aaa' },
        create: {
          endpoint: 'https://push.example.com/aaa',
          employeeId: 'emp-1',
          p256dh: 'key-1',
          auth: 'auth-1',
          userAgent: IPHONE_UA,
        },
        // The update sets employeeId too: on a shared device the endpoint must
        // move to whoever most recently allowed notifications there.
        update: {
          employeeId: 'emp-1',
          p256dh: 'key-1',
          auth: 'auth-1',
          userAgent: IPHONE_UA,
        },
        select: {
          id: true,
          userAgent: true,
          createdAt: true,
          lastPushAt: true,
        },
      });
    });

    it('stores a null user agent rather than an empty string', async () => {
      await service.register(user, dto({ userAgent: undefined }));
      expect(
        prisma.pushSubscription.upsert.mock.calls[0][0].create.userAgent,
      ).toBeNull();
    });

    it('drops the oldest devices once over the cap, never the one just added', async () => {
      const many = Array.from({ length: MAX_PUSH_DEVICES + 3 }, (_, i) => ({
        id: `sub-${i}`,
      }));
      // findMany is called twice: once by the cap check, once by nothing else
      // here (register returns the upserted row directly).
      prisma.pushSubscription.findMany.mockResolvedValue(many);
      prisma.pushSubscription.upsert.mockResolvedValue(row({ id: 'sub-0' }));

      await service.register(user, dto());

      const pruned =
        prisma.pushSubscription.deleteMany.mock.calls[0][0].where.id.in;
      expect(pruned).toEqual([
        `sub-${MAX_PUSH_DEVICES}`,
        `sub-${MAX_PUSH_DEVICES + 1}`,
        `sub-${MAX_PUSH_DEVICES + 2}`,
      ]);
      expect(pruned).not.toContain('sub-0');
    });

    it('prunes nothing at or below the cap', async () => {
      prisma.pushSubscription.findMany.mockResolvedValue(
        Array.from({ length: MAX_PUSH_DEVICES }, (_, i) => ({
          id: `sub-${i}`,
        })),
      );
      await service.register(user, dto());
      expect(prisma.pushSubscription.deleteMany).not.toHaveBeenCalled();
    });
  });

  describe('unsubscribe and revoke', () => {
    it('scopes deletion by employee, so one employee cannot unsubscribe another', async () => {
      await service.unsubscribe(user, 'https://push.example.com/aaa');
      expect(prisma.pushSubscription.deleteMany).toHaveBeenCalledWith({
        where: {
          employeeId: 'emp-1',
          endpoint: 'https://push.example.com/aaa',
        },
      });
    });

    it('treats unsubscribing something already gone as a no-op', async () => {
      prisma.pushSubscription.deleteMany.mockResolvedValue({ count: 0 });
      await expect(
        service.unsubscribe(user, 'https://push.example.com/ghost'),
      ).resolves.toBeInstanceOf(Array);
    });

    it('revokes a listed device by id, still scoped to the owner', async () => {
      await service.revoke(user, 'sub-9');
      expect(prisma.pushSubscription.deleteMany).toHaveBeenCalledWith({
        where: { employeeId: 'emp-1', id: 'sub-9' },
      });
    });
  });

  describe('sendTest', () => {
    it('notifies only the caller’s own devices', async () => {
      await service.sendTest(user);
      expect(push.sendToEmployee).toHaveBeenCalledWith('emp-1', {
        title: 'Notifications are working',
        body: 'This is a test notification from PhazeOne.',
        url: '/profile',
        tag: 'push-test',
      });
    });

    it('includes the caller’s note when they gave one', async () => {
      await service.sendTest(user, '  from the shop floor  ');
      expect(push.sendToEmployee.mock.calls[0][1].body).toBe(
        'from the shop floor',
      );
    });

    it('lets a configuration failure surface — the request IS the send', async () => {
      push.sendToEmployee.mockRejectedValue(new Error('not configured'));
      await expect(service.sendTest(user)).rejects.toThrow('not configured');
    });
  });
});
