import { Module } from '@nestjs/common';
import { PayrollModule } from '../payroll/payroll.module';
import { OfferLettersController } from './offer-letters.controller';
import { OfferLettersService } from './offer-letters.service';

@Module({
  imports: [PayrollModule],
  controllers: [OfferLettersController],
  providers: [OfferLettersService],
  // Exported so NotificationsModule can reuse the scoped pending-approval count.
  exports: [OfferLettersService],
})
export class OfferLettersModule {}
