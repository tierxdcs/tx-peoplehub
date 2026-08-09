import { Module } from '@nestjs/common';
import { EmployeesController } from './employees.controller';
import { EmployeesService } from './employees.service';
import { VaultStorageService } from '../vault/vault-storage.service';
import { ProvisioningModule } from '../provisioning/provisioning.module';

/**
 * VaultStorageService (a thin, stateless R2 presigner depending only on the
 * global ConfigService) is provided directly rather than by importing
 * VaultModule — VaultModule already imports EmployeesModule, so importing it
 * back would create a module cycle. It powers employee-photo uploads.
 */
@Module({
  imports: [ProvisioningModule],
  controllers: [EmployeesController],
  providers: [EmployeesService, VaultStorageService],
  exports: [EmployeesService],
})
export class EmployeesModule {}
