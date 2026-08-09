import { Module } from '@nestjs/common';
import { ReferenceRatesController } from './reference-rates.controller';
import { ReferenceRatesService } from './reference-rates.service';

@Module({
  controllers: [ReferenceRatesController],
  providers: [ReferenceRatesService],
})
export class ReferenceRatesModule {}
