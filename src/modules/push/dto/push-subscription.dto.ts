import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';

/** base64url, as every push service encodes the subscription keys. */
const BASE64URL = /^[A-Za-z0-9_-]+=*$/;

export class PushSubscriptionKeysDto {
  @ApiProperty({
    description: "The device's public key, from PushManager.subscribe()",
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  @Matches(BASE64URL, { message: 'p256dh must be base64url' })
  p256dh!: string;

  @ApiProperty({ description: "The device's auth secret, from the same call" })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  @Matches(BASE64URL, { message: 'auth must be base64url' })
  auth!: string;
}

/**
 * The `PushSubscription` object the browser produced, forwarded verbatim. We
 * validate its shape only: the values are issued by the push service, and
 * anything we "corrected" would simply stop working.
 */
export class RegisterPushSubscriptionDto {
  @ApiProperty({
    description: 'Push service endpoint URL for this device',
    example: 'https://fcm.googleapis.com/fcm/send/…',
  })
  @IsString()
  // https only: push services are HTTPS endpoints, and accepting anything else
  // would let a caller point us at an arbitrary host.
  @IsUrl({ protocols: ['https'], require_protocol: true, require_tld: false })
  @MaxLength(2000)
  endpoint!: string;

  @ApiProperty({ type: PushSubscriptionKeysDto })
  @IsObject()
  @ValidateNested()
  @Type(() => PushSubscriptionKeysDto)
  keys!: PushSubscriptionKeysDto;

  @ApiPropertyOptional({
    description:
      'Browser user agent, stored so the owner can tell their devices apart.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  userAgent?: string;
}

export class UnsubscribePushQueryDto {
  @ApiProperty({ description: 'Endpoint of the device to unsubscribe' })
  @IsString()
  @MaxLength(2000)
  endpoint!: string;
}

export class PushTestDto {
  @ApiPropertyOptional({
    description: 'Extra line to include in the test notification body.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string;
}
