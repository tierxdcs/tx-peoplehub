import { Module } from '@nestjs/common';
import { EfficiencyController } from './efficiency.controller';
import { EfficiencyService } from './efficiency.service';

@Module({ controllers: [EfficiencyController], providers: [EfficiencyService] })
export class EfficiencyModule {}
