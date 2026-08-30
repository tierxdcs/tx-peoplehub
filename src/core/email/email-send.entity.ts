import { ApiProperty } from '@nestjs/swagger';
import type { EmailSendResult } from './email.service';

/**
 * What an endpoint returns after asking EmailService to send something. Shared
 * by every feature that exposes a "send this email" action, so the frontend has
 * one shape to render — including the two ways a send can succeed without being
 * delivered (dry-run, recipient allowlist).
 */
export class EmailSendResultEntity {
  @ApiProperty({
    type: [String],
    description: 'Addresses the provider accepted (empty when skipped)',
  })
  recipients!: string[];

  @ApiProperty({
    type: [String],
    description: 'Addresses dropped by EMAIL_ALLOWED_RECIPIENTS',
  })
  blocked!: string[];

  @ApiProperty({ nullable: true, description: 'Provider message id' })
  messageId!: string | null;

  @ApiProperty({
    nullable: true,
    description: "'dry-run' | 'suppressed-by-allowlist' | null",
  })
  skipped!: string | null;

  constructor(p: Partial<EmailSendResultEntity>) {
    Object.assign(this, p);
  }

  static from(result: EmailSendResult): EmailSendResultEntity {
    return new EmailSendResultEntity({
      recipients: result.recipients,
      blocked: result.blocked,
      messageId: result.id,
      skipped: result.skipped ?? null,
    });
  }
}
