import { Module } from '@nestjs/common';
import { QmsController } from './qms.controller';
import { QmsService } from './qms.service';
import { QmsAccessService } from './qms-access.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { BomModule } from '../bom/bom.module';
@Module({
  imports: [NotificationsModule, BomModule],
  controllers: [QmsController],
  providers: [QmsService, QmsAccessService],
  exports: [QmsService, QmsAccessService],
})
export class QmsModule {}
