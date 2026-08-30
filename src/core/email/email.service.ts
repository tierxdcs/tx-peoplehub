import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import type { CreateEmailOptions } from 'resend';
import {
  filterRecipients,
  isValidEmailAddress,
  normalizeRecipients,
  plainTextFrom,
} from './email-content';

/** The `email` namespace from src/core/config/configuration.ts. */
export interface EmailConfig {
  apiKey?: string;
  from?: string;
  replyTo?: string;
  /** Empty = send to anyone. Non-empty = a staging safety net. */
  allowedRecipients: string[];
  dryRun: boolean;
}

export interface EmailAttachment {
  filename: string;
  content: Buffer | string;
  contentType?: string;
}

/**
 * One provider-agnostic message shape for the whole system. Callers never see
 * the Resend SDK, so swapping providers later is a change to this file only.
 */
export interface EmailMessage {
  /** Address, array of addresses, or a comma-separated string. */
  to: string | string[];
  subject: string;
  /** At least one of html/text is required; text is derived from html if absent. */
  html?: string;
  text?: string;
  cc?: string | string[];
  bcc?: string | string[];
  /** Overrides EMAIL_REPLY_TO for this message. */
  replyTo?: string | string[];
  /** Resend tags, for filtering in the dashboard (e.g. `{name:'kind',value:'rfq-invite'}`). */
  tags?: { name: string; value: string }[];
  attachments?: EmailAttachment[];
  headers?: Record<string, string>;
  /**
   * Makes a retry safe: Resend returns the original send for a repeated key
   * instead of mailing the recipient twice. Phase 2 callers that resend an
   * invite on a retried request should pass a stable key.
   */
  idempotencyKey?: string;
}

/** Why a send returned without a provider call. Never an error condition. */
export type EmailSkipReason = 'suppressed-by-allowlist' | 'dry-run';

export interface EmailSendResult {
  /** Provider message id, or null when the send was skipped. */
  id: string | null;
  recipients: string[];
  /** Recipients dropped by EMAIL_ALLOWED_RECIPIENTS. */
  blocked: string[];
  skipped?: EmailSkipReason;
}

export interface EmailDomainRecordStatus {
  type: string;
  name: string;
  status: string;
}

export interface EmailDomainStatus {
  id: string;
  name: string;
  status: string;
  records: EmailDomainRecordStatus[];
}

