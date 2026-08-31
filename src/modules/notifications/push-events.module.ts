import { Global, Module } from '@nestjs/common';
import { PushEventsService } from './push-events.service';

/**
 * PushEventsService, available everywhere.
 *
 * Global for the same reason PushModule and EmailModule are, only more sharply:
 * nine feature modules fire these events, and NotificationsModule already imports
 * most of those nine to build its pending-approval counters. Putting the service
 * behind an ordinary import edge would mean nine new edges, several of them cycles
 * (OfferLettersModule → this → NotificationsModule → OfferLettersModule), each
 * needing a `forwardRef` to paper over. A global provider that depends only on
 * core (Prisma, PushNotificationService) has no edges to cycle.
 *
 * Deliberately NOT part of NotificationsModule despite living beside it: that
 * module's dependency graph is the reason this one has to be separate.
 */
@Global()
@Module({
  providers: [PushEventsService],
  exports: [PushEventsService],
})
export class PushEventsModule {}
