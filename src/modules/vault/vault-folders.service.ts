import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Role,
  VaultFileStatus,
  VaultFolder,
  VaultFolderPermission,
  VaultFolderStatus,
  VaultFolderType,
  VaultGranteeType,
  VaultVisibilityScope,
} from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { CreateVaultFolderDto } from './dto/create-vault-folder.dto';
import { UpdateVaultFolderDto } from './dto/update-vault-folder.dto';
import { GrantVaultPermissionDto } from './dto/grant-vault-permission.dto';
import {
  VaultAccessEntity,
  VaultFolderEntity,
  VaultFolderPermissionEntity,
} from './entities/vault-folder.entity';
import { VaultAccess, VaultAccessService } from './vault-access.service';

type FolderWithPermissions = VaultFolder & {
  permissions: VaultFolderPermission[];
};

@Injectable()
export class VaultFoldersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: VaultAccessService,
  ) {}

  /**
   * DEFAULT: SUPER_ADMIN only; must be COMPANY_WIDE or VERTICAL (+ vertical id).
   * CUSTOM: MANAGER and above; scope is forced to TEAM around the creator's
   * downstream hierarchy — client-supplied scope is ignored, not trusted.
   */
  async create(
    dto: CreateVaultFolderDto,
    user: AuthenticatedUser,
  ): Promise<VaultFolderEntity> {
    if (dto.type === VaultFolderType.DEFAULT) {
      if (user.role !== Role.SUPER_ADMIN) {
        throw new ForbiddenException(
          'Only a SUPER_ADMIN may create DEFAULT folders',
        );
      }
      if (
        dto.visibilityScope !== VaultVisibilityScope.COMPANY_WIDE &&
        dto.visibilityScope !== VaultVisibilityScope.VERTICAL &&
        dto.visibilityScope !== VaultVisibilityScope.PRIVATE
      ) {
        throw new BadRequestException(
          'A DEFAULT folder must specify visibilityScope COMPANY_WIDE, VERTICAL, or PRIVATE',
        );
      }
      if (dto.visibilityScope === VaultVisibilityScope.VERTICAL) {
        if (!dto.scopeVerticalId) {
          throw new BadRequestException(
            'scopeVerticalId is required when visibilityScope is VERTICAL',
          );
        }
        const vertical = await this.prisma.vertical.findUnique({
          where: { id: dto.scopeVerticalId },
        });
        if (!vertical) {
          throw new BadRequestException(
            'scopeVerticalId does not reference a vertical',
          );
        }
      }
    } else {
      // CUSTOM — Manager and above.
      if (
        user.role !== Role.MANAGER &&
        user.role !== Role.ADMIN &&
        user.role !== Role.SUPER_ADMIN
      ) {
        throw new ForbiddenException(
          'Only a Manager or above may create CUSTOM folders',
        );
      }
    }

    if (dto.parentFolderId) {
      const parent = await this.findRawOrThrow(dto.parentFolderId);
      // An archived parent is a closed container — no new subfolders inside it.
      if (parent.status === VaultFolderStatus.ARCHIVED) {
        throw new BadRequestException(
          'This folder is archived and can no longer contain new subfolders',
        );
      }
      const parentAccess = await this.access.computeAccess(user, parent);
      if (!parentAccess.canCreateSubfolder) {
        throw new ForbiddenException(
          'You cannot create a subfolder under this folder',
        );
      }
    }

    const isCustom = dto.type === VaultFolderType.CUSTOM;
    const created = await this.prisma.vaultFolder.create({
      data: {
        name: dto.name,
        type: dto.type,
        parentFolderId: dto.parentFolderId ?? null,
        ownerId: user.id,
        // CUSTOM is always TEAM-scoped to the creator's hierarchy — never
        // client-chosen. DEFAULT uses the validated dto scope.
        visibilityScope: isCustom
          ? VaultVisibilityScope.TEAM
          : (dto.visibilityScope as VaultVisibilityScope),
        scopeVerticalId:
          !isCustom && dto.visibilityScope === VaultVisibilityScope.VERTICAL
            ? dto.scopeVerticalId
            : null,
        versioningEnabled: dto.versioningEnabled ?? false,
        maxVersionsRetained: dto.maxVersionsRetained ?? 5,
      },
      include: { permissions: true },
    });

    return this.toEntity(
      created,
      await this.access.computeAccess(user, created),
    );
  }

  /**
   * Root folders the caller can see, ordered for the browser landing (§2):
   * their PERSONAL folder first, then DEFAULT (company-wide / their vertical),
   * then CUSTOM (team) — each within its group by name. "Root" = no parent.
   *
   * Candidate narrowing: a root PRIVATE folder is only ever visible to its
   * owner, so we fetch the caller's own roots plus all non-PRIVATE roots and
   * let computeAccess make the final per-folder call (same union logic as
   * everywhere else — never a second access code path).
   */
  async listRoots(user: AuthenticatedUser): Promise<VaultFolderEntity[]> {
    // A PRIVATE root owned by someone else is normally invisible, but it can
    // have been internal-shared or explicitly granted to the caller — include
    // those ids so computeAccess gets the chance to grant access to them too.
    const sharedFolderIds = (
      await this.prisma.vaultInternalShare.findMany({
        where: {
          sharedWithEmployeeId: user.id,
          resourceType: 'FOLDER',
        },
        select: { resourceId: true },
      })
    ).map((s) => s.resourceId);
    const grantedFolderIds = (
      await this.prisma.vaultFolderPermission.findMany({
        where: {
          granteeType: 'EMPLOYEE',
          granteeId: user.id,
          canRead: true,
        },
        select: { folderId: true },
      })
    ).map((p) => p.folderId);

    const candidates = await this.prisma.vaultFolder.findMany({
      where: {
        parentFolderId: null,
        status: { not: 'ARCHIVED' },
        OR: [
          { ownerId: user.id },
          { visibilityScope: { not: VaultVisibilityScope.PRIVATE } },
          { id: { in: [...sharedFolderIds, ...grantedFolderIds] } },
        ],
      },
      include: { permissions: true },
      orderBy: { name: 'asc' },
    });

    const visible: VaultFolderEntity[] = [];
    for (const folder of candidates) {
      const access = await this.access.computeAccess(user, folder);
      if (access.canRead) {
        visible.push(this.toEntity(folder, access));
      }
    }

    // PERSONAL → DEFAULT → CUSTOM; stable name order preserved within a group.
    const rank: Record<VaultFolderType, number> = {
      [VaultFolderType.PERSONAL]: 0,
      [VaultFolderType.DEFAULT]: 1,
      [VaultFolderType.CUSTOM]: 2,
    };
    visible.sort((a, b) => rank[a.type] - rank[b.type]);
    return visible;
  }

  /** Folder + immediate children the caller can read; 403 if no read access. */
  async findOne(
    id: string,
    user: AuthenticatedUser,
  ): Promise<VaultFolderEntity> {
    const folder = await this.findRawOrThrow(id);
    const folderAccess = await this.access.computeAccess(user, folder);
    if (!folderAccess.canRead) {
      throw new ForbiddenException('You do not have access to this folder');
    }

    const children = await this.prisma.vaultFolder.findMany({
      where: { parentFolderId: id, status: { not: VaultFolderStatus.ARCHIVED } },
      include: { permissions: true },
      orderBy: { name: 'asc' },
    });
    const visibleChildren: VaultFolderEntity[] = [];
    for (const child of children) {
      const childAccess = await this.access.computeAccess(user, child);
      if (childAccess.canRead) {
        visibleChildren.push(this.toEntity(child, childAccess));
      }
    }

    const entity = this.toEntity(folder, folderAccess);
    entity.children = visibleChildren;
    return entity;
  }

  /**
   * Rename / archive / versioning toggles. Requires write access; versioning
   * settings are not exposed on PERSONAL folders (spec §3).
   */
  async update(
    id: string,
    dto: UpdateVaultFolderDto,
    user: AuthenticatedUser,
  ): Promise<VaultFolderEntity> {
    const folder = await this.findRawOrThrow(id);
    const folderAccess = await this.access.computeAccess(user, folder);
    if (!folderAccess.canWrite) {
      throw new ForbiddenException(
        'You do not have write access to this folder',
      );
    }

    if (
      folder.type === VaultFolderType.PERSONAL &&
      (dto.versioningEnabled !== undefined ||
        dto.maxVersionsRetained !== undefined)
    ) {
      throw new BadRequestException(
        'Versioning settings are not configurable on a PERSONAL folder',
      );
    }

    const updated = await this.prisma.vaultFolder.update({
      where: { id },
      data: {
        name: dto.name,
        status: dto.status,
        versioningEnabled: dto.versioningEnabled,
        maxVersionsRetained: dto.maxVersionsRetained,
      },
      include: { permissions: true },
    });
    return this.toEntity(
      updated,
      await this.access.computeAccess(user, updated),
    );
  }

  /**
   * Archive (soft-delete) a DEFAULT folder. SUPER_ADMIN only, DEFAULT type
   * only, and only when the folder is EMPTY — no ACTIVE files and no ACTIVE
   * child folders. Emptiness is a deliberate guard: rather than cascade-archive
   * everything inside, we force the caller to clear the container first, so one
   * action can never silently take a lot of content down with it.
   *
   * Soft-delete = status ARCHIVED (the schema already anticipates
   * reversibility). Archived folders drop out of every listing and reject
   * uploads / subfolder creation. There is intentionally NO unarchive/restore
   * endpoint in this task — a known gap, reasonable to add later if it matters.
   */
  async deleteFolder(id: string, user: AuthenticatedUser): Promise<void> {
    if (user.role !== Role.SUPER_ADMIN) {
      throw new ForbiddenException('Only a SUPER_ADMIN may delete folders');
    }
    const folder = await this.findRawOrThrow(id);
    if (folder.type !== VaultFolderType.DEFAULT) {
      throw new BadRequestException(
        'Only DEFAULT folders can be deleted; PERSONAL and CUSTOM folders cannot be deleted here',
      );
    }
    // Already archived → nothing to do (idempotent), but surface it clearly.
    if (folder.status === VaultFolderStatus.ARCHIVED) {
      throw new BadRequestException('This folder is already archived');
    }

    // Emptiness check — count ACTIVE files and ACTIVE child folders directly in
    // this folder (not recursively: a child folder is itself a blocker, and its
    // own contents are its own problem to clear first).
    const [fileCount, subfolderCount] = await Promise.all([
      this.prisma.vaultFile.count({
        where: { folderId: id, status: VaultFileStatus.ACTIVE },
      }),
      this.prisma.vaultFolder.count({
        where: { parentFolderId: id, status: VaultFolderStatus.ACTIVE },
      }),
    ]);
    if (fileCount > 0 || subfolderCount > 0) {
      const parts: string[] = [];
      if (fileCount > 0) {
        parts.push(`${fileCount} file${fileCount === 1 ? '' : 's'}`);
      }
      if (subfolderCount > 0) {
        parts.push(
          `${subfolderCount} subfolder${subfolderCount === 1 ? '' : 's'}`,
        );
      }
      throw new BadRequestException(
        `Cannot delete: folder still contains ${parts.join(
          ' and ',
        )} — remove these first`,
      );
    }

    await this.prisma.vaultFolder.update({
      where: { id },
      data: { status: VaultFolderStatus.ARCHIVED },
    });
  }

  /**
   * Grant explicit access beyond the default scope. Only someone with delete
   * rights on the folder (owner or SUPER_ADMIN in practice) may grant —
   * grants are additive and never reduce scope-derived access.
   */
  async grantPermission(
    folderId: string,
    dto: GrantVaultPermissionDto,
    user: AuthenticatedUser,
  ): Promise<VaultFolderPermissionEntity> {
    const folder = await this.findRawOrThrow(folderId);
    const folderAccess = await this.access.computeAccess(user, folder);
    if (!folderAccess.canDelete) {
      // canDelete is the "manage" tier: owner + SUPER_ADMIN + explicit grants.
      throw new ForbiddenException(
        'Only someone who manages this folder may grant access to it',
      );
    }
    if (folder.type === VaultFolderType.PERSONAL) {
      throw new BadRequestException(
        'A PERSONAL folder cannot be shared via permissions in this phase',
      );
    }

    await this.validateGrantee(dto.granteeType, dto.granteeId);

    // Idempotent per (folder, grantee): re-granting updates the flags.
    const permission = await this.prisma.vaultFolderPermission.upsert({
      where: {
        folderId_granteeType_granteeId: {
          folderId,
          granteeType: dto.granteeType,
          granteeId: dto.granteeId,
        },
      },
      create: {
        folderId,
        granteeType: dto.granteeType,
        granteeId: dto.granteeId,
        canRead: dto.canRead ?? false,
        canWrite: dto.canWrite ?? false,
        canDelete: dto.canDelete ?? false,
        canCreateSubfolder: dto.canCreateSubfolder ?? false,
        grantedById: user.id,
      },
      update: {
        canRead: dto.canRead ?? false,
        canWrite: dto.canWrite ?? false,
        canDelete: dto.canDelete ?? false,
        canCreateSubfolder: dto.canCreateSubfolder ?? false,
        grantedById: user.id,
      },
    });

    return new VaultFolderPermissionEntity({
      id: permission.id,
      folderId: permission.folderId,
      granteeType: permission.granteeType,
      granteeId: permission.granteeId,
      canRead: permission.canRead,
      canWrite: permission.canWrite,
      canDelete: permission.canDelete,
      canCreateSubfolder: permission.canCreateSubfolder,
      grantedById: permission.grantedById,
      createdAt: permission.createdAt,
    });
  }

  private async validateGrantee(
    granteeType: VaultGranteeType,
    granteeId: string,
  ): Promise<void> {
    switch (granteeType) {
      case VaultGranteeType.EMPLOYEE: {
        const employee = await this.prisma.employee.findUnique({
          where: { id: granteeId },
        });
        if (!employee) {
          throw new BadRequestException(
            'granteeId does not reference an employee',
          );
        }
        return;
      }
      case VaultGranteeType.VERTICAL: {
        const vertical = await this.prisma.vertical.findUnique({
          where: { id: granteeId },
        });
        if (!vertical) {
          throw new BadRequestException(
            'granteeId does not reference a vertical',
          );
        }
        return;
      }
      case VaultGranteeType.ROLE: {
        if (!Object.values(Role).includes(granteeId as Role)) {
          throw new BadRequestException(
            `granteeId must be one of: ${Object.values(Role).join(', ')}`,
          );
        }
        return;
      }
    }
  }

  private async findRawOrThrow(id: string): Promise<FolderWithPermissions> {
    const folder = await this.prisma.vaultFolder.findUnique({
      where: { id },
      include: { permissions: true },
    });
    if (!folder) {
      throw new NotFoundException('Folder not found');
    }
    return folder;
  }

  private toEntity(
    folder: VaultFolder,
    access: VaultAccess,
  ): VaultFolderEntity {
    return new VaultFolderEntity({
      id: folder.id,
      name: folder.name,
      parentFolderId: folder.parentFolderId,
      type: folder.type,
      ownerId: folder.ownerId,
      visibilityScope: folder.visibilityScope,
      scopeVerticalId: folder.scopeVerticalId,
      versioningEnabled: folder.versioningEnabled,
      maxVersionsRetained: folder.maxVersionsRetained,
      status: folder.status,
      access: new VaultAccessEntity(access),
      createdAt: folder.createdAt,
      updatedAt: folder.updatedAt,
    });
  }
}
