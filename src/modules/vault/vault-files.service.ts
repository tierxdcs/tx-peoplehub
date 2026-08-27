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
  VaultShareResourceType,
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
  VaultBrowseQueryDto,
  VaultFileOrigin,
  VaultSearchQueryDto,
  VaultSearchScope,
  VaultSortOption,
} from './dto/vault-search-query.dto';
import {
  DownloadUrlResponseEntity,
  UploadUrlResponseEntity,
  VaultFileEntity,
  VaultFileListItemEntity,
  VaultFileVersionEntity,
  VaultSearchResultEntity,
  ViewUrlResponseEntity,
} from './entities/vault-file.entity';
import {
  VaultAccessEntity,
  VaultFolderEntity,
} from './entities/vault-folder.entity';
import { VaultAccess, VaultAccessService } from './vault-access.service';
import { VaultFoldersService } from './vault-folders.service';
import {
  FILE_TYPE_SORT_ORDER,
  VAULT_SEARCH_MIN_SCORE,
  classifyVaultFileType,
  deriveVaultFileOrigin,
  normaliseVaultTerm,
  vaultFuzzyScore,
} from './vault-search';
import { VaultStorageService } from './vault-storage.service';
import { VaultPreviewService } from './vault-preview.service';

type FolderWithPermissions = VaultFolder & {
  permissions: VaultFolderPermission[];
};

/**
 * Upper bound on how many candidate file rows one browse/search request pulls
 * into memory for filtering, fuzzy matching and sorting. Vault holds documents,
 * not events, so a real folder or vault-wide search is orders of magnitude
 * below this — but the cap means a pathological folder can never turn a search
 * box into an unbounded query, and hitting it is REPORTED (truncated: true)
 * instead of silently trimming the result.
 */
const MAX_FILE_SCAN = 2_000;

/**
 * Everything a list row needs in one round trip: all versions (the current one
 * supplies size/mime/preview/uploader, and the row count is the version count),
 * plus the four back-relations that identify an auto-filed document. `take: 1`
 * on the to-many ones because only their existence matters.
 */
const FILE_RELATION_INCLUDE = {
  versions: {
    select: {
      id: true,
      mimeType: true,
      sizeBytes: true,
      previewStatus: true,
      uploadedById: true,
      createdAt: true,
    },
  },
  designDocuments: { select: { id: true }, take: 1 },
  leadAttachments: { select: { id: true }, take: 1 },
  vendorSignedNda: { select: { id: true } },
  ndaTemplateConfig: { select: { id: true } },
} satisfies Prisma.VaultFileInclude;

type QueriedFile = Prisma.VaultFileGetPayload<{
  include: typeof FILE_RELATION_INCLUDE;
}>;

/** The live version among the ones loaded, or null for a version-less file. */
function currentVersionOf(file: QueriedFile) {
  if (!file.currentVersionId) return null;
  return file.versions.find((v) => v.id === file.currentVersionId) ?? null;
}

/** Inclusive range start. A bare date means local midnight, not UTC. */
function rangeStart(value?: string): Date | undefined {
  if (!value) return undefined;
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T00:00:00`)
    : new Date(value);
}

/**
 * Inclusive range end. A bare date covers the WHOLE day — "uploaded up to the
 * 5th" must include a file uploaded at 16:00 on the 5th, which a plain
 * `lte: midnight` would silently exclude.
 */
function rangeEnd(value?: string): Date | undefined {
  if (!value) return undefined;
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T23:59:59.999`)
    : new Date(value);
}

/** Size for sorting. BigInt-as-string, compared numerically, absent = 0. */
function sizeOf(item: VaultFileListItemEntity): bigint {
  return item.sizeBytes ? BigInt(item.sizeBytes) : BigInt(0);
}

/**
 * Standard drive sorting. Every comparator falls back to name A→Z so equal
 * keys (same day, same size, same type) never reshuffle between requests.
 */
