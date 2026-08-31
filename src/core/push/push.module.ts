import { Global, Module } from '@nestjs/common';
import { PushNotificationService } from './push.service';

/**
 * Global so any feature module can inject PushNotificationService without
 * re-importing it — the same treatment EmailModule and EncryptionModule get.
 * There is exactly one push sender in this system; nothing should construct its
 * own or talk to `web-push` directly.
 *
 * Separate from EmailModule on purpose: push and email are independent channels
 * with independent configuration, and neither should be able to break the other.
 */
@Global()
@Module({
  providers: [PushNotificationService],
  exports: [PushNotificationService],
})
export class PushModule {}
