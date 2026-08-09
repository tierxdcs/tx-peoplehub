import { Module } from '@nestjs/common';
import { SalesModule } from '../sales/sales.module';
import { CandidateRequisitionsController } from './candidate-requisitions.controller';
import { CandidateRequisitionsService } from './candidate-requisitions.service';

@Module({ imports: [SalesModule], controllers: [CandidateRequisitionsController], providers: [CandidateRequisitionsService], exports: [CandidateRequisitionsService] })
export class CandidateRequisitionsModule {}
