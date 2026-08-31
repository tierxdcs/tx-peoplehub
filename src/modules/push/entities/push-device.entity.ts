import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * One subscribed device, as its owner sees it.
 *
 * The endpoint and encryption keys are deliberately NOT exposed. The owner has
 * no use for them (their browser holds its own copy), and the id is all the UI
 * needs to revoke one.
 */
export class PushDeviceEntity {
  @ApiProperty()
  id!: string;

  @ApiProperty({
    description: 'Friendly name derived from the user agent',
    example: 'iPhone · Safari',
  })
  label!: string;

  @ApiProperty({
    description: 'When notifications were enabled on this device',
  })
  createdAt!: Date;

  @ApiPropertyOptional({
    description:
      'Last notification the push service accepted for this device; null if none yet.',
    nullable: true,
  })
  lastPushAt!: Date | null;
}

/**
 * What the browser needs before it can subscribe, plus whether it is worth
 * offering at all. `publicKey` is null when the server has no VAPID keys — the
 * UI then hides the control rather than showing a button that cannot work.
 */
export class PushConfigEntity {
  @ApiProperty({ description: 'True when the server can actually send a push' })
  configured!: boolean;

  @ApiProperty({
    description:
      'VAPID public key for PushManager.subscribe(). Not a secret — it is handed to every browser by design. Null when push is not configured.',
    nullable: true,
  })
  publicKey!: string | null;
}