function compareListItems(
  a: VaultFileListItemEntity,
  b: VaultFileListItemEntity,
  sort: VaultSortOption,
  scores: Map<string, number>,
): number {
  const byName = a.name.localeCompare(b.name);
  switch (sort) {
    case VaultSortOption.RELEVANCE:
      return (scores.get(b.id) ?? 0) - (scores.get(a.id) ?? 0) || byName;
    case VaultSortOption.NAME_DESC:
      return -byName;
    case VaultSortOption.MODIFIED_DESC:
      return b.updatedAt.getTime() - a.updatedAt.getTime() || byName;
    case VaultSortOption.MODIFIED_ASC:
      return a.updatedAt.getTime() - b.updatedAt.getTime() || byName;
    case VaultSortOption.SIZE_DESC: {
      const diff = sizeOf(b) - sizeOf(a);
      return diff === BigInt(0) ? byName : diff > BigInt(0) ? 1 : -1;
    }
    case VaultSortOption.SIZE_ASC: {
      const diff = sizeOf(a) - sizeOf(b);
      return diff === BigInt(0) ? byName : diff > BigInt(0) ? 1 : -1;
    }
    case VaultSortOption.TYPE_ASC:
      return (
        FILE_TYPE_SORT_ORDER.indexOf(a.fileType) -
          FILE_TYPE_SORT_ORDER.indexOf(b.fileType) || byName
      );
    case VaultSortOption.NAME_ASC:
    default:
      return byName;
  }
}

