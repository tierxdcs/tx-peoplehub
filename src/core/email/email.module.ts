import { Global, Module } from '@nestjs/common';
import { EmailService } from './email.service';

/**
 * Global so any feature module can inject EmailService without re-importing —
 * the same treatment EncryptionModule gets. There is exactly one email sender
 * in this system; nothing should be constructing its own.
 */
@Global()
@Module({
  providers: [EmailService],
  exports: [EmailService],
})
export class EmailModule {}
