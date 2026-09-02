import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';

/**
 * The candidate's own answer to an offer. Recorded by HR — this ERP never talks
 * to the candidate directly, so what is stored is HR's report of a reply that
 * arrived by email or phone.
 */
export class DeclineOfferLetterDto {
  @ApiProperty({
    example: 'Accepted a counter-offer from their current employer.',
    description:
      'Why the candidate declined. REQUIRED — a decline that records no reason teaches the next requisition nothing.',
  })
  @IsString()
  @MaxLength(1000)
  declineReason!: string;
}
