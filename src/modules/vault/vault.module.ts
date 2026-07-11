import { Module } from '@nestjs/common';
import { EmployeesModule } from '../employees/employees.module';
import { VaultAccessService } from './vault-access.service';
import { VaultFoldersController } from './vault-folders.controller';
import { VaultFoldersService } from './vault-folders.service';
import { VaultStorageService } from './vault-storage.service';
import { VaultFilesController } from './vault-files.controller';
import { VaultFilesService } from './vault-files.service';
import { VaultSharesService } from './vault-shares.service';
import { VaultPreviewService } from './vault-preview.service';
import { VaultExternalShareService } from './vault-external-share.service';
import { VaultShareLinksController } from './vault-share-links.controller';
import { VaultPublicController } from './vault-public.controller';

/**
 * Vault document management.
 * - Phase 1: folder model, computed permissions, personal folders. Imports
 *   EmployeesModule for getTeamIds() — the shared recursive-hierarchy lookup
 *   TEAM-scope rides on (same path as Leave/Attendance and Sales).
 * - Phase 2: file storage on Cloudflare R2 (presigned URLs; the backend never
 *   streams bytes) + append-only version control with retention pruning.
 * - Phase 3: default-folder seed (in prisma/seed.ts) + additive internal
 *   sharing folded into VaultAccessService.
 * - Phase 4: per-version preview pipeline (VaultPreviewService) — native
 *   types READY immediately, Office docs converted to PDF via a separate
 *   Gotenberg service, everything else NOT_APPLICABLE.
 * - Phase 5: public external share links (VIEW-only, version-pinned, expiring,
 *   password-optional, access-logged) via VaultPublicController's
 *   unauthenticated route, plus upload guardrails (extension/size/quota).
 */
@Module({
  imports: [EmployeesModule],
  controllers: [
    VaultFoldersController,
    VaultFilesController,
    VaultShareLinksController,
    VaultPublicController,
  ],
  providers: [
    VaultAccessService,
    VaultFoldersService,
    VaultStorageService,
    VaultFilesService,
    VaultSharesService,
    VaultPreviewService,
    VaultExternalShareService,
  ],
  exports: [VaultAccessService, VaultStorageService],
})
export class VaultModule {}
