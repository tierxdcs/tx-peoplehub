import { Module } from '@nestjs/common';
import { PushController } from './push.controller';
import { PushSubscriptionsService } from './push-subscriptions.service';

/**
 * Per-employee push notification devices — a self-service opt-in store, the same
 * shape as NavShortcutsModule.
 *
 * Delivery lives in the global core PushModule (src/core/push); this module is
 * only the HTTP surface for managing one's own subscriptions.
 */
@Module({
  controllers: [PushController],
  providers: [PushSubscriptionsService],
})
export class PushSubscriptionsModule {}
