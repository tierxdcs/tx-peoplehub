import { Module } from '@nestjs/common';
import { FinanceModule } from '../finance/finance.module';
import { ArController } from './ar.controller';
import { ArService } from './ar.service';
import { GstGatewayService } from './gst-gateway.service';

@Module({imports:[FinanceModule],controllers:[ArController],providers:[ArService,GstGatewayService]})
export class FinanceArModule {}
