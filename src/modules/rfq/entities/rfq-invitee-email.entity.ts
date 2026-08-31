import { ApiProperty } from '@nestjs/swagger';

/**
 * Outcome of mailing ONE invitee. An RFQ goes to three or more partners at once,
 * so a per-invitee result is the honest report: one partner's missing email
 * address or one provider rejection must not abort the others, and SCM has to be
 * able to see exactly who was left out and why.
 */
export type RfqInviteeEmailStatus = 'sent' | 'skipped' | 'failed';

export class RfqInviteeEmailResultEntity {
  @ApiProperty() inviteeId!: string;
  @ApiProperty({ nullable: true }) partnerName!: string | null;
  /** The address used, or null when there was nothing usable to send to. */
  @ApiProperty({ nullable: true }) to!: string | null;
  @ApiProperty({ enum: ['sent', 'skipped', 'failed'] })
  status!: RfqInviteeEmailStatus;
  /**
   * Why it was skipped or how it failed; null when sent. Skip reasons:
   * `revoked`, `link-not-issued`, `link-closed`, `deadline-passed`,
   * `already-submitted`, `declined`, `no-contact-email`, plus the email layer's
   * own `dry-run` / `suppressed-by-allowlist`.
   */
  @ApiProperty({ nullable: true }) reason!: string | null;
  @ApiProperty({ nullable: true }) messageId!: string | null;
  /** True when this partner got the revision-request email, not the invitation. */
  @ApiProperty() revisionRequest!: boolean;

  constructor(p: Partial<RfqInviteeEmailResultEntity>) {
    Object.assign(this, p);
  }
}

export class RfqInviteeEmailSummaryEntity {
  @ApiProperty() sent!: number;
  @ApiProperty() skipped!: number;
  @ApiProperty() failed!: number;
  @ApiProperty({ type: [RfqInviteeEmailResultEntity] })
  results!: RfqInviteeEmailResultEntity[];

  constructor(results: RfqInviteeEmailResultEntity[]) {
    this.results = results;
    this.sent = results.filter((r) => r.status === 'sent').length;
    this.skipped = results.filter((r) => r.status === 'skipped').length;
    this.failed = results.filter((r) => r.status === 'failed').length;
  }
}
