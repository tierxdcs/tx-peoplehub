import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as webpush from 'web-push';
import { PrismaService } from '../database/prisma.service';
import {
  buildPushPayload,
  classifyPushFailure,
  type PushFailureKind,
  type PushNotification,
} from './push-payload';

/** The `push` namespace from src/core/config/configuration.ts. */
export interface PushConfig {
  publicKey?: string;
  privateKey?: string;
  subject?: string;
}

/** One device's delivery details, as the browser handed them to us. */
export interface PushTarget {
  /** Our push_subscriptions row id — what gets pruned when it expires. */
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushDeliveryResult {
  subscriptionId: string;
  /** Truncated for logs/diagnostics — an endpoint is long and unhelpful in full. */
  endpoint: string;
  status: 'delivered' | PushFailureKind;
  statusCode?: number;
  error?: string;
}

/** Why a send returned without reaching any device. Never an error condition. */
export type PushSkipReason = 'no-devices';

export interface PushSendResult {
  /** Devices the push service accepted the message for. */
  delivered: number;
  /** Devices whose subscription was gone; their rows have been deleted. */
  expired: number;
  /** Devices that failed for any other reason; their rows are kept. */
  failed: number;
  skipped?: PushSkipReason;
  results: PushDeliveryResult[];
}

/**
 * How long the push service keeps trying while the device is offline. Four
 * weeks (the library default) is wrong for an ERP: an approval reminder that
 * finally arrives three weeks later is noise about something already resolved.
 */
const PUSH_TTL_SECONDS = 24 * 60 * 60;

/**
 * The single shared push sender — one implementation reused everywhere, the same
 * discipline as EmailService.
 *
 * It shares NOTHING with email but that discipline. Different protocol (Web
 * Push over HTTP with VAPID rather than an email API), different library
 * (`web-push`, not Resend), different credentials (a VAPID keypair, not an API
 * key), different destination (a browser on a device, not a mailbox). Neither
 * service can affect the other, and neither is a fallback for the other — they
 * are two independent channels.
 *
 * Configuration is optional exactly as it is for email, R2 and Gotenberg: with
 * no VAPID keys the app boots normally, the frontend hides the enable-
 * notifications control (it asks for the public key and gets null), and only an
 * actual send fails, with a message naming the missing vars.
 *
 * There is deliberately no dry-run switch. Email needed one because a mistake
 * mails a real customer; a push can only ever reach a device whose owner
 * explicitly tapped "allow" on this app, so there is no equivalent hazard to
 * guard against.
 *
 * Which events trigger a push is NOT decided here — this service is the
 * infrastructure. Nothing in the app calls it automatically yet.
 */
@Injectable()
export class PushNotificationService {
  private readonly logger = new Logger(PushNotificationService.name);
  private readonly cfg: PushConfig;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.cfg = config.get<PushConfig>('push') ?? {};
    if (!this.isConfigured()) {
      this.logger.warn(
        'Push notifications are disabled — set VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT to enable them.',
      );
    }
  }

  /**
   * True when a send will be attempted rather than rejected. All three vars are
   * needed together: the keypair signs the request and the subject is the
   * contact address push services require in that signature.
   */
  isConfigured(): boolean {
    return Boolean(
      this.cfg.publicKey && this.cfg.privateKey && this.cfg.subject,
    );
  }

  /**
   * The VAPID public key, which every browser needs in order to subscribe. Not
   * a secret — it is handed out to clients by design. Null when unconfigured, so
   * the UI can hide the control instead of failing at subscribe time.
   */
  get publicKey(): string | null {
    return this.cfg.publicKey ?? null;
  }

  /** The VAPID contact URL, for diagnostics. Never returns the private key. */
  get subject(): string | null {
    return this.cfg.subject ?? null;
  }

  /**
   * Push a notification to every device this employee has enabled. Throws only
   * when push is not configured or the lookup fails — never because one of
   * their devices is unreachable.
   *
   * A per-device report rather than a single throw, for the same reason the RFQ
   * invite batch reports per invitee: someone with a phone and a laptop whose
   * laptop subscription has expired should still get the notification on their
   * phone, and the caller should be able to say so honestly.
   */
  async sendToEmployee(
    employeeId: string,
    notification: PushNotification,
  ): Promise<PushSendResult> {
    this.requireConfigured();
    const targets = await this.prisma.pushSubscription.findMany({
      where: { employeeId },
      select: { id: true, endpoint: true, p256dh: true, auth: true },
    });
    return this.sendToTargets(targets, notification);
  }

