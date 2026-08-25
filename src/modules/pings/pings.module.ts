import { Module } from '@nestjs/common';
import { PingsController } from './pings.controller';
import { PingsService } from './pings.service';

@Module({
  controllers: [PingsController],
  providers: [PingsService],
  // Exported so other modules can raise system-generated pings through the
  // exact same path as user-typed ones (e.g. stale-RFQ notice on BOM revision).
  exports: [PingsService],
})
export class PingsModule {}
