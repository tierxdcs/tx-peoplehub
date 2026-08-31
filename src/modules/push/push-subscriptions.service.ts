import { Injectable, Logger } from '@nestjs/common';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../core/database/prisma.service';
import {
  PushNotificationService,
  type PushSendResult,
} from '../../core/push/push.service';
import { describeDevice } from './device-label';
import { RegisterPushSubscriptionDto } from './dto/push-subscription.dto';
import {
  PushConfigEntity,
  PushDeviceEntity,
} from './entities/push-device.entity';

/**
 * How many devices one employee may keep subscribed. Generous for a real person
 * (phone, tablet, work laptop, home laptop) and a backstop against a client bug
 * that re-subscribes in a loop. Over the cap, the OLDEST rows are dropped rather
 * than the request rejected: the device in the user's hand is the one they care
 * about, and a stale endpoint from a browser profile they cleared months ago is
 * the right thing to lose.
 */
export const MAX_PUSH_DEVICES = 10;

/**
 * The caller's own push subscriptions. Every method is scoped to the
 * authenticated employee, so any logged-in employee may manage exactly their own
 * devices and nobody else's — the same shape as NavShortcutsService, and the
 * reason no access service or @Roles guard appears here.
 *
 * Delivery itself belongs to the shared PushNotificationService; this service
 * only owns the subscription rows and the "notify myself" test.
 */
@Injectable()
export class PushSubscriptionsService {
  private readonly logger = new Logger(PushSubscriptionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly push: PushNotificationService,
  ) {}

  /** What the browser needs to subscribe. Never returns the private key. */
  config(): PushConfigEntity {
    return {
      configured: this.push.isConfigured(),
      publicKey: this.push.publicKey,
    };
  }

  async list(user: AuthenticatedUser): Promise<PushDeviceEntity[]> {
    const rows = await this.prisma.pushSubscription.findMany({
      where: { employeeId: user.id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        userAgent: true,
        createdAt: true,
        lastPushAt: true,
      },
    });
    return rows.map((row) => ({
      id: row.id,
      label: describeDevice(row.userAgent),
      createdAt: row.createdAt,
      lastPushAt: row.lastPushAt,
    }));
  }

  /**
   * Registers (or refreshes) the calling employee's subscription for one device.
   *
   * Upsert on `endpoint`, which is globally unique: the browser may hand back the
   * same endpoint on every load, and the client re-posts it each time so a
   * rotated key or a changed owner self-heals. On a shared device that means the
   * endpoint moves to whoever most recently allowed notifications there — which
   * is correct, and the alternative (leaving it with the previous employee) would
   * deliver one person's notifications to another.
   *
   * Idempotent: re-registering an unchanged subscription is a no-op update, so
   * the client can call it freely on every page load.
   */
  async register(
    user: AuthenticatedUser,
    dto: RegisterPushSubscriptionDto,
  ): Promise<PushDeviceEntity> {
    const data = {
      employeeId: user.id,
      p256dh: dto.keys.p256dh,
      auth: dto.keys.auth,
      userAgent: dto.userAgent?.slice(0, 500) ?? null,
    };
    const row = await this.prisma.pushSubscription.upsert({
      where: { endpoint: dto.endpoint },
      create: { endpoint: dto.endpoint, ...data },
      update: data,
      select: { id: true, userAgent: true, createdAt: true, lastPushAt: true },
    });

    await this.pruneBeyondCap(user.id, row.id);

    return {
      id: row.id,
      label: describeDevice(row.userAgent),
      createdAt: row.createdAt,
      lastPushAt: row.lastPushAt,
    };
  }

  /**
   * Turns notifications off for one device, identified by its endpoint (what the
   * browser knows about itself).
   *
   * Deleting something already gone is a no-op, not an error: the caller's intent
   * ("this device must not be subscribed") is already satisfied. Scoped by
   * employeeId so one employee cannot unsubscribe another's device by guessing an
   * endpoint.
   */
  async unsubscribe(
    user: AuthenticatedUser,
    endpoint: string,
  ): Promise<PushDeviceEntity[]> {
    await this.prisma.pushSubscription.deleteMany({
      where: { employeeId: user.id, endpoint },
    });
    return this.list(user);
  }

  /**
   * Revokes a device from the list by row id — how someone turns off
   * notifications on a phone they no longer have, from a different device.
   */
  async revoke(
    user: AuthenticatedUser,
    id: string,
  ): Promise<PushDeviceEntity[]> {
    await this.prisma.pushSubscription.deleteMany({
      where: { employeeId: user.id, id },
    });
    return this.list(user);
  }

  /**
   * Sends a test notification to the caller's own devices. Any authenticated
   * employee may do this: it can only ever notify themselves, and it is the only
   * way a person can confirm that notifications actually arrive on their phone
   * rather than merely that the server accepted the request.
   *
   * Strict: the request IS the send, so a configuration failure must surface
   * rather than be logged and swallowed. Individual unreachable devices are
   * reported in the result, not thrown.
   */
  async sendTest(
    user: AuthenticatedUser,
    note?: string,
  ): Promise<PushSendResult> {
    return this.push.sendToEmployee(user.id, {
      title: 'Notifications are working',
      body: note?.trim()
        ? note.trim()
        : 'This is a test notification from PhazeOne.',
      url: '/profile',
      tag: 'push-test',
    });
  }

  /**
   * Keeps the newest MAX_PUSH_DEVICES rows for this employee, never dropping the
   * one just registered (it is the newest by definition, but being explicit
   * makes that impossible to break later).
   */
  private async pruneBeyondCap(
    employeeId: string,
    keepId: string,
  ): Promise<void> {
    const rows = await this.prisma.pushSubscription.findMany({
      where: { employeeId },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    if (rows.length <= MAX_PUSH_DEVICES) return;
    const stale = rows
      .slice(MAX_PUSH_DEVICES)
      .map((row) => row.id)
      .filter((id) => id !== keepId);
    if (stale.length === 0) return;
    await this.prisma.pushSubscription.deleteMany({
      where: { id: { in: stale } },
    });
    this.logger.log(
      `Pruned ${stale.length} oldest push subscription(s) over the ${MAX_PUSH_DEVICES}-device cap`,
    );
  }
}
