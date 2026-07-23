import { Module } from '@nestjs/common';
import { BomModule } from '../bom/bom.module';
import { PlmAccessService } from './plm-access.service';
import { PlmController } from './plm.controller';
import { PlmService } from './plm.service';
import { VaultModule } from '../vault/vault.module';
import { PlmVendorUpdateService } from './plm-vendor-update.service';
import { PlmPublicController } from './plm-public.controller';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [BomModule, VaultModule, NotificationsModule],
  controllers: [PlmController, PlmPublicController],
  providers: [PlmService, PlmAccessService, PlmVendorUpdateService],
  exports: [PlmService],
})
export class PlmModule {}
