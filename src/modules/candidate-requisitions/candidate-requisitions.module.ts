import { Module } from '@nestjs/common';
import { SalesModule } from '../sales/sales.module';
import { CandidateRequisitionsController } from './candidate-requisitions.controller';
import { CandidateRequisitionsService } from './candidate-requisitions.service';
import {
  CandidateApplicationsController,
  CandidateApplicationsPublicController,
} from './candidate-applications.controller';
import { CandidateApplicationsService } from './candidate-applications.service';
import { VaultStorageService } from '../vault/vault-storage.service';

@Module({
  imports: [SalesModule],
  controllers: [
    CandidateRequisitionsController,
    CandidateApplicationsController,
    CandidateApplicationsPublicController,
  ],
  providers: [
    CandidateRequisitionsService,
    CandidateApplicationsService,
    VaultStorageService,
  ],
  exports: [CandidateRequisitionsService],
})
export class CandidateRequisitionsModule {}