/**
 * The single shared email sender. Every feature that mails anyone goes through
 * this service — one implementation, not one per module (the same discipline as
 * postJournalTx for finance and token-invite.ts for invite links).
 *
 * Configuration is optional, exactly like R2 and Gotenberg: with no
 * RESEND_API_KEY the app boots normally and only an actual send fails, with a
 * message naming the missing vars.
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly cfg: EmailConfig;
  private client: Resend | null = null;

  constructor(config: ConfigService) {
    this.cfg = config.get<EmailConfig>('email') ?? {
      allowedRecipients: [],
      dryRun: false,
    };
    if (!this.cfg.apiKey || !this.cfg.from) {
      this.logger.warn(
        'Email sending is disabled — set RESEND_API_KEY and EMAIL_FROM to enable it.',
      );
    } else if (!isValidEmailAddress(this.cfg.from)) {
      // Reachable only if env validation was bypassed; still worth saying
      // loudly at boot rather than at the first send.
      this.logger.error(
        `EMAIL_FROM is not a valid address: "${this.cfg.from}". Use "Name <sender@your-domain>" or "sender@your-domain".`,
      );
    }
    if (this.cfg.dryRun) {
      this.logger.warn(
        'EMAIL_DRY_RUN is on — emails are logged, not delivered.',
      );
    }
    if (this.cfg.allowedRecipients.length > 0) {
      this.logger.log(
        `Email recipients restricted to: ${this.cfg.allowedRecipients.join(', ')}`,
      );
    }
  }

  /**
   * True when credentials and a valid sender are present, i.e. a send will be
   * attempted rather than rejected. Independent of dryRun on purpose: dry-run
   * exercises the whole path, it just stops short of delivery.
   */
  isConfigured(): boolean {
    return Boolean(
      this.cfg.apiKey && this.cfg.from && isValidEmailAddress(this.cfg.from),
    );
  }

  /** The configured sender, for diagnostics and templates that quote it. */
  get fromAddress(): string | undefined {
    return this.cfg.from;
  }

  get dryRun(): boolean {
    return this.cfg.dryRun;
  }

  get allowedRecipients(): string[] {
    return [...this.cfg.allowedRecipients];
  }

  /**
   * Sends an email, throwing on any failure. Use this when the send IS the
   * operation the user asked for (a "resend invite" button, the test endpoint)
   * so the failure surfaces instead of vanishing into the log.
   */
  async send(message: EmailMessage): Promise<EmailSendResult> {
    const from = this.requireFrom();
    const html = message.html;
    const text = message.text ?? (html ? plainTextFrom(html) : undefined);
    if (!html && !text) {
      throw new InternalServerErrorException(
        'Email must have html or text content',
      );
    }

    const requested = normalizeRecipients(message.to);
    if (requested.length === 0) {
      throw new InternalServerErrorException('Email has no recipients');
    }
    const { allowed, blocked } = filterRecipients(
      requested,
      this.cfg.allowedRecipients,
    );
    if (allowed.length === 0) {
      // Not an error: the allowlist did its job. Callers see the reason.
      this.logger.warn(
        `Email "${message.subject}" not sent — all recipients blocked by EMAIL_ALLOWED_RECIPIENTS: ${blocked.join(', ')}`,
      );
      return {
        id: null,
        recipients: [],
        blocked,
        skipped: 'suppressed-by-allowlist',
      };
    }

    if (this.cfg.dryRun) {
      this.logger.log(
        `[dry-run] "${message.subject}" → ${allowed.join(', ')} (from ${from})`,
      );
      return { id: null, recipients: allowed, blocked, skipped: 'dry-run' };
    }

    const payload: CreateEmailOptions = {
      from,
      to: allowed,
      subject: message.subject,
      // text is always populated (derived from html when not supplied), which
      // is also what satisfies Resend's "at least one body" requirement.
      text: text as string,
      html,
      cc: message.cc ? normalizeRecipients(message.cc) : undefined,
      bcc: message.bcc ? normalizeRecipients(message.bcc) : undefined,
      replyTo: message.replyTo ?? this.cfg.replyTo,
      tags: message.tags,
      headers: message.headers,
      attachments: message.attachments?.map((attachment) => ({
        filename: attachment.filename,
        content: attachment.content,
        contentType: attachment.contentType,
      })),
    };

    // The SDK RETURNS provider errors rather than throwing them, so an
    // unchecked `error` would look exactly like a successful send.
    const { data, error } = await this.getClient().emails.send(
      payload,
      message.idempotencyKey
        ? { idempotencyKey: message.idempotencyKey }
        : undefined,
    );
    if (error || !data) {
      const detail = error?.message ?? 'unknown provider error';
      this.logger.error(
        `Email send failed ("${message.subject}" → ${allowed.join(', ')}): ${detail}`,
      );
      throw new InternalServerErrorException(`Email send failed: ${detail}`);
    }

    this.logger.log(
      `Sent "${message.subject}" → ${allowed.join(', ')} (id ${data.id})`,
    );
    return { id: data.id, recipients: allowed, blocked };
  }

  /**
   * Best-effort send: logs and returns null instead of throwing. Use this when
   * email is a side effect of a business action — a failed notification must
   * never roll back an approved offer letter or a saved qualification.
   *
   * Mirrors the deliberate strict/best-effort pair in VaultStorageService
   * (deleteObject vs deleteObjectStrict).
   */
  async trySend(
    message: EmailMessage,
    context?: string,
  ): Promise<EmailSendResult | null> {
    try {
      return await this.send(message);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Email skipped${context ? ` (${context})` : ''}: "${message.subject}" — ${detail}`,
      );
      return null;
    }
  }

  /**
   * Sending-domain status straight from the provider, including the per-record
   * SPF/DKIM state — this is what proves DNS is actually verified rather than
   * merely added. domains.list() omits the records, so each domain is fetched.
   */
  async describeDomains(): Promise<EmailDomainStatus[]> {
    const client = this.getClient();
    const { data, error } = await client.domains.list();
    if (error) {
      throw new InternalServerErrorException(
        `Could not list sending domains: ${error.message}`,
      );
    }
    const domains = data?.data ?? [];
    const detailed = await Promise.all(
      domains.map(async (domain) => {
        const detail = await client.domains.get(domain.id);
        const records = (detail.data?.records ?? []).map((record) => ({
          type: String(record.type),
          name: String(record.name),
          status: String(record.status),
        }));
        return {
          id: domain.id,
          name: domain.name,
          status: String(domain.status),
          records,
        };
      }),
    );
    return detailed;
  }

  private requireFrom(): string {
    if (!this.cfg.apiKey || !this.cfg.from) {
      throw new InternalServerErrorException(
        'Email sending is not configured (set RESEND_API_KEY, EMAIL_FROM)',
      );
    }
    if (!isValidEmailAddress(this.cfg.from)) {
      throw new InternalServerErrorException(
        'EMAIL_FROM is not a valid sender address',
      );
    }
    return this.cfg.from;
  }

  private getClient(): Resend {
    if (!this.cfg.apiKey) {
      throw new InternalServerErrorException(
        'Email sending is not configured (set RESEND_API_KEY, EMAIL_FROM)',
      );
    }
    if (!this.client) {
      this.client = new Resend(this.cfg.apiKey);
    }
    return this.client;
  }
}
