import { Module } from '@nestjs/common';
import { VaultModule } from '../vault/vault.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ScmController } from './scm.controller';
import { ScmPublicController } from './scm-public.controller';
import { ScmService } from './scm.service';
import { ScmAccessService } from './scm-access.service';

/**
 * Vendor Qualification (SCM): Vendor Master + self-assessment questionnaire
 * (token-based public form) + weighted internal audit → classification. Imports
 * VaultModule to reuse VaultStorageService + the upload guardrails, and
 * NotificationsModule for the submit notification.
 */
@Module({
  imports: [VaultModule, NotificationsModule],
  controllers: [ScmController, ScmPublicController],
  providers: [ScmService, ScmAccessService],
})
export class ScmModule {}
