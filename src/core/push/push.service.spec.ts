import * as webpush from 'web-push';
import { PushNotificationService } from './push.service';

jest.mock('web-push', () => ({ sendNotification: jest.fn() }));

const sendNotification = webpush.sendNotification as jest.Mock;

/**
 * The shared push sender.
 *
 * The properties that matter: it boots and degrades cleanly without VAPID keys,
 * the private key never leaves the service, one unreachable device never stops
 * the others, and a subscription the push service declares gone is deleted
 * rather than retried forever.
 */
describe('PushNotificationService', () => {
  const PUBLIC_KEY = 'BPublicKeyForTests';
  const PRIVATE_KEY = 'PrivateKeyThatMustNeverLeak';

  let prisma: any;
  let devices: {
    id: string;
    endpoint: string;
    p256dh: string;
    auth: string;
  }[];

  const configFor = (push: Record<string, unknown> | undefined) =>
    ({ get: jest.fn(() => push) }) as never;

  const configured = () =>
    configFor({
      publicKey: PUBLIC_KEY,
      privateKey: PRIVATE_KEY,
      subject: 'mailto:ops@example.com',
    });

  const build = (config: never) =>
    new PushNotificationService(prisma as never, config);

  beforeEach(() => {
    jest.clearAllMocks();
    devices = [
      {
        id: 'sub-1',
        endpoint: 'https://push.example.com/aaa',
        p256dh: 'k1',
        auth: 'a1',
      },
    ];
    prisma = {
      pushSubscription: {
        findMany: jest.fn(async () => devices),
        deleteMany: jest.fn(async () => ({ count: 0 })),
        updateMany: jest.fn(async () => ({ count: 0 })),
      },
    };
    sendNotification.mockResolvedValue({ statusCode: 201 });
  });

  describe('when VAPID keys are missing', () => {
    it('reports itself unconfigured and offers no public key', () => {
      const service = build(configFor(undefined));
      expect(service.isConfigured()).toBe(false);
      expect(service.publicKey).toBeNull();
    });

    it('is unconfigured until all three vars are present', () => {
      expect(
        build(
          configFor({ publicKey: PUBLIC_KEY, privateKey: PRIVATE_KEY }),
        ).isConfigured(),
      ).toBe(false);
      expect(
        build(
          configFor({ publicKey: PUBLIC_KEY, subject: 'mailto:a@b.com' }),
        ).isConfigured(),
      ).toBe(false);
    });

    it('throws a message naming the missing vars on a strict send', async () => {
      await expect(
        build(configFor(undefined)).sendToEmployee('emp-1', { title: 'Hi' }),
      ).rejects.toThrow(/VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT/);
      expect(sendNotification).not.toHaveBeenCalled();
    });

    it('returns null from a best-effort send instead of throwing', async () => {
      // A background notification must never be able to roll back the business
      // action that prompted it.
      const result = await build(configFor(undefined)).trySendToEmployee(
        'emp-1',
        { title: 'Hi' },
      );
      expect(result).toBeNull();
    });
  });

  it('delivers to each of the employee’s devices with the VAPID details', async () => {
    const service = build(configured());

    const result = await service.sendToEmployee('emp-1', {
      title: 'New ping',
      body: 'Asha sent you a ping',
      url: '/pings',
    });

    expect(prisma.pushSubscription.findMany).toHaveBeenCalledWith({
      where: { employeeId: 'emp-1' },
      select: { id: true, endpoint: true, p256dh: true, auth: true },
    });
    const [subscription, payload, options] = sendNotification.mock.calls[0];
    expect(subscription).toEqual({
      endpoint: 'https://push.example.com/aaa',
      keys: { p256dh: 'k1', auth: 'a1' },
    });
    expect(JSON.parse(payload)).toMatchObject({
      title: 'New ping',
      body: 'Asha sent you a ping',
      url: '/pings',
    });
    expect(options.vapidDetails).toEqual({
      subject: 'mailto:ops@example.com',
      publicKey: PUBLIC_KEY,
      privateKey: PRIVATE_KEY,
    });
    // A day, not the library's four weeks: a reminder that arrives three weeks
    // late is noise about something already resolved.
    expect(options.TTL).toBe(24 * 60 * 60);

    expect(result).toMatchObject({ delivered: 1, expired: 0, failed: 0 });
    expect(prisma.pushSubscription.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['sub-1'] } },
      data: { lastPushAt: expect.any(Date) },
    });
  });

  it('never exposes the private key in a result', async () => {
    const result = await build(configured()).sendToEmployee('emp-1', {
      title: 'Hi',
    });
    expect(JSON.stringify(result)).not.toContain(PRIVATE_KEY);
  });

  it('says so honestly when the employee has no devices', async () => {
    devices = [];
    const result = await build(configured()).sendToEmployee('emp-1', {
      title: 'Hi',
    });
    expect(result).toMatchObject({
      delivered: 0,
      failed: 0,
      skipped: 'no-devices',
      results: [],
    });
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it('deletes a subscription the push service says is gone', async () => {
    devices = [
      {
        id: 'sub-1',
        endpoint: 'https://push.example.com/aaa',
        p256dh: 'k1',
        auth: 'a1',
      },
      {
        id: 'sub-2',
        endpoint: 'https://push.example.com/bbb',
        p256dh: 'k2',
        auth: 'a2',
      },
    ];
    sendNotification
      .mockResolvedValueOnce({ statusCode: 201 })
      .mockRejectedValueOnce(
        Object.assign(new Error('unsubscribed'), { statusCode: 410 }),
      );

    const result = await build(configured()).sendToEmployee('emp-1', {
      title: 'Hi',
    });

    expect(result).toMatchObject({ delivered: 1, expired: 1, failed: 0 });
    expect(prisma.pushSubscription.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['sub-2'] } },
    });
    // Only the delivered one gets its clock touched.
    expect(prisma.pushSubscription.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['sub-1'] } },
      data: { lastPushAt: expect.any(Date) },
    });
  });

  it('keeps a subscription that failed transiently', async () => {
    sendNotification.mockRejectedValue(
      Object.assign(new Error('rate limited'), { statusCode: 429 }),
    );

    const result = await build(configured()).sendToEmployee('emp-1', {
      title: 'Hi',
    });

    expect(result).toMatchObject({ delivered: 0, expired: 0, failed: 1 });
    expect(result.results[0]).toMatchObject({
      status: 'failed',
      statusCode: 429,
    });
    expect(prisma.pushSubscription.deleteMany).not.toHaveBeenCalled();
  });

  it('reports a rejected send (bad keys) without pruning the device', async () => {
    sendNotification.mockRejectedValue(
      Object.assign(new Error('invalid vapid'), { statusCode: 401 }),
    );

    const result = await build(configured()).sendToEmployee('emp-1', {
      title: 'Hi',
    });

    expect(result.results[0].status).toBe('rejected');
    expect(prisma.pushSubscription.deleteMany).not.toHaveBeenCalled();
  });

  it('one unreachable device does not stop the rest', async () => {
    devices = [
      {
        id: 'sub-1',
        endpoint: 'https://push.example.com/aaa',
        p256dh: 'k1',
        auth: 'a1',
      },
      {
        id: 'sub-2',
        endpoint: 'https://push.example.com/bbb',
        p256dh: 'k2',
        auth: 'a2',
      },
      {
        id: 'sub-3',
        endpoint: 'https://push.example.com/ccc',
        p256dh: 'k3',
        auth: 'a3',
      },
    ];
    sendNotification
      .mockResolvedValueOnce({ statusCode: 201 })
      .mockRejectedValueOnce(new Error('socket hang up'))
      .mockResolvedValueOnce({ statusCode: 201 });

    const result = await build(configured()).sendToEmployee('emp-1', {
      title: 'Hi',
    });

    expect(sendNotification).toHaveBeenCalledTimes(3);
    expect(result).toMatchObject({ delivered: 2, failed: 1 });
  });

  it('truncates the endpoint in its per-device report', async () => {
    const result = await build(configured()).sendToEmployee('emp-1', {
      title: 'Hi',
    });
    expect(result.results[0].endpoint.endsWith('…')).toBe(true);
  });

  describe('trySendToEmployees', () => {
    it('reports one summary per employee and de-duplicates ids', async () => {
      const service = build(configured());

      const summaries = await service.trySendToEmployees(
        ['emp-1', 'emp-2', 'emp-1'],
        { title: 'Standup' },
      );

      expect(Object.keys(summaries).sort()).toEqual(['emp-1', 'emp-2']);
      expect(summaries['emp-1']).toMatchObject({ delivered: 1 });
    });

    it('isolates one employee’s failure from the others', async () => {
      prisma.pushSubscription.findMany.mockImplementation(
        async ({ where }: { where: { employeeId: string } }) => {
          if (where.employeeId === 'emp-2') throw new Error('db blew up');
          return devices;
        },
      );

      const summaries = await build(configured()).trySendToEmployees(
        ['emp-1', 'emp-2'],
        { title: 'Standup' },
      );

      expect(summaries['emp-1']).toMatchObject({ delivered: 1 });
      expect(summaries['emp-2']).toBeNull();
    });
  });
});
