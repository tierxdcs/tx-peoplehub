import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import * as bcrypt from 'bcrypt';
import {
  PreviewStatus,
  VaultExternalShareLink,
  VaultFileStatus,
  VaultFolder,
  VaultFolderPermission,
  VaultFolderType,
  VaultSharePermission,
  VaultShareResourceType,
} from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { CreateShareLinkDto } from './dto/create-share-link.dto';
import {
  PublicSharedResourceEntity,
  VaultExternalShareLinkEntity,
  VaultExternalShareLinkListItemEntity,
} from './entities/vault-external-share.entity';
import { VaultAccessService } from './vault-access.service';
import { VaultStorageService } from './vault-storage.service';

type FolderWithPermissions = VaultFolder & {
  permissions: VaultFolderPermission[];
};

const DEFAULT_EXPIRY_HOURS = 24;

/**
 * External (public, unauthenticated) share links (spec §4.2). A link is a
 * VIEW-only, expiring, optionally password-protected pointer to a resource,
 * addressable by an unguessable random token. For FILE links the current
 * version is PINNED at creation time and served forever after, even once
 * newer versions land. PERSONAL folders can't be link-shared whole (only
 * individual files within). Creating a link requires the creator to already
 * have read access. Every public access attempt is logged (IP/UA), pass/fail.
 */
