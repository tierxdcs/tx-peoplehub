import { ApiProperty } from '@nestjs/swagger';

/**
 * Outcome of mailing the application link to ONE candidate. A recruiter sends to
 * a shortlist in a single click, so a per-recipient result is the honest report:
 * one bad address or one provider rejection must not abort the rest, and HR has
 * to be able to see exactly who did not get it and why.
 *
 * Same reasoning as RfqInviteeEmailResultEntity — different noun, and no
 * "skipped because they already responded" cases, because a candidate has no
 * prior state on the requisition.
 */
export type CandidateApplicationEmailStatus = 'sent' | 'skipped' | 'failed';

export class CandidateApplicationEmailResultEntity {
  @ApiProperty() to!: string;
  @ApiProperty({ enum: ['sent', 'skipped', 'failed'] })
  status!: CandidateApplicationEmailStatus;
  /**
   * Why it was held or how it failed; null when sent. Skip reasons come from the
   * email layer itself: `dry-run`, `suppressed-by-allowlist`.
   */
  @ApiProperty({ nullable: true }) reason!: string | null;
  @ApiProperty({ nullable: true }) messageId!: string | null;

  constructor(p: Partial<CandidateApplicationEmailResultEntity>) {
    Object.assign(this, p);
  }
}

export class CandidateApplicationEmailSummaryEntity {
  @ApiProperty() sent!: number;
  @ApiProperty() skipped!: number;
  @ApiProperty() failed!: number;
  @ApiProperty({ type: [CandidateApplicationEmailResultEntity] })
  results!: CandidateApplicationEmailResultEntity[];

  constructor(results: CandidateApplicationEmailResultEntity[]) {
    this.results = results;
    this.sent = results.filter((r) => r.status === 'sent').length;
    this.skipped = results.filter((r) => r.status === 'skipped').length;
    this.failed = results.filter((r) => r.status === 'failed').length;
  }
}
