import { Module } from '@nestjs/common';
import { BusinessUnitsController } from './business-units.controller';
import { BusinessUnitsService } from './business-units.service';

@Module({
  controllers: [BusinessUnitsController],
  providers: [BusinessUnitsService],
  exports: [BusinessUnitsService],
})
export class BusinessUnitsModule {}