  /**
   * Best-effort send: logs and returns null instead of throwing.
   *
   * This is the method a future event trigger should use. A notification is a
   * side effect of a business action, and a failed or unconfigured push must
   * never roll back the approval, ping or voucher that prompted it — the same
   * strict/best-effort pair as EmailService.send/trySend and
   * VaultStorageService.deleteObjectStrict/deleteObject.
   */
  async trySendToEmployee(
    employeeId: string,
    notification: PushNotification,
    context?: string,
  ): Promise<PushSendResult | null> {
    try {
      return await this.sendToEmployee(employeeId, notification);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Push skipped${context ? ` (${context})` : ''}: "${notification.title}" — ${detail}`,
      );
      return null;
    }
  }

  /**
   * Push to several employees at once, reporting one summary per employee.
   * Failures are per employee, so one person with no devices does not hide the
   * outcome for the rest.
   */
  async trySendToEmployees(
    employeeIds: string[],
    notification: PushNotification,
    context?: string,
  ): Promise<Record<string, PushSendResult | null>> {
    const unique = [...new Set(employeeIds)];
    const entries = await Promise.all(
      unique.map(
        async (id) =>
          [
            id,
            await this.trySendToEmployee(id, notification, context),
          ] as const,
      ),
    );
    return Object.fromEntries(entries);
  }

  /**
   * Delivers to an explicit set of devices. Public so a caller that already
   * holds the rows (the test endpoint) does not have to re-query them.
   *
   * Expired subscriptions are deleted here rather than reported upward, so no
   * caller can forget to prune: an endpoint the push service has declared gone
   * will never work again, and keeping it means retrying it forever.
   */
  async sendToTargets(
    targets: PushTarget[],
    notification: PushNotification,
  ): Promise<PushSendResult> {
    this.requireConfigured();
    if (targets.length === 0) {
      return {
        delivered: 0,
        expired: 0,
        failed: 0,
        skipped: 'no-devices',
        results: [],
      };
    }

    const payload = buildPushPayload(notification);
    const results: PushDeliveryResult[] = [];
    for (const target of targets) {
      results.push(await this.deliver(target, payload, notification.title));
    }

    const expired = results.filter((r) => r.status === 'expired');
    if (expired.length > 0) {
      // deleteMany, not delete: two concurrent sends can both see the same dead
      // endpoint, and the loser of that race must not throw a P2025.
      await this.prisma.pushSubscription.deleteMany({
        where: { id: { in: expired.map((r) => r.subscriptionId) } },
      });
      this.logger.log(
        `Removed ${expired.length} expired push subscription(s) reported gone by the push service`,
      );
    }

    const delivered = results.filter((r) => r.status === 'delivered');
    if (delivered.length > 0) {
      await this.prisma.pushSubscription.updateMany({
        where: { id: { in: delivered.map((r) => r.subscriptionId) } },
        data: { lastPushAt: new Date() },
      });
    }

    return {
      delivered: delivered.length,
      expired: expired.length,
      failed: results.length - delivered.length - expired.length,
      results,
    };
  }

  private async deliver(
    target: PushTarget,
    payload: string,
    title: string,
  ): Promise<PushDeliveryResult> {
    const shortEndpoint = `${target.endpoint.slice(0, 60)}…`;
    try {
      await webpush.sendNotification(
        {
          endpoint: target.endpoint,
          keys: { p256dh: target.p256dh, auth: target.auth },
        },
        payload,
        {
          // Passed per call rather than via webpush.setVapidDetails(), which
          // mutates library-global state — this keeps the keys on the call path
          // and makes the service safe to construct more than once (tests).
          vapidDetails: {
            subject: this.cfg.subject as string,
            publicKey: this.cfg.publicKey as string,
            privateKey: this.cfg.privateKey as string,
          },
          TTL: PUSH_TTL_SECONDS,
        },
      );
      return {
        subscriptionId: target.id,
        endpoint: shortEndpoint,
        status: 'delivered',
      };
    } catch (err) {
      const statusCode =
        typeof err === 'object' && err !== null && 'statusCode' in err
          ? (err as { statusCode?: number }).statusCode
          : undefined;
      const status = classifyPushFailure(statusCode);
      const detail = err instanceof Error ? err.message : String(err);

      if (status === 'expired') {
        this.logger.log(
          `Push subscription gone (${statusCode}) for ${shortEndpoint} — pruning`,
        );
      } else if (status === 'rejected') {
        // Our own misconfiguration: the same push will fail for every device,
        // so this deserves an error rather than a shrug.
        this.logger.error(
          `Push rejected (${statusCode}) for "${title}" → ${shortEndpoint}: ${detail}. Check VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY/VAPID_SUBJECT.`,
        );
      } else {
        this.logger.warn(
          `Push failed (${statusCode ?? 'no status'}) for "${title}" → ${shortEndpoint}: ${detail}`,
        );
      }

      return {
        subscriptionId: target.id,
        endpoint: shortEndpoint,
        status,
        statusCode,
        error: detail,
      };
    }
  }

  private requireConfigured(): void {
    if (!this.isConfigured()) {
      throw new InternalServerErrorException(
        'Push notifications are not configured (set VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT)',
      );
    }
  }
}
