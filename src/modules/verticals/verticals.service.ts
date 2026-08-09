import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { CreateVerticalDto } from './dto/create-vertical.dto';
import { UpdateVerticalOwnerDto } from './dto/update-vertical-owner.dto';
import { UpdateVerticalDto } from './dto/update-vertical.dto';
import { VerticalEntity } from './entities/vertical.entity';

@Injectable()
export class VerticalsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateVerticalDto): Promise<VerticalEntity> {
    const existing = await this.prisma.vertical.findFirst({
      where: { OR: [{ name: dto.name }, { code: dto.code }] },
    });
    if (existing) {
      throw new ConflictException('Vertical name or code already in use');
    }

    if (dto.ownerId) await this.assertEmployeeExists(dto.ownerId);

    const vertical = await this.prisma.vertical.create({
      data: {
        name: dto.name,
        code: dto.code,
        isActive: dto.isActive ?? true,
        ownerId: dto.ownerId,
      },
      include: { owner: { select: this.ownerSelect } },
    });

    return new VerticalEntity(vertical);
  }

  async findAll(): Promise<VerticalEntity[]> {
    const verticals = await this.prisma.vertical.findMany({
      orderBy: { name: 'asc' },
      include: { owner: { select: this.ownerSelect } },
    });
    return verticals.map((v) => new VerticalEntity(v));
  }

  /**
   * Lightweight picker list: ACTIVE verticals only, readable by ANY
   * authenticated user. Unlike the full findAll() (Admin/HR-gated), this exposes
   * just enough to populate a chooser — e.g. tagging a Kanban card with the
   * department its work belongs to. No sensitive data; the set is small and
   * effectively public reference data.
   */
  async findActiveOptions(): Promise<VerticalEntity[]> {
    const verticals = await this.prisma.vertical.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
    });
    return verticals.map((v) => new VerticalEntity(v));
  }

  async updateOwner(
    id: string,
    dto: UpdateVerticalOwnerDto,
  ): Promise<VerticalEntity> {
    await this.assertEmployeeExists(dto.ownerId);
    const vertical = await this.prisma.vertical.update({
      where: { id },
      data: { ownerId: dto.ownerId },
      include: { owner: { select: this.ownerSelect } },
    });
    return new VerticalEntity(vertical);
  }

  async update(id: string, dto: UpdateVerticalDto): Promise<VerticalEntity> {
    const existing = await this.prisma.vertical.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Vertical not found');

    const name = dto.name?.trim();
    const code = dto.code?.trim().toUpperCase();
    if (name || code) {
      const duplicate = await this.prisma.vertical.findFirst({
        where: {
          id: { not: id },
          OR: [...(name ? [{ name }] : []), ...(code ? [{ code }] : [])],
        },
        select: { id: true },
      });
      if (duplicate) {
        throw new ConflictException('Vertical name or code already in use');
      }
    }

    const vertical = await this.prisma.vertical.update({
      where: { id },
      data: {
        ...(name ? { name } : {}),
        ...(code ? { code } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
      include: { owner: { select: this.ownerSelect } },
    });
    return new VerticalEntity(vertical);
  }

  async remove(id: string): Promise<void> {
    const vertical = await this.prisma.vertical.findUnique({
      where: { id },
      select: { id: true, name: true },
    });
    if (!vertical) throw new NotFoundException('Vertical not found');

    const [
      employees,
      vaultFolders,
      vaultPermissions,
      kanbanCards,
      provisioningTypes,
      requisitions,
    ] = await this.prisma.$transaction([
      this.prisma.employee.count({ where: { verticalId: id } }),
      this.prisma.vaultFolder.count({ where: { scopeVerticalId: id } }),
      this.prisma.vaultFolderPermission.count({
        where: { granteeType: 'VERTICAL', granteeId: id },
      }),
      this.prisma.kanbanCard.count({ where: { verticalId: id } }),
      this.prisma.provisioningItemType.count({
        where: { approverVerticalId: id },
      }),
      this.prisma.candidateRequisition.count({ where: { verticalId: id } }),
    ]);
    const references =
      employees +
      vaultFolders +
      vaultPermissions +
      kanbanCards +
      provisioningTypes +
      requisitions;
    if (references > 0) {
      throw new ConflictException(
        `Cannot delete ${vertical.name}: it is still used by ${references} record${references === 1 ? '' : 's'}. Deactivate it instead, or reassign those records first.`,
      );
    }

    await this.prisma.vertical.delete({ where: { id } });
  }

  private readonly ownerSelect = {
    id: true,
    employeeId: true,
    firstName: true,
    lastName: true,
  } as const;

  private async assertEmployeeExists(id: string) {
    const employee = await this.prisma.employee.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!employee) throw new ConflictException('Selected owner does not exist');
  }

  /**
   * The full vertical list is readable by Admin/SuperAdmin and by HR-vertical
   * staff — HR onboarding lets HR create employees into ANY vertical, so the
   * onboarding/roster screens genuinely need every vertical (a plain
   * role-based @Roles guard can't express "or HR-vertical", so it's enforced
   * here, same pattern as EmployeesService.isHrStaff). Everyone else is
   * denied; they can still read their own vertical via findMine().
   */
  async assertCanListAll(user: AuthenticatedUser): Promise<void> {
    if (user.role === Role.ADMIN || user.role === Role.SUPER_ADMIN) {
      return;
    }
    const isHrStaff =
      (user.role === Role.MANAGER || user.role === Role.EMPLOYEE) &&
      !!user.verticalId &&
      (
        await this.prisma.vertical.findUnique({
          where: { id: user.verticalId },
        })
      )?.code === 'HR';
    if (!isHrStaff) {
      throw new ForbiddenException(
        'Only Admins or HR-vertical staff may list all verticals',
      );
    }
  }

  /**
   * The caller's own vertical, or null if they have none (e.g. SUPER_ADMIN).
   * Lets any authenticated employee resolve their own vertical code for
   * client-side nav gating without exposing the full ADMIN-only list.
   */
  async findMine(verticalId: string | null): Promise<VerticalEntity | null> {
    if (!verticalId) {
      return null;
    }
    const vertical = await this.prisma.vertical.findUnique({
      where: { id: verticalId },
    });
    return vertical ? new VerticalEntity(vertical) : null;
  }
}