@Injectable()
export class VaultExternalShareService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: VaultAccessService,
    private readonly storage: VaultStorageService,
  ) {}

  async createFileLink(
    fileId: string,
    dto: CreateShareLinkDto,
    user: AuthenticatedUser,
  ): Promise<VaultExternalShareLinkEntity> {
    const file = await this.prisma.vaultFile.findUnique({
      where: { id: fileId },
    });
    if (!file || file.status === VaultFileStatus.DELETED) {
      throw new NotFoundException('File not found');
    }
    const folder = await this.getFolderOrThrow(file.folderId);
    // WRITE access required — the same bar as upload and internal sharing. A
    // read-only member (e.g. an EMPLOYEE in a VERTICAL/COMPANY_WIDE default
    // folder) can view a file but must not be able to mint a public,
    // unauthenticated link to it.
    const acc = await this.access.computeFileAccess(user, fileId, folder);
    if (!acc.canWrite) {
      throw new ForbiddenException(
        'You need write access to a file to create a share link',
      );
    }
    if (!file.currentVersionId) {
      throw new BadRequestException('File has no current version to share');
    }

    return this.createLink(
      VaultShareResourceType.FILE,
      fileId,
      // PIN the version that is current right now.
      file.currentVersionId,
      dto,
      user,
    );
  }

  async createFolderLink(
    folderId: string,
    dto: CreateShareLinkDto,
    user: AuthenticatedUser,
  ): Promise<VaultExternalShareLinkEntity> {
    const folder = await this.getFolderOrThrow(folderId);
    // A PERSONAL folder cannot be link-shared as a whole (files within can).
    if (folder.type === VaultFolderType.PERSONAL) {
      throw new BadRequestException(
        'A personal folder cannot be shared via an external link; share individual files instead',
      );
    }
    // WRITE access required — the same bar as upload and internal sharing, so a
    // read-only member of a VERTICAL/COMPANY_WIDE default folder cannot mint a
    // public link to it.
    const acc = await this.access.computeAccess(user, folder);
    if (!acc.canWrite) {
      throw new ForbiddenException(
        'You need write access to a folder to create a share link',
      );
    }

    return this.createLink(
      VaultShareResourceType.FOLDER,
      folderId,
      null,
      dto,
      user,
    );
  }

  /**
   * List the active (non-revoked) external links on a file (spec §5.2), each
   * with a live access count. Requires read access — the same bar as creating
   * a link. Ordered newest-first. Expired-but-not-revoked links are still
   * listed (the UI shows their expiry) so the manager can see and revoke them.
   */
  async listFileLinks(
    fileId: string,
    user: AuthenticatedUser,
  ): Promise<VaultExternalShareLinkListItemEntity[]> {
    const file = await this.prisma.vaultFile.findUnique({
      where: { id: fileId },
    });
    if (!file || file.status === VaultFileStatus.DELETED) {
      throw new NotFoundException('File not found');
    }
    const folder = await this.getFolderOrThrow(file.folderId);
    const acc = await this.access.computeFileAccess(user, fileId, folder);
    if (!acc.canRead) {
      throw new ForbiddenException(
        'You need read access to a file to view its share links',
      );
    }
    return this.listLinks(VaultShareResourceType.FILE, fileId);
  }

  /** List the active external links on a folder (spec §5.2). Requires read access. */
  async listFolderLinks(
    folderId: string,
    user: AuthenticatedUser,
  ): Promise<VaultExternalShareLinkListItemEntity[]> {
    const folder = await this.getFolderOrThrow(folderId);
    const acc = await this.access.computeAccess(user, folder);
    if (!acc.canRead) {
      throw new ForbiddenException(
        'You need read access to a folder to view its share links',
      );
    }
    return this.listLinks(VaultShareResourceType.FOLDER, folderId);
  }

  private async listLinks(
    resourceType: VaultShareResourceType,
    resourceId: string,
  ): Promise<VaultExternalShareLinkListItemEntity[]> {
    const links = await this.prisma.vaultExternalShareLink.findMany({
      where: { resourceType, resourceId, revokedAt: null },
      include: { _count: { select: { accessLogs: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return links.map(
      (link) =>
        new VaultExternalShareLinkListItemEntity({
          id: link.id,
          resourceType: link.resourceType,
          resourceId: link.resourceId,
          token: link.token,
          permission: link.permission,
          pinnedVersionId: link.pinnedVersionId,
          hasPassword: !!link.passwordHash,
          expiresAt: link.expiresAt,
          revokedAt: link.revokedAt,
          createdById: link.createdById,
          createdAt: link.createdAt,
          accessCount: link._count.accessLogs,
        }),
    );
  }

  private async createLink(
    resourceType: VaultShareResourceType,
    resourceId: string,
    pinnedVersionId: string | null,
    dto: CreateShareLinkDto,
    user: AuthenticatedUser,
  ): Promise<VaultExternalShareLinkEntity> {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(
      Date.now() +
        (dto.expiresInHours ?? DEFAULT_EXPIRY_HOURS) * 60 * 60 * 1000,
    );
    const passwordHash = dto.password
      ? await bcrypt.hash(dto.password, 10)
      : null;

    const link = await this.prisma.vaultExternalShareLink.create({
      data: {
        resourceType,
        resourceId,
        token,
        permission: VaultSharePermission.VIEW,
        pinnedVersionId,
        passwordHash,
        expiresAt,
        createdById: user.id,
      },
    });
    return this.toEntity(link);
  }

  /** Revoke a link — creator or SUPER_ADMIN only. Idempotent. */
  async revoke(linkId: string, user: AuthenticatedUser): Promise<void> {
    const link = await this.prisma.vaultExternalShareLink.findUnique({
      where: { id: linkId },
    });
    if (!link) {
      throw new NotFoundException('Share link not found');
    }
    if (link.createdById !== user.id && user.role !== 'SUPER_ADMIN') {
      throw new ForbiddenException(
        'Only the link creator or a SUPER_ADMIN may revoke it',
      );
    }
    if (link.revokedAt) return; // already revoked
    await this.prisma.vaultExternalShareLink.update({
      where: { id: linkId },
      data: { revokedAt: new Date() },
    });
  }

  /**
   * Resolve a public token (UNAUTHENTICATED). Logs EVERY attempt with IP/UA,
   * pass or fail, then validates: exists, not revoked, not expired, password
   * (if set). Returns the PINNED version's preview (if READY) or original for
   * a FILE link; the folder ref for a FOLDER link. `now` is injectable for
   * deterministic tests.
   */
  async resolveByToken(
    token: string,
    password: string | undefined,
    context: { ip?: string; userAgent?: string },
    now: Date = new Date(),
  ): Promise<PublicSharedResourceEntity> {
    const link = await this.prisma.vaultExternalShareLink.findUnique({
      where: { token },
    });

    // Log the attempt regardless (only when we have a link row to attach to;
    // an unknown token has nothing to reference and is simply a 404).
    if (link) {
      await this.prisma.vaultExternalAccessLog
        .create({
          data: {
            shareLinkId: link.id,
            ipAddress: context.ip ?? null,
            userAgent: context.userAgent ?? null,
          },
        })
        .catch(() => undefined);
    }

    if (!link) {
      throw new NotFoundException('Share link not found');
    }
    if (link.revokedAt) {
      throw new ForbiddenException('This share link has been revoked');
    }
    if (link.expiresAt <= now) {
      throw new ForbiddenException('This share link has expired');
    }
    if (link.passwordHash) {
      const ok = password
        ? await bcrypt.compare(password, link.passwordHash)
        : false;
      if (!ok) {
        throw new ForbiddenException('A valid password is required');
      }
    }

    return link.resourceType === VaultShareResourceType.FILE
      ? this.resolveFile(link)
      : this.resolveFolder(link);
  }

  private async resolveFile(
    link: VaultExternalShareLink,
  ): Promise<PublicSharedResourceEntity> {
    if (!link.pinnedVersionId) {
      throw new NotFoundException('The shared version is no longer available');
    }
    const version = await this.prisma.vaultFileVersion.findUnique({
      where: { id: link.pinnedVersionId },
      include: { file: true },
    });
    // Pinned version could have been pruned, or its file soft-deleted.
    if (!version || version.file.status === VaultFileStatus.DELETED) {
      throw new NotFoundException('The shared file is no longer available');
    }

    // Serve the preview PDF when ready, else the original object.
    const key =
      version.previewStatus === PreviewStatus.READY && version.previewStorageKey
        ? version.previewStorageKey
        : version.storageKey;
    const { url, expiresInSeconds } = await this.storage.createDownloadUrl(key);

    return new PublicSharedResourceEntity({
      resourceType: VaultShareResourceType.FILE,
      name: version.file.name,
      url,
      mimeType: version.mimeType,
      expiresInSeconds,
    });
  }

  private async resolveFolder(
    link: VaultExternalShareLink,
  ): Promise<PublicSharedResourceEntity> {
    const folder = await this.prisma.vaultFolder.findUnique({
      where: { id: link.resourceId },
    });
    if (!folder) {
      throw new NotFoundException('The shared folder is no longer available');
    }
    return new PublicSharedResourceEntity({
      resourceType: VaultShareResourceType.FOLDER,
      name: folder.name,
      url: null,
      mimeType: null,
      expiresInSeconds: null,
    });
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

  private toEntity(link: VaultExternalShareLink): VaultExternalShareLinkEntity {
    return new VaultExternalShareLinkEntity({
      id: link.id,
      resourceType: link.resourceType,
      resourceId: link.resourceId,
      token: link.token,
      permission: link.permission,
      pinnedVersionId: link.pinnedVersionId,
      hasPassword: !!link.passwordHash,
      expiresAt: link.expiresAt,
      revokedAt: link.revokedAt,
      createdById: link.createdById,
      createdAt: link.createdAt,
    });
  }
}