@Injectable()
export class VaultFilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: VaultAccessService,
    private readonly storage: VaultStorageService,
    private readonly preview: VaultPreviewService,
    private readonly folders: VaultFoldersService,
  ) {}

  /**
   * Trusted module-to-Vault registration path for unauthenticated external
   * workflows. The caller supplies the internal sponsor recorded as uploader;
   * bytes still upload directly to Vault's own storage key and use the same
   * extension/size/actual-size guardrails as an ordinary Vault upload.
   */
  async createManagedUploadUrl(params: {
    folderName: string;
    name: string;
    mimeType: string;
    sizeBytes: number;
    uploadedById: string;
    changeNote: string;
  }) {
    assertExtensionAllowed(params.name);
    assertSizeWithinCap(params.sizeBytes);
    const folder = await this.prisma.vaultFolder.findFirst({
      where: {
        name: params.folderName,
        type: VaultFolderType.DEFAULT,
        visibilityScope: 'COMPANY_WIDE',
        status: VaultFolderStatus.ACTIVE,
      },
    });
    if (!folder) {
      throw new NotFoundException(
        `Default Vault folder "${params.folderName}" is not configured`,
      );
    }
    const fileId = randomUUID();
    const storageKey = this.storage.buildStorageKey(fileId, 1);
    const { url, expiresInSeconds } = await this.storage.createUploadUrl(
      storageKey,
      params.mimeType,
    );
    const created = await this.prisma.$transaction(async (tx) => {
      await tx.vaultFile.create({
        data: {
          id: fileId,
          folderId: folder.id,
          name: params.name,
          uploadedById: params.uploadedById,
          status: VaultFileStatus.PENDING,
        },
      });
      const version = await tx.vaultFileVersion.create({
        data: {
          fileId,
          versionNumber: 1,
          mimeType: params.mimeType,
          sizeBytes: BigInt(params.sizeBytes),
          storageKey,
          previewStatus: PreviewStatus.NOT_APPLICABLE,
          changeNote: params.changeNote,
          uploadedById: params.uploadedById,
        },
      });
      await tx.vaultFile.update({
        where: { id: fileId },
        data: { currentVersionId: version.id },
      });
      return { fileId, versionId: version.id };
    });
    return {
      ...created,
      storageKey,
      uploadUrl: url,
      expiresInSeconds,
    };
  }

  /** Actual-size confirmation for a managed upload; activates the Vault file. */
  async confirmManagedUpload(fileId: string, expectedChangeNote: string) {
    const file = await this.prisma.vaultFile.findUnique({
      where: { id: fileId },
    });
    if (!file || file.status !== VaultFileStatus.PENDING) {
      throw new NotFoundException('Pending Vault upload not found');
    }
    const version = await this.prisma.vaultFileVersion.findFirst({
      where: { fileId, changeNote: expectedChangeNote },
      orderBy: { versionNumber: 'desc' },
    });
    if (!version) throw new NotFoundException('Managed Vault upload not found');
    const head = await this.storage.headObject(version.storageKey);
    if (!head) throw new BadRequestException('Uploaded object not found');
    assertSizeWithinCap(head.sizeBytes);
    if (head.sizeBytes !== Number(version.sizeBytes)) {
      throw new BadRequestException(
        `Uploaded size (${head.sizeBytes}) does not match the declared size (${version.sizeBytes})`,
      );
    }
    await this.prisma.vaultFile.update({
      where: { id: fileId },
      data: { status: VaultFileStatus.ACTIVE },
    });
    await this.preview.initializePreview(version);
    return { fileId, sizeBytes: head.sizeBytes };
  }

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
   * through search, which unions them in.
   *
   * The optional query applies the same filter dimensions and sort options as
   * search (see queryFiles) so the folder view can be filtered and re-sorted
   * without leaving it. With no query it behaves exactly as before: every
   * ACTIVE file in the folder, name A→Z.
   */
  async listFilesInFolder(
    folderId: string,
    user: AuthenticatedUser,
    query: VaultBrowseQueryDto = {},
  ): Promise<VaultFileListItemEntity[]> {
    const folder = await this.getFolderOrThrow(folderId);
    await this.assertCanRead(user, folder);

    const result = await this.queryFiles(user, {
      folders: [folder],
      folderIds: [folder.id],
      query,
      // A folder listing is not a search result page — never drop rows to a
      // page size. The scan cap still applies as a backstop.
      limit: MAX_FILE_SCAN,
    });
    return result.items;
  }

  /**
   * Fuzzy search over file names AND folder names, honouring every filter and
   * sort option (§1–§3).
   *
   * Scope is explicit rather than implied, because "did that search look inside
   * subfolders?" is the classic source of confusion in a nested tree:
   *   FOLDER — the given folder AND everything nested beneath it.
   *   VAULT  — every folder the caller can read.
   *
   * Permission model: candidates come from the folders the caller can read
   * (VaultAccessService.readableFolders, which mirrors the folder browser's own
   * visibility rules), UNION files shared with them individually. That union is
   * exactly what computeFileAccess would allow file-by-file — a file share can
   * only ADD access, never remove it — so search reuses the one access path
   * instead of introducing a second one.
   */
  async search(
    dto: VaultSearchQueryDto,
    user: AuthenticatedUser,
  ): Promise<VaultSearchResultEntity> {
    const readable = await this.access.readableFolders(user);

    // Parent links for EVERY folder, not just readable ones: a readable folder
    // can sit under an un-readable one, and it is still inside the subtree the
    // user asked about.
    const parents = new Map(
      (
        await this.prisma.vaultFolder.findMany({
          select: { id: true, parentFolderId: true },
        })
      ).map((f) => [f.id, f.parentFolderId]),
    );
    const isInSubtree = (folderId: string, rootId: string): boolean => {
      const seen = new Set<string>();
      let at: string | null = folderId;
      while (at && !seen.has(at)) {
        if (at === rootId) return true;
        seen.add(at);
        at = parents.get(at) ?? null;
      }
      return false;
    };

    let scopeFolders = [...readable.values()];
    if (dto.scope === VaultSearchScope.FOLDER) {
      if (!dto.folderId) {
        throw new BadRequestException(
          'folderId is required when scope is FOLDER',
        );
      }
      if (!readable.has(dto.folderId)) {
        // Same message as any other unreadable folder — search must not become
        // a way to tell "exists but forbidden" apart from "does not exist".
        throw new ForbiddenException('You do not have access to this folder');
      }
      scopeFolders = scopeFolders.filter((entry) =>
        isInSubtree(entry.folder.id, dto.folderId as string),
      );
    }

    const normalisedQuery = normaliseVaultTerm(dto.q ?? '');

    // Files shared with the caller directly: included even when their folder is
    // not readable (VAULT scope), or when it sits inside the searched subtree.
    const sharedFileIds = (
      await this.prisma.vaultInternalShare.findMany({
        where: {
          sharedWithEmployeeId: user.id,
          resourceType: VaultShareResourceType.FILE,
        },
        select: { resourceId: true },
      })
    ).map((s) => s.resourceId);

    const fileResult = await this.queryFiles(user, {
      folders: scopeFolders.map((entry) => entry.folder),
      folderIds: scopeFolders.map((entry) => entry.folder.id),
      extraFileIds: sharedFileIds,
      keepExtraFile: (folderId) =>
        dto.scope === VaultSearchScope.VAULT ||
        isInSubtree(folderId, dto.folderId as string),
      query: dto,
      normalisedQuery,
      limit: dto.limit,
    });

    // Folder-name matches come from the same readable set, so a folder the
    // caller cannot open can never appear as a search hit.
    const folders = normalisedQuery
      ? scopeFolders
          .map((entry) => ({
            entry,
            score: vaultFuzzyScore(normalisedQuery, entry.folder.name),
          }))
          .filter(
            (hit) =>
              hit.score >= VAULT_SEARCH_MIN_SCORE &&
              // The folder you are searching inside is not a result of its own
              // search.
              hit.entry.folder.id !== dto.folderId,
          )
          .sort(
            (a, b) =>
              b.score - a.score ||
              a.entry.folder.name.localeCompare(b.entry.folder.name),
          )
          .slice(0, dto.limit)
          .map((hit) => this.toFolderEntity(hit.entry.folder, hit.entry.access))
      : [];

    return new VaultSearchResultEntity({
      folders,
      files: fileResult.items,
      totalFileMatches: fileResult.totalMatches,
      truncated: fileResult.truncated,
    });
  }

  /**
   * Recently touched documents across every folder the caller can read — the
   * "you were just working on this" shortcut on the Vault landing.
   *
   * IMPORTANT (verified against the schema): Vault records no internal access
   * log — the only accessedAt column belongs to VaultExternalAccessLog, which
   * tracks public link hits, not employees opening files. So "recent" here
   * means recently ADDED OR UPDATED (a new version, a restore, a confirmed
   * upload), never "recently viewed", and the UI must say so rather than imply
   * a view history that does not exist.
   */
  async listRecent(
    limit: number,
    user: AuthenticatedUser,
  ): Promise<VaultFileListItemEntity[]> {
    const readable = await this.access.readableFolders(user);
    const sharedFileIds = (
      await this.prisma.vaultInternalShare.findMany({
        where: {
          sharedWithEmployeeId: user.id,
          resourceType: VaultShareResourceType.FILE,
        },
        select: { resourceId: true },
      })
    ).map((s) => s.resourceId);

    const result = await this.queryFiles(user, {
      folders: [...readable.values()].map((entry) => entry.folder),
      folderIds: [...readable.keys()],
      extraFileIds: sharedFileIds,
      query: { sort: VaultSortOption.MODIFIED_DESC },
      limit,
    });
    return result.items;
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
    const withRelations = await this.prisma.vaultFile.findUniqueOrThrow({
      where: { id: file.id },
      include: FILE_RELATION_INCLUDE,
    });
    const [item] = await this.buildListItems(
      [withRelations],
      new Map([[folder.id, folder]]),
      new Map([[file.id, access]]),
    );
    return item;
  }

  /**
   * The one place Vault turns "which folders + which filters + which sort" into
   * rows. Folder listing, search, and recent-files all funnel through it, so a
   * filter can never behave differently depending on how you got there.
   *
   * Split of work between SQL and memory:
   *  - SQL narrows on the things it can do exactly — ACTIVE status, the folder
   *    set (or an individually shared file id), and the upload date range.
   *  - Uploader, file type, origin, fuzzy matching and sorting run in memory,
   *    because each depends on a derived value: the uploader shown is the
   *    CURRENT version's uploader (not the file row's original one), type and
   *    origin are computed (there is no stored column for either), and size
   *    lives on the version. Doing these in memory keeps the filter honest
   *    about what the UI displays.
   *  - MAX_FILE_SCAN bounds that in-memory pass. If it is ever reached the
   *    result reports truncated: true rather than pretending it saw everything.
   */
  private async queryFiles(
    user: AuthenticatedUser,
    opts: {
      folders: FolderWithPermissions[];
      folderIds: string[];
      extraFileIds?: string[];
      /** Whether an individually shared file (folder not in scope) counts. */
      keepExtraFile?: (folderId: string) => boolean;
      query: VaultBrowseQueryDto;
      normalisedQuery?: string;
      limit: number;
    },
  ): Promise<{
    items: VaultFileListItemEntity[];
    totalMatches: number;
    truncated: boolean;
  }> {
    const { query } = opts;
    const extraFileIds = opts.extraFileIds ?? [];
    if (!opts.folderIds.length && !extraFileIds.length) {
      return { items: [], totalMatches: 0, truncated: false };
    }

    const uploadedFrom = rangeStart(query.uploadedFrom);
    const uploadedTo = rangeEnd(query.uploadedTo);

    // Only ACTIVE files. A PENDING file has a presigned URL but was never
    // confirmed — its bytes never landed in storage (e.g. the browser's direct
    // PUT failed or was abandoned), so it is not a real upload and must not
    // appear in a listing looking like one.
    const where: Prisma.VaultFileWhereInput = {
      status: VaultFileStatus.ACTIVE,
      OR: [
        ...(opts.folderIds.length
          ? [{ folderId: { in: opts.folderIds } }]
          : []),
        ...(extraFileIds.length ? [{ id: { in: extraFileIds } }] : []),
      ],
      ...(uploadedFrom || uploadedTo
        ? {
            createdAt: {
              ...(uploadedFrom ? { gte: uploadedFrom } : {}),
              ...(uploadedTo ? { lte: uploadedTo } : {}),
            },
          }
        : {}),
    };

    const scanned = await this.prisma.vaultFile.findMany({
      where,
      include: FILE_RELATION_INCLUDE,
      // Most-recently-touched first, so if the scan cap is ever hit it is the
      // oldest documents that fall outside it, not an arbitrary slice.
      orderBy: { updatedAt: 'desc' },
      take: MAX_FILE_SCAN + 1,
    });
    const truncated = scanned.length > MAX_FILE_SCAN;
    const candidates = truncated ? scanned.slice(0, MAX_FILE_SCAN) : scanned;

    const inScopeFolderIds = new Set(opts.folderIds);
    const extraIdSet = new Set(extraFileIds);
    const keepExtra = opts.keepExtraFile ?? (() => true);

    // Scope pass first: a row outside the caller's scope can never be shown,
    // and dropping it here keeps the folder fetch below to what is really used.
    const inScope = candidates.filter(
      (file) =>
        inScopeFolderIds.has(file.folderId) ||
        (extraIdSet.has(file.id) && keepExtra(file.folderId)),
    );

    // Folder rows for everything in scope — the in-scope ones are already
    // loaded; an individually shared file's folder has to be fetched so its
    // access base and displayed folder name resolve. These are resolved BEFORE
    // the filter pass because origin derivation needs the containing folder:
    // deriving it without one would call every module-filed document MANUAL.
    const folderById = new Map(opts.folders.map((f) => [f.id, f]));
    const missingFolderIds = [
      ...new Set(
        inScope.map((f) => f.folderId).filter((id) => !folderById.has(id)),
      ),
    ];
    if (missingFolderIds.length) {
      const extraFolders = await this.prisma.vaultFolder.findMany({
        where: { id: { in: missingFolderIds } },
        include: { permissions: true },
      });
      for (const folder of extraFolders) folderById.set(folder.id, folder);
    }

    const normalisedQuery = opts.normalisedQuery ?? '';
    const scores = new Map<string, number>();
    const matched = inScope.filter((file) => {
      const currentVersion = currentVersionOf(file);
      if (
        query.uploadedById &&
        (currentVersion?.uploadedById ?? file.uploadedById) !==
          query.uploadedById
      ) {
        return false;
      }
      if (
        query.fileType &&
        classifyVaultFileType(file.name, currentVersion?.mimeType ?? null) !==
          query.fileType
      ) {
        return false;
      }
      // Filtered on the SAME derived value the row displays, folder included,
      // so "show me everything auto-filed from Vendor Qualification" can never
      // disagree with the origin badge on the card.
      if (
        query.origin &&
        this.originOf(file, folderById.get(file.folderId)) !== query.origin
      ) {
        return false;
      }
      if (normalisedQuery) {
        const score = vaultFuzzyScore(normalisedQuery, file.name);
        if (score < VAULT_SEARCH_MIN_SCORE) return false;
        scores.set(file.id, score);
      }
      return true;
    });

    const accessById = await this.access.computeFileAccessMany(
      user,
      matched.map((f) => ({ id: f.id, folderId: f.folderId })),
      [...folderById.values()],
    );

    const sort =
      query.sort ??
      (normalisedQuery ? VaultSortOption.RELEVANCE : VaultSortOption.NAME_ASC);
    const items = await this.buildListItems(matched, folderById, accessById);
    items.sort((a, b) => compareListItems(a, b, sort, scores));

    return {
      items: items.slice(0, opts.limit),
      totalMatches: items.length,
      truncated,
    };
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
   * Which module filed a file, from the back-relations loaded with it plus the
   * identity of its folder. The rules themselves live in vault-search.ts; this
   * only feeds them the signals. A missing folder row (shouldn't happen — the
   * FK is Restrict) degrades to MANUAL rather than throwing mid-listing.
   */
  private originOf(file: QueriedFile, folder?: VaultFolder): VaultFileOrigin {
    if (!folder) return VaultFileOrigin.MANUAL;
    return deriveVaultFileOrigin({
      hasDesignDocument: file.designDocuments.length > 0,
      hasLeadAttachment: file.leadAttachments.length > 0,
      hasVendorNda: !!file.vendorSignedNda || !!file.ndaTemplateConfig,
      folderName: folder.name,
      folderType: folder.type,
    });
  }

  /**
   * Build the enriched list rows: the current version's display fields
   * (size/mime/preview/created-at), the version count, the resolved uploader
   * name, the derived type + origin, the containing folder's name, and the
   * caller's computed access. Uploader names are resolved in ONE query for the
   * whole page — a listing costs a fixed number of queries, not a per-row one.
   */
  private async buildListItems(
    files: QueriedFile[],
    folderById: Map<string, FolderWithPermissions | VaultFolder>,
    accessById: Map<string, VaultAccess>,
  ): Promise<VaultFileListItemEntity[]> {
    if (!files.length) return [];

    // Uploader shown is the CURRENT version's uploader — who last put bytes in
    // — falling back to the file's original uploader when there is no version.
    const uploaderIdOf = (file: QueriedFile) =>
      currentVersionOf(file)?.uploadedById ?? file.uploadedById;
    const uploaders = await this.prisma.employee.findMany({
      where: { id: { in: [...new Set(files.map(uploaderIdOf))] } },
      select: { id: true, firstName: true, lastName: true },
    });
    const nameById = new Map(
      uploaders.map((u) => [u.id, `${u.firstName} ${u.lastName}`.trim()]),
    );

    return files.map((file) => {
      const currentVersion = currentVersionOf(file);
      const folder = folderById.get(file.folderId);
      const uploaderId = uploaderIdOf(file);
      return new VaultFileListItemEntity({
        id: file.id,
        folderId: file.folderId,
        folderName: folder?.name ?? null,
        name: file.name,
        currentVersionId: file.currentVersionId,
        status: file.status,
        uploadedById: uploaderId,
        uploadedByName: nameById.get(uploaderId) ?? null,
        sizeBytes: currentVersion ? currentVersion.sizeBytes.toString() : null,
        mimeType: currentVersion?.mimeType ?? null,
        previewStatus: currentVersion?.previewStatus ?? null,
        fileType: classifyVaultFileType(
          file.name,
          currentVersion?.mimeType ?? null,
        ),
        origin: this.originOf(file, folder),
        versionCount: file.versions.length,
        access: new VaultAccessEntity(
          accessById.get(file.id) ?? {
            canRead: false,
            canWrite: false,
            canDelete: false,
            canCreateSubfolder: false,
          },
        ),
        createdAt: file.createdAt,
        // "Last modified" = the live version's creation time when present.
        updatedAt: currentVersion?.createdAt ?? file.updatedAt,
      });
    });
  }

  /** Folder rows in a search result reuse the folders service's own mapping. */
  private toFolderEntity(
    folder: VaultFolder,
    access: VaultAccess,
  ): VaultFolderEntity {
    return this.folders.toEntity(folder, access);
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
