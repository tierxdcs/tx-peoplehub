import { Module } from '@nestjs/common';
import { VaultModule } from '../vault/vault.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { SupplierController } from './supplier.controller';
import { SupplierPublicController } from './supplier-public.controller';
import { SupplierService } from './supplier.service';
import { SupplierAccessService } from './supplier-access.service';

/**
 * Supplier Qualification (SCM — raw materials). Distinct from Vendor
 * Qualification. Reuses the shared token-invite mechanism, Vault storage +
 * guardrails, and NotificationsModule.
 */
@Module({
  imports: [VaultModule, NotificationsModule],
  controllers: [SupplierController, SupplierPublicController],
  providers: [SupplierService, SupplierAccessService],
})
export class ScmSupplierModule {}
