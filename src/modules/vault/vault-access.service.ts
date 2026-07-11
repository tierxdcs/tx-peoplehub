import { Injectable } from '@nestjs/common';
import {
  Role,
  VaultFolder,
  VaultFolderPermission,
  VaultGranteeType,
  VaultInternalShare,
  VaultSharePermission,
  VaultShareResourceType,
  VaultVisibilityScope,
} from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { EmployeesService } from '../employees/employees.service';

/** Effective rights on one resource. Plain shape — computed, never persisted. */
export interface VaultAccess {
  canRead: boolean;
  canWrite: boolean;
  canDelete: boolean;
  canCreateSubfolder: boolean;
}

const NO_ACCESS: VaultAccess = {
  canRead: false,
  canWrite: false,
  canDelete: false,
  canCreateSubfolder: false,
};

const FULL_ACCESS: VaultAccess = {
  canRead: true,
  canWrite: true,
  canDelete: true,
  canCreateSubfolder: true,
};

type FolderWithPermissions = VaultFolder & {
  permissions: VaultFolderPermission[];
};

function mergeAccess(a: VaultAccess, b: VaultAccess): VaultAccess {
  return {
    canRead: a.canRead || b.canRead,
    canWrite: a.canWrite || b.canWrite,
    canDelete: a.canDelete || b.canDelete,
    canCreateSubfolder: a.canCreateSubfolder || b.canCreateSubfolder,
  };
}

/** An internal share maps to read (VIEW) or read+write (EDIT); never delete/subfolder. */
function shareAccess(permission: VaultSharePermission): VaultAccess {
  return {
    canRead: true,
    canWrite: permission === VaultSharePermission.EDIT,
    canDelete: false,
    canCreateSubfolder: false,
  };
}

/**
 * The single place effective Vault access is computed. Access is the UNION
 * (most-permissive-wins) of every source — no source ever reduces another:
 *   1. default scope rules (§1.4)
 *   2. explicit VaultFolderPermission grants (Phase 1)
 *   3. VaultInternalShare grants (Phase 3) — folder shares on a folder;
 *      file shares additionally on a file, ON TOP OF its folder's access.
 * SUPER_ADMIN is a full override.
 *
 * TEAM scope resolves the owner's downstream hierarchy through
 * EmployeesService.getTeamIds() — the SAME recursive-CTE code path behind
 * Leave/Attendance and Sales, by design (a duplicate would let the two
 * hierarchy semantics drift).
 *
 * Scope defaults (§1.4):
 *   PRIVATE       owner: full. Everyone else: nothing.
 *   TEAM          owner: full. Owner's downstream team: read+write. Others: nothing.
 *   VERTICAL      employees of scopeVerticalId: read; MANAGER+ in it: write.
 *   COMPANY_WIDE  everyone: read; MANAGER+: write.
 * Delete/createSubfolder beyond the owner come only from explicit grants.
 */
@Injectable()
export class VaultAccessService {
  constructor(
    private readonly employeesService: EmployeesService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Effective access on a FOLDER: scope ∪ folder-permissions ∪ folder-shares.
   */
  async computeAccess(
    user: AuthenticatedUser,
    folder: FolderWithPermissions,
  ): Promise<VaultAccess> {
    if (user.role === Role.SUPER_ADMIN) {
      return { ...FULL_ACCESS };
    }

    let access = mergeAccess(
      await this.scopeAccess(user, folder),
      this.grantAccess(user, folder.permissions),
    );
    access = mergeAccess(
      access,
      await this.shareAccessFor(user, VaultShareResourceType.FOLDER, folder.id),
    );
    return access;
  }

  /**
   * Effective access on a FILE: it inherits its folder's access, PLUS any
   * file-level share adds to it. So a file can be shared with someone who
   * has no folder access at all — they get just that file, nothing else in
   * the folder. A file share never downgrades folder-derived access.
   */
  async computeFileAccess(
    user: AuthenticatedUser,
    fileId: string,
    folder: FolderWithPermissions,
  ): Promise<VaultAccess> {
    if (user.role === Role.SUPER_ADMIN) {
      return { ...FULL_ACCESS };
    }
    const folderAccess = await this.computeAccess(user, folder);
    const fromFileShare = await this.shareAccessFor(
      user,
      VaultShareResourceType.FILE,
      fileId,
    );
    return mergeAccess(folderAccess, fromFileShare);
  }

  private async scopeAccess(
    user: AuthenticatedUser,
    folder: VaultFolder,
  ): Promise<VaultAccess> {
    // The owner always has full rights on their own folder, whatever scope.
    if (folder.ownerId === user.id) {
      return { ...FULL_ACCESS };
    }

    const isManagerPlus =
      user.role === Role.MANAGER || user.role === Role.ADMIN;

    switch (folder.visibilityScope) {
      case VaultVisibilityScope.PRIVATE:
        return { ...NO_ACCESS };

      case VaultVisibilityScope.TEAM: {
        // Visible to the owner's downstream hierarchy — same recursive
        // lookup as Leave/Sales (see class doc).
        const teamIds = await this.employeesService.getTeamIds(folder.ownerId);
        if (teamIds.includes(user.id)) {
          return {
            canRead: true,
            canWrite: true,
            canDelete: false,
            canCreateSubfolder: false,
          };
        }
        return { ...NO_ACCESS };
      }

      case VaultVisibilityScope.VERTICAL: {
        if (
          !folder.scopeVerticalId ||
          user.verticalId !== folder.scopeVerticalId
        ) {
          return { ...NO_ACCESS };
        }
        return {
          canRead: true,
          canWrite: isManagerPlus,
          canDelete: false,
          canCreateSubfolder: false,
        };
      }

      case VaultVisibilityScope.COMPANY_WIDE:
        return {
          canRead: true,
          canWrite: isManagerPlus,
          canDelete: false,
          canCreateSubfolder: false,
        };
    }
  }

  /** Union of every explicit grant that targets this user (by id, vertical, or role). */
  private grantAccess(
    user: AuthenticatedUser,
    permissions: VaultFolderPermission[],
  ): VaultAccess {
    const applicable = permissions.filter((p) => {
      switch (p.granteeType) {
        case VaultGranteeType.EMPLOYEE:
          return p.granteeId === user.id;
        case VaultGranteeType.VERTICAL:
          return !!user.verticalId && p.granteeId === user.verticalId;
        case VaultGranteeType.ROLE:
          return !!user.role && p.granteeId === user.role;
      }
    });

    return applicable.reduce<VaultAccess>(
      (acc, p) => ({
        canRead: acc.canRead || p.canRead,
        canWrite: acc.canWrite || p.canWrite,
        canDelete: acc.canDelete || p.canDelete,
        canCreateSubfolder: acc.canCreateSubfolder || p.canCreateSubfolder,
      }),
      { ...NO_ACCESS },
    );
  }

  /** Access this user derives from an internal share on the given resource. */
  private async shareAccessFor(
    user: AuthenticatedUser,
    resourceType: VaultShareResourceType,
    resourceId: string,
  ): Promise<VaultAccess> {
    const share: VaultInternalShare | null =
      await this.prisma.vaultInternalShare.findUnique({
        where: {
          resourceType_resourceId_sharedWithEmployeeId: {
            resourceType,
            resourceId,
            sharedWithEmployeeId: user.id,
          },
        },
      });
    return share ? shareAccess(share.permission) : { ...NO_ACCESS };
  }
}
