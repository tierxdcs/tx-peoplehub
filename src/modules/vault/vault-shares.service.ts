import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  VaultFileStatus,
  VaultFolder,
  VaultFolderPermission,
  VaultShareResourceType,
} from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { CreateInternalShareDto } from './dto/create-internal-share.dto';
import { VaultInternalShareEntity } from './entities/vault-share.entity';
import { VaultAccessService } from './vault-access.service';

type FolderWithPermissions = VaultFolder & {
  permissions: VaultFolderPermission[];
};

/**
 * Internal sharing (spec §6): grant a specific employee VIEW/EDIT on a file
 * or folder, additive to their existing access. Persisted as
 * VaultInternalShare and folded into VaultAccessService. Only someone who can
 * already WRITE the resource may share it (you can't hand out access you
 * don't have); SUPER_ADMIN always can via the access override.
 */
@Injectable()
export class VaultSharesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: VaultAccessService,
  ) {}

  async shareFolder(
    folderId: string,
    dto: CreateInternalShareDto,
    user: AuthenticatedUser,
  ): Promise<VaultInternalShareEntity> {
    const folder = await this.getFolderOrThrow(folderId);
    const access = await this.access.computeAccess(user, folder);
    if (!access.canWrite) {
      throw new ForbiddenException(
        'You need write access to a folder to share it',
      );
    }
    await this.assertRecipientExists(dto.sharedWithEmployeeId);

    return this.upsertShare(VaultShareResourceType.FOLDER, folderId, dto, user);
  }

  async shareFile(
    fileId: string,
    dto: CreateInternalShareDto,
    user: AuthenticatedUser,
  ): Promise<VaultInternalShareEntity> {
    const file = await this.prisma.vaultFile.findUnique({
      where: { id: fileId },
    });
    if (!file || file.status === VaultFileStatus.DELETED) {
      throw new NotFoundException('File not found');
    }
    const folder = await this.getFolderOrThrow(file.folderId);
    const access = await this.access.computeFileAccess(user, fileId, folder);
    if (!access.canWrite) {
      throw new ForbiddenException(
        'You need write access to a file to share it',
      );
    }
    await this.assertRecipientExists(dto.sharedWithEmployeeId);

    return this.upsertShare(VaultShareResourceType.FILE, fileId, dto, user);
  }

  /**
   * List the internal shares on a folder (spec §5.1). Requires write access —
   * you can only inspect the share list of a resource you can manage sharing
   * on. Each entry carries the recipient's display name for the UI.
   */
  async listFolderShares(
    folderId: string,
    user: AuthenticatedUser,
  ): Promise<VaultInternalShareEntity[]> {
    const folder = await this.getFolderOrThrow(folderId);
    const access = await this.access.computeAccess(user, folder);
    if (!access.canWrite) {
      throw new ForbiddenException(
        'You need write access to a folder to view its shares',
      );
    }
    return this.listShares(VaultShareResourceType.FOLDER, folderId);
  }

  /** List the internal shares on a file (spec §5.1). Requires file write access. */
  async listFileShares(
    fileId: string,
    user: AuthenticatedUser,
  ): Promise<VaultInternalShareEntity[]> {
    const file = await this.prisma.vaultFile.findUnique({
      where: { id: fileId },
    });
    if (!file || file.status === VaultFileStatus.DELETED) {
      throw new NotFoundException('File not found');
    }
    const folder = await this.getFolderOrThrow(file.folderId);
    const access = await this.access.computeFileAccess(user, fileId, folder);
    if (!access.canWrite) {
      throw new ForbiddenException(
        'You need write access to a file to view its shares',
      );
    }
    return this.listShares(VaultShareResourceType.FILE, fileId);
  }

  /**
   * Revoke an internal share (spec §5.1 remove action). The share's grantor,
   * anyone with write access on the underlying resource, or a SUPER_ADMIN may
   * revoke. Recipient loses the access on the next request (access is computed
   * fresh each time). `resourceType`/`resourceId` come from the nested route
   * (DELETE /vault/{files|folders}/:id/shares/:shareId) and are verified to
   * match the share — a mismatched pair is a 404, so a file route can't revoke
   * a folder's share (or another file's) by id-guessing.
   */
  async revokeShare(
    shareId: string,
    user: AuthenticatedUser,
    resourceType: VaultShareResourceType,
    resourceId: string,
  ): Promise<void> {
    const share = await this.prisma.vaultInternalShare.findUnique({
      where: { id: shareId },
    });
    if (
      !share ||
      share.resourceType !== resourceType ||
      share.resourceId !== resourceId
    ) {
      throw new NotFoundException('Share not found');
    }

    // Authorization: grantor or someone who can still manage sharing on the
    // resource (write access), or SUPER_ADMIN (via the access override).
    let mayRevoke = share.sharedById === user.id;
    if (!mayRevoke) {
      if (share.resourceType === VaultShareResourceType.FOLDER) {
        const folder = await this.getFolderOrThrow(share.resourceId);
        mayRevoke = (await this.access.computeAccess(user, folder)).canWrite;
      } else {
        const file = await this.prisma.vaultFile.findUnique({
          where: { id: share.resourceId },
        });
        if (file) {
          const folder = await this.getFolderOrThrow(file.folderId);
          mayRevoke = (
            await this.access.computeFileAccess(user, file.id, folder)
          ).canWrite;
        }
      }
    }
    if (!mayRevoke) {
      throw new ForbiddenException(
        'Only the sharer or someone who manages this resource may revoke this share',
      );
    }

    await this.prisma.vaultInternalShare.delete({ where: { id: shareId } });
  }

  private async listShares(
    resourceType: VaultShareResourceType,
    resourceId: string,
  ): Promise<VaultInternalShareEntity[]> {
    const shares = await this.prisma.vaultInternalShare.findMany({
      where: { resourceType, resourceId },
      include: {
        sharedWithEmployee: {
          select: { firstName: true, lastName: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
    return shares.map(
      (share) =>
        new VaultInternalShareEntity({
          id: share.id,
          resourceType: share.resourceType,
          resourceId: share.resourceId,
          sharedWithEmployeeId: share.sharedWithEmployeeId,
          sharedWithEmployeeName: share.sharedWithEmployee
            ? `${share.sharedWithEmployee.firstName} ${share.sharedWithEmployee.lastName}`.trim()
            : null,
          permission: share.permission,
          sharedById: share.sharedById,
          createdAt: share.createdAt,
        }),
    );
  }

  private async upsertShare(
    resourceType: VaultShareResourceType,
    resourceId: string,
    dto: CreateInternalShareDto,
    user: AuthenticatedUser,
  ): Promise<VaultInternalShareEntity> {
    // Re-sharing with the same recipient updates the level (idempotent).
    const share = await this.prisma.vaultInternalShare.upsert({
      where: {
        resourceType_resourceId_sharedWithEmployeeId: {
          resourceType,
          resourceId,
          sharedWithEmployeeId: dto.sharedWithEmployeeId,
        },
      },
      create: {
        resourceType,
        resourceId,
        sharedWithEmployeeId: dto.sharedWithEmployeeId,
        permission: dto.permission,
        sharedById: user.id,
      },
      update: {
        permission: dto.permission,
        sharedById: user.id,
      },
    });
    return new VaultInternalShareEntity({
      id: share.id,
      resourceType: share.resourceType,
      resourceId: share.resourceId,
      sharedWithEmployeeId: share.sharedWithEmployeeId,
      permission: share.permission,
      sharedById: share.sharedById,
      createdAt: share.createdAt,
    });
  }

  private async assertRecipientExists(employeeId: string): Promise<void> {
    const recipient = await this.prisma.employee.findUnique({
      where: { id: employeeId },
    });
    if (!recipient) {
      throw new BadRequestException(
        'sharedWithEmployeeId does not reference an employee',
      );
    }
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
}
