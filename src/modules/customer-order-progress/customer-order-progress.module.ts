import { Module } from '@nestjs/common';
import { CustomerOrderProgressController } from './customer-order-progress.controller';
import { CustomerOrderProgressService } from './customer-order-progress.service';

@Module({
  controllers: [CustomerOrderProgressController],
  providers: [CustomerOrderProgressService],
})
export class CustomerOrderProgressModule {}
