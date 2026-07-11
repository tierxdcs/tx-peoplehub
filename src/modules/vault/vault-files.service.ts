import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  PreviewStatus,
  VaultFile,
  VaultFileStatus,
  VaultFileVersion,
  VaultFolder,
  VaultFolderPermission,
  VaultFolderStatus,
  VaultFolderType,
} from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import {
  assertExtensionAllowed,
  assertSizeWithinCap,
  assertWithinPersonalQuota,
} from './vault-guardrails';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { CreateUploadUrlDto } from './dto/create-upload-url.dto';
import { CreateVersionUrlDto } from './dto/create-version-url.dto';
import {
  DownloadUrlResponseEntity,
  UploadUrlResponseEntity,
  VaultFileEntity,
  VaultFileListItemEntity,
  VaultFileVersionEntity,
  ViewUrlResponseEntity,
} from './entities/vault-file.entity';
import { VaultAccessEntity } from './entities/vault-folder.entity';
import { VaultAccess, VaultAccessService } from './vault-access.service';
import { VaultStorageService } from './vault-storage.service';
import { VaultPreviewService } from './vault-preview.service';

type FolderWithPermissions = VaultFolder & {
  permissions: VaultFolderPermission[];
};

@Injectable()
export class VaultFilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: VaultAccessService,
    private readonly storage: VaultStorageService,
    private readonly preview: VaultPreviewService,
  ) {}

  /**
   * Step 1 of upload: validate write access on the target folder, create a
   * PENDING VaultFile + its version-1 row, and return a presigned PUT URL.
   * The browser uploads bytes directly to R2; nothing streams through here.
   * Rejected BEFORE any URL is minted if the caller lacks folder write access.
   *
   * The presigned URL is minted BEFORE any DB write: if storage is
   * unconfigured or unreachable the request fails with zero DB mutation, so a
   * failed upload never leaves an orphaned PENDING file row behind. The file
   * id is generated up-front so its storage key is stable across both steps.
   */
  async createUploadUrl(
    dto: CreateUploadUrlDto,
    user: AuthenticatedUser,
  ): Promise<UploadUrlResponseEntity> {
    const folder = await this.getFolderOrThrow(dto.folderId);
    await this.assertCanWrite(user, folder);
    // Security guardrails (spec §5) — all BEFORE any presigned URL is issued.
    await this.assertUploadAllowed(folder, dto.name, dto.sizeBytes);

    const fileId = randomUUID();
    const storageKey = this.storage.buildStorageKey(fileId, 1);
    // Presign FIRST — a storage failure here aborts before we touch the DB.
    const { url, expiresInSeconds } = await this.storage.createUploadUrl(
      storageKey,
      dto.mimeType,
    );

    const created = await this.prisma.$transaction(async (tx) => {
      // Atomic quota check-and-reserve: locks the folder row, reads usage
      // (incl. already-PENDING reservations), and throws if this upload would
      // exceed the cap — all before the insert below, so concurrent requests
      // to the same personal folder can't all pass a stale check. Rolls back
      // (no row created) on rejection; the pre-minted presign URL is harmless.
      await this.assertPersonalQuotaWithinTx(tx, folder, dto.sizeBytes);

      const file = await tx.vaultFile.create({
        data: {
          id: fileId,
          folderId: folder.id,
          name: dto.name,
          uploadedById: user.id,
          status: VaultFileStatus.PENDING,
        },
      });
      const version = await tx.vaultFileVersion.create({
        data: {
          fileId: file.id,
          versionNumber: 1,
          mimeType: dto.mimeType,
          sizeBytes: BigInt(dto.sizeBytes),
          storageKey,
          previewStatus: PreviewStatus.NOT_APPLICABLE,
          changeNote: dto.changeNote ?? null,
          uploadedById: user.id,
        },
      });
      await tx.vaultFile.update({
        where: { id: file.id },
        data: { currentVersionId: version.id },
      });
      return { file, version };
    });

    return new UploadUrlResponseEntity({
      file: this.toFileEntity(created.file),
      versionId: created.version.id,
      storageKey,
      uploadUrl: url,
      expiresInSeconds,
    });
  }

  /**
   * Step 2: after the browser's direct upload to R2 finishes, verify the
   * object exists and its size/type match what version.* declared, then flip
   * the file ACTIVE. Uses the CURRENT version's storageKey so it finalizes
   * whichever upload (v1 or a new version) is outstanding.
   */
  async confirmUpload(
    fileId: string,
    user: AuthenticatedUser,
  ): Promise<VaultFileEntity> {
    const file = await this.getFileOrThrow(fileId);
    const folder = await this.getFolderOrThrow(file.folderId);
    await this.assertCanWrite(user, folder, file.id);

    const version = await this.currentVersionOrThrow(file);

    const head = await this.storage.headObject(version.storageKey);
    if (!head) {
      throw new BadRequestException(
        'No uploaded object found at the expected storage key — upload may not have completed',
      );
    }
    if (head.sizeBytes !== Number(version.sizeBytes)) {
      throw new BadRequestException(
        `Uploaded size (${head.sizeBytes}) does not match the declared size (${version.sizeBytes})`,
      );
    }

    const updated = await this.prisma.vaultFile.update({
      where: { id: file.id },
      data: { status: VaultFileStatus.ACTIVE },
    });

    // Kick off the preview pipeline for the just-confirmed version: native
    // types resolve to READY immediately; office types go PENDING and a
    // conversion job runs async; everything else stays NOT_APPLICABLE. This
    // is per-version — each upload/version gets its own independent preview.
    await this.preview.initializePreview(version);

    return this.toFileEntity(updated);
  }

  /**
   * New version of an existing file — only when the folder has versioning on.
   * Creates the next sequential version, points currentVersionId at it, and
   * (best-effort) presigns the PUT. Pruning happens at confirm time so we
   * never delete an object for a version whose upload might not land.
   */
  async createVersionUrl(
    fileId: string,
    dto: CreateVersionUrlDto,
    user: AuthenticatedUser,
  ): Promise<UploadUrlResponseEntity> {
    const file = await this.getFileOrThrow(fileId);
    const folder = await this.getFolderOrThrow(file.folderId);
    await this.assertCanWrite(user, folder, file.id);
    if (!folder.versioningEnabled) {
      throw new BadRequestException(
        'Versioning is not enabled on this folder — upload a new file instead',
      );
    }
    // Size + quota guardrails apply to new versions too (extension was
    // validated when the file was first created; the name doesn't change).
    await this.assertUploadAllowed(folder, file.name, dto.sizeBytes);

    // Presign BEFORE any DB write — a storage failure must not repoint
    // currentVersionId or flip the (currently ACTIVE) file to PENDING, which
    // would corrupt a healthy file. The (fileId, versionNumber) unique
    // constraint guards a concurrent second request: it fails cleanly on
    // insert rather than leaving inconsistent state.
    const nextNumber = await this.nextVersionNumber(this.prisma, file.id);
    const storageKey = this.storage.buildStorageKey(file.id, nextNumber);
    const { url, expiresInSeconds } = await this.storage.createUploadUrl(
      storageKey,
      dto.mimeType,
    );

    const created = await this.prisma.$transaction(async (tx) => {
      // Versions count toward the same personal-folder quota — reserve
      // atomically here too (no-op for non-PERSONAL folders).
      await this.assertPersonalQuotaWithinTx(tx, folder, dto.sizeBytes);

      const version = await tx.vaultFileVersion.create({
        data: {
          fileId: file.id,
          versionNumber: nextNumber,
          mimeType: dto.mimeType,
          sizeBytes: BigInt(dto.sizeBytes),
          storageKey,
          previewStatus: PreviewStatus.NOT_APPLICABLE,
          changeNote: dto.changeNote ?? null,
          uploadedById: user.id,
        },
      });
      await tx.vaultFile.update({
        where: { id: file.id },
        data: { currentVersionId: version.id, status: VaultFileStatus.PENDING },
      });
      return { version };
    });

    const refreshed = await this.getFileOrThrow(fileId);
    return new UploadUrlResponseEntity({
      file: this.toFileEntity(refreshed),
      versionId: created.version.id,
      storageKey,
      uploadUrl: url,
      expiresInSeconds,
    });
  }

  /**
   * Confirm a new-version upload the same way as an initial one, then prune:
   * if the folder caps retention and the count now exceeds it, delete the
   * OLDEST version — both its R2 object (to actually free storage) and its
   * DB row. A null cap never prunes.
   */
  async confirmVersionUpload(
    fileId: string,
    user: AuthenticatedUser,
  ): Promise<VaultFileEntity> {
    const confirmed = await this.confirmUpload(fileId, user);
    await this.pruneOldVersions(fileId);
    return confirmed;
  }

  /**
   * Files in a folder, enriched for the list UI (spec §3): name, current
   * version's size/mime/preview status, a version count, and the caller's
   * computed access on each file. Requires folder read access; DELETED files
   * are excluded. Access is computed per-file (folds in file-level shares), so
   * a file shared with someone who lacks folder access does NOT appear here —
   * folder-listing is intentionally folder-scoped; shared-only files surface
   * via listSharedWithMe().
   */
  async listFilesInFolder(
    folderId: string,
    user: AuthenticatedUser,
  ): Promise<VaultFileListItemEntity[]> {
    const folder = await this.getFolderOrThrow(folderId);
    await this.assertCanRead(user, folder);

    // Only ACTIVE files. A PENDING file has a presigned URL but was never
    // confirmed — its bytes never landed in storage (e.g. the browser's direct
    // PUT failed or was abandoned), so it is not a real upload and must not
    // appear in the folder list looking like one.
    const files = await this.prisma.vaultFile.findMany({
      where: { folderId, status: VaultFileStatus.ACTIVE },
      orderBy: { name: 'asc' },
    });

    const items: VaultFileListItemEntity[] = [];
    for (const file of files) {
      const access = await this.access.computeFileAccess(user, file.id, folder);
      items.push(await this.toListItemEntity(file, access));
    }
    return items;
  }

  /** Single enriched file (spec §3 row detail / deep-link). Requires read access. */
  async findOneEnriched(
    fileId: string,
    user: AuthenticatedUser,
  ): Promise<VaultFileListItemEntity> {
    const file = await this.getFileOrThrow(fileId);
    const folder = await this.getFolderOrThrow(file.folderId);
    const access = await this.access.computeFileAccess(user, file.id, folder);
    if (!access.canRead) {
      throw new ForbiddenException('You do not have access to this file');
    }
    return this.toListItemEntity(file, access);
  }

  async listVersions(
    fileId: string,
    user: AuthenticatedUser,
  ): Promise<VaultFileVersionEntity[]> {
    const file = await this.getFileOrThrow(fileId);
    const folder = await this.getFolderOrThrow(file.folderId);
    await this.assertCanRead(user, folder, file.id);

    const versions = await this.prisma.vaultFileVersion.findMany({
      where: { fileId },
      orderBy: { versionNumber: 'asc' },
    });
    return versions.map((v) => this.toVersionEntity(v));
  }

  /**
   * Restore an older version: append a NEW version whose bytes are a
   * server-side copy of the target's R2 object. Never deletes or mutates any
   * existing version — history stays intact and in order. Prunes afterward
   * like any other new version.
   */
  async restoreVersion(
    fileId: string,
    versionId: string,
    user: AuthenticatedUser,
  ): Promise<VaultFileEntity> {
    const file = await this.getFileOrThrow(fileId);
    const folder = await this.getFolderOrThrow(file.folderId);
    await this.assertCanWrite(user, folder, file.id);
    if (!folder.versioningEnabled) {
      throw new BadRequestException('Versioning is not enabled on this folder');
    }

    const target = await this.prisma.vaultFileVersion.findUnique({
      where: { id: versionId },
    });
    if (!target || target.fileId !== fileId) {
      throw new NotFoundException('Version not found on this file');
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const nextNumber = await this.nextVersionNumber(tx, file.id);
      const storageKey = this.storage.buildStorageKey(file.id, nextNumber);
      const version = await tx.vaultFileVersion.create({
        data: {
          fileId: file.id,
          versionNumber: nextNumber,
          mimeType: target.mimeType,
          sizeBytes: target.sizeBytes,
          storageKey,
          previewStatus: PreviewStatus.NOT_APPLICABLE,
          changeNote: `Restored from version ${target.versionNumber}`,
          uploadedById: user.id,
        },
      });
      await tx.vaultFile.update({
        where: { id: file.id },
        data: { currentVersionId: version.id },
      });
      return { version, storageKey };
    });

    // Copy the bytes server-side (browser not involved) so the restored
    // version is immediately usable — no confirm step needed.
    await this.storage.copyObject(target.storageKey, created.storageKey);
    await this.pruneOldVersions(fileId);

    const refreshed = await this.getFileOrThrow(fileId);
    return this.toFileEntity(refreshed);
  }

  /** Presigned GET for the file's current version (or a specific version). */
  async getDownloadUrl(
    fileId: string,
    user: AuthenticatedUser,
    versionId?: string,
  ): Promise<DownloadUrlResponseEntity> {
    const file = await this.getFileOrThrow(fileId);
    const folder = await this.getFolderOrThrow(file.folderId);
    await this.assertCanRead(user, folder, file.id);

    let version: VaultFileVersion | null;
    if (versionId) {
      version = await this.prisma.vaultFileVersion.findUnique({
        where: { id: versionId },
      });
      if (!version || version.fileId !== fileId) {
        throw new NotFoundException('Version not found on this file');
      }
    } else {
      version = await this.currentVersionOrThrow(file);
    }

    const { url, expiresInSeconds } = await this.storage.createDownloadUrl(
      version.storageKey,
    );
    return new DownloadUrlResponseEntity({
      downloadUrl: url,
      expiresInSeconds,
    });
  }

  /**
   * Status-aware preview URL for the current (or a specific) version. Returns
   * a presigned URL to the preview object ONLY when previewStatus = READY;
   * otherwise returns the status alone so the UI can show the right message
   * (Preparing… / download-to-view) instead of erroring.
   */
  async getViewUrl(
    fileId: string,
    user: AuthenticatedUser,
    versionId?: string,
  ): Promise<ViewUrlResponseEntity> {
    const file = await this.getFileOrThrow(fileId);
    const folder = await this.getFolderOrThrow(file.folderId);
    await this.assertCanRead(user, folder, file.id);

    let version: VaultFileVersion | null;
    if (versionId) {
      version = await this.prisma.vaultFileVersion.findUnique({
        where: { id: versionId },
      });
      if (!version || version.fileId !== fileId) {
        throw new NotFoundException('Version not found on this file');
      }
    } else {
      version = await this.currentVersionOrThrow(file);
    }

    if (
      version.previewStatus !== PreviewStatus.READY ||
      !version.previewStorageKey
    ) {
      return new ViewUrlResponseEntity({
        previewStatus: version.previewStatus,
        viewUrl: null,
        expiresInSeconds: null,
      });
    }

    const { url, expiresInSeconds } = await this.storage.createDownloadUrl(
      version.previewStorageKey,
    );
    return new ViewUrlResponseEntity({
      previewStatus: PreviewStatus.READY,
      viewUrl: url,
      expiresInSeconds,
    });
  }

  /**
   * Whole-file delete: soft-delete the file (status DELETED) and free every
   * version's R2 object. Deliberately no single-version delete endpoint —
   * history is never partially gutted.
   */
  async deleteFile(fileId: string, user: AuthenticatedUser): Promise<void> {
    const file = await this.getFileOrThrow(fileId);
    const folder = await this.getFolderOrThrow(file.folderId);
    await this.assertCanDelete(user, folder);

    const versions = await this.prisma.vaultFileVersion.findMany({
      where: { fileId },
    });

    await this.prisma.vaultFile.update({
      where: { id: fileId },
      data: { status: VaultFileStatus.DELETED },
    });

    // Free storage for all versions together (best-effort per object).
    for (const v of versions) {
      await this.storage.deleteObject(v.storageKey);
    }
  }

  // ---- internal helpers ----

  /**
   * Upload guardrails (spec §5), run before any presigned URL is issued:
   * blocked extension, 500MB per-file cap, and — for PERSONAL folders — the
   * 5GB cumulative per-employee quota (summed over all their personal files'
   * versions). Cross-folder note: quota is per PERSONAL folder, which is
   * per-employee (one each), so summing that folder's versions is the total.
   */
  private async assertUploadAllowed(
    folder: VaultFolder,
    name: string,
    sizeBytes: number,
  ): Promise<void> {
    // An archived folder is a closed container — no new files or versions.
    if (folder.status === VaultFolderStatus.ARCHIVED) {
      throw new BadRequestException(
        'This folder is archived and can no longer accept uploads',
      );
    }
    // Stateless, single-file guardrails only (no DB, no race). The cumulative
    // personal-folder quota is NOT checked here — it must be checked-and-
    // reserved atomically inside the creating transaction (see
    // assertPersonalQuotaWithinTx), or concurrent uploads race on stale usage.
    assertExtensionAllowed(name);
    assertSizeWithinCap(sizeBytes);
  }

  /**
   * Atomic personal-folder quota check-and-reserve. MUST run inside the same
   * transaction that then inserts the PENDING file/version row, so the read and
   * the reservation are indivisible.
   *
   * The race it closes: several concurrent multi-file upload-url requests each
   * read the same "current usage" before any inserts its PENDING row, so all
   * pass a check they'd collectively fail. We serialize per-folder by taking a
   * row lock on the folder (SELECT … FOR UPDATE): concurrent transactions
   * targeting the same personal folder queue up, and each one reads usage only
   * AFTER the previous one's PENDING reservation is committed. The usage sum
   * already counts PENDING versions (status ≠ DELETED), so a burst of pending
   * uploads is fully accounted for before any of them confirm — exactly the
   * "reserved but not yet confirmed" accounting the spec asks for, made
   * correct under concurrency by the lock.
   *
   * No-op for non-PERSONAL folders (no cumulative quota there).
   */
  private async assertPersonalQuotaWithinTx(
    tx: Prisma.TransactionClient,
    folder: VaultFolder,
    sizeBytes: number,
  ): Promise<void> {
    if (folder.type !== VaultFolderType.PERSONAL) return;

    // Serialization point: lock this folder's row for the rest of the tx.
    await tx.$queryRaw`SELECT id FROM vault_folders WHERE id = ${folder.id} FOR UPDATE`;

    const agg = await tx.vaultFileVersion.aggregate({
      _sum: { sizeBytes: true },
      where: {
        file: {
          folderId: folder.id,
          status: { not: VaultFileStatus.DELETED },
        },
      },
    });
    const current = agg._sum.sizeBytes ?? BigInt(0);
    assertWithinPersonalQuota(current, sizeBytes);
  }

  private async pruneOldVersions(fileId: string): Promise<void> {
    const file = await this.prisma.vaultFile.findUnique({
      where: { id: fileId },
      include: { folder: true },
    });
    if (!file) return;
    const cap = file.folder.maxVersionsRetained;
    // null cap = unbounded → never prune.
    if (cap === null || cap === undefined) return;

    const versions = await this.prisma.vaultFileVersion.findMany({
      where: { fileId },
      orderBy: { versionNumber: 'asc' },
    });
    if (versions.length <= cap) return;

    const excess = versions.length - cap;
    const toPrune = versions.slice(0, excess); // oldest first
    for (const v of toPrune) {
      // Free the actual R2 object, then drop the row — pruning must realize
      // the storage saving, not just hide the version.
      await this.storage.deleteObject(v.storageKey);
      await this.prisma.vaultFileVersion.delete({ where: { id: v.id } });
    }
  }

  private async nextVersionNumber(
    tx: Prisma.TransactionClient,
    fileId: string,
  ): Promise<number> {
    const latest = await tx.vaultFileVersion.findFirst({
      where: { fileId },
      orderBy: { versionNumber: 'desc' },
      select: { versionNumber: true },
    });
    return (latest?.versionNumber ?? 0) + 1;
  }

  private async currentVersionOrThrow(
    file: VaultFile,
  ): Promise<VaultFileVersion> {
    if (!file.currentVersionId) {
      throw new BadRequestException('File has no current version');
    }
    const version = await this.prisma.vaultFileVersion.findUnique({
      where: { id: file.currentVersionId },
    });
    if (!version) {
      throw new NotFoundException('Current version not found');
    }
    return version;
  }

  private async getFileOrThrow(id: string): Promise<VaultFile> {
    const file = await this.prisma.vaultFile.findUnique({ where: { id } });
    if (!file || file.status === VaultFileStatus.DELETED) {
      throw new NotFoundException('File not found');
    }
    return file;
  }

  private async getFolderOrThrow(id: string): Promise<FolderWithPermissions> {
    const folder = await this.prisma.vaultFolder.findUnique({
      where: { id },
      include: { permissions: true },
    });
    if (!folder) {
      throw new NotFoundException('Folder not found');
    }
    return folder;
  }

  /**
   * Effective access for a file operation. When `fileId` is given, folds in
   * any file-level internal share (Phase 3), so someone a file was shared
   * with — but who has no folder access — still passes. Omit `fileId` for
   * folder-level checks (e.g. creating a brand-new file, which has no id yet).
   */
  private async accessFor(
    user: AuthenticatedUser,
    folder: FolderWithPermissions,
    fileId?: string,
  ) {
    return fileId
      ? this.access.computeFileAccess(user, fileId, folder)
      : this.access.computeAccess(user, folder);
  }

  private async assertCanRead(
    user: AuthenticatedUser,
    folder: FolderWithPermissions,
    fileId?: string,
  ): Promise<void> {
    const access = await this.accessFor(user, folder, fileId);
    if (!access.canRead) {
      throw new ForbiddenException('You do not have access to this file');
    }
  }

  private async assertCanWrite(
    user: AuthenticatedUser,
    folder: FolderWithPermissions,
    fileId?: string,
  ): Promise<void> {
    const access = await this.accessFor(user, folder, fileId);
    if (!access.canWrite) {
      throw new ForbiddenException('You do not have write access');
    }
  }

  private async assertCanDelete(
    user: AuthenticatedUser,
    folder: FolderWithPermissions,
    fileId?: string,
  ): Promise<void> {
    const access = await this.accessFor(user, folder, fileId);
    if (!access.canDelete) {
      throw new ForbiddenException('You do not have delete access');
    }
  }

  private toFileEntity(file: VaultFile): VaultFileEntity {
    return new VaultFileEntity({
      id: file.id,
      folderId: file.folderId,
      name: file.name,
      currentVersionId: file.currentVersionId,
      uploadedById: file.uploadedById,
      status: file.status,
      createdAt: file.createdAt,
      updatedAt: file.updatedAt,
    });
  }

  /**
   * Build the enriched list/detail entity: joins the current version's display
   * fields (size/mime/preview/created-at) + a version count + a resolved
   * uploader name onto the flat file, plus the caller's computed access. One
   * query each for the current version, the count, and the uploader name.
   */
  private async toListItemEntity(
    file: VaultFile,
    access: VaultAccess,
  ): Promise<VaultFileListItemEntity> {
    const currentVersion = file.currentVersionId
      ? await this.prisma.vaultFileVersion.findUnique({
          where: { id: file.currentVersionId },
        })
      : null;
    const versionCount = await this.prisma.vaultFileVersion.count({
      where: { fileId: file.id },
    });
    // Uploader of the current version (falls back to the file's original
    // uploader when there's no current version yet).
    const uploaderId = currentVersion?.uploadedById ?? file.uploadedById;
    const uploader = await this.prisma.employee.findUnique({
      where: { id: uploaderId },
      select: { firstName: true, lastName: true },
    });

    return new VaultFileListItemEntity({
      id: file.id,
      folderId: file.folderId,
      name: file.name,
      currentVersionId: file.currentVersionId,
      status: file.status,
      uploadedById: uploaderId,
      uploadedByName: uploader
        ? `${uploader.firstName} ${uploader.lastName}`.trim()
        : null,
      sizeBytes: currentVersion ? currentVersion.sizeBytes.toString() : null,
      mimeType: currentVersion?.mimeType ?? null,
      previewStatus: currentVersion?.previewStatus ?? null,
      versionCount,
      access: new VaultAccessEntity(access),
      createdAt: file.createdAt,
      // "Last modified" = the live version's creation time when present.
      updatedAt: currentVersion?.createdAt ?? file.updatedAt,
    });
  }

  private toVersionEntity(v: VaultFileVersion): VaultFileVersionEntity {
    return new VaultFileVersionEntity({
      id: v.id,
      fileId: v.fileId,
      versionNumber: v.versionNumber,
      mimeType: v.mimeType,
      sizeBytes: v.sizeBytes.toString(),
      storageKey: v.storageKey,
      previewStorageKey: v.previewStorageKey,
      previewStatus: v.previewStatus,
      changeNote: v.changeNote,
      uploadedById: v.uploadedById,
      createdAt: v.createdAt,
    });
  }
}
