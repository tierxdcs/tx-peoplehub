import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, ProvisioningApproverType, ProvisioningRequestStatus, Role } from '@prisma/client';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../core/database/prisma.service';
import { CreateProvisioningItemTypeDto, UpdateProvisioningItemTypeDto } from './dto/provisioning-item-type.dto';

const requestInclude = {
  employee: { select: { id: true, employeeId: true, firstName: true, lastName: true, designation: true } },
  itemType: { include: { approverVertical: { select: { id: true, name: true, code: true, ownerId: true } } } },
  approvedBy: { select: { id: true, firstName: true, lastName: true } },
  fulfilledBy: { select: { id: true, firstName: true, lastName: true } },
  completedBy: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.ProvisioningRequestInclude;

@Injectable()
export class ProvisioningService {
  constructor(private readonly prisma: PrismaService) {}

  async createForEmployee(employeeId: string, db: Prisma.TransactionClient | PrismaService = this.prisma) {
    const items = await db.provisioningItemType.findMany({ where: { isActive: true }, select: { id: true } });
    if (!items.length) return;
    await db.provisioningRequest.createMany({
      data: items.map((item) => ({ employeeId, itemTypeId: item.id })),
      skipDuplicates: true,
    });
  }

  listItemTypes(user: AuthenticatedUser) {
    this.assertSuperAdmin(user);
    return this.prisma.provisioningItemType.findMany({ include: { approverVertical: { select: { id: true, name: true, code: true, ownerId: true } } }, orderBy: { name: 'asc' } });
  }

  async createItemType(dto: CreateProvisioningItemTypeDto, user: AuthenticatedUser) {
    this.assertSuperAdmin(user);
    const data = await this.normalizeItemType(dto);
    return this.prisma.provisioningItemType.create({ data });
  }

  async updateItemType(id: string, dto: UpdateProvisioningItemTypeDto, user: AuthenticatedUser) {
    this.assertSuperAdmin(user);
    const current = await this.prisma.provisioningItemType.findUnique({ where: { id } });
    if (!current) throw new NotFoundException('Provisioning item type not found');
    const data = await this.normalizeItemType({ ...current, ...dto });
    return this.prisma.provisioningItemType.update({ where: { id }, data: { ...data, isActive: dto.isActive ?? current.isActive } });
  }

  async listForEmployee(employeeId: string, user: AuthenticatedUser) {
    if (user.role !== Role.SUPER_ADMIN && user.role !== Role.ADMIN && user.id !== employeeId) {
      const viewer = await this.prisma.employee.findUnique({ where: { id: user.id }, select: { role: true, vertical: { select: { code: true } } } });
      if (viewer?.role !== Role.MANAGER || viewer.vertical?.code !== 'HR') {
        throw new ForbiddenException('Only HR Managers, Admins, or the employee may view this provisioning checklist');
      }
    }
    return this.prisma.provisioningRequest.findMany({ where: { employeeId }, include: requestInclude, orderBy: { createdAt: 'asc' } });
  }

  listPending(user: AuthenticatedUser) {
    return this.prisma.provisioningRequest.findMany({
      where: { status: ProvisioningRequestStatus.PENDING_APPROVAL, ...this.approverWhere(user) },
      include: requestInclude,
      orderBy: { createdAt: 'asc' },
    });
  }

  countPending(user: AuthenticatedUser) {
    return this.prisma.provisioningRequest.count({
      where: { status: ProvisioningRequestStatus.PENDING_APPROVAL, ...this.approverWhere(user) },
    });
  }

  async approve(id: string, user: AuthenticatedUser) {
    const request = await this.findRequest(id);
    this.assertCanApprove(request, user);
    if (request.status !== ProvisioningRequestStatus.PENDING_APPROVAL) throw new BadRequestException('Only pending requests can be approved');
    const now = new Date();
    const physical = request.itemType.requiresScmFulfillment;
    return this.prisma.provisioningRequest.update({
      where: { id },
      data: physical
        ? { status: ProvisioningRequestStatus.SENT_TO_SCM, approvedById: user.id, approvedAt: now }
        : { status: ProvisioningRequestStatus.COMPLETED, approvedById: user.id, approvedAt: now, completedById: user.id, completedAt: now },
      include: requestInclude,
    });
  }

  async reject(id: string, comment: string | undefined, user: AuthenticatedUser) {
    const request = await this.findRequest(id);
    this.assertCanApprove(request, user);
    if (request.status !== ProvisioningRequestStatus.PENDING_APPROVAL) throw new BadRequestException('Only pending requests can be rejected');
    const rejectionComment = comment?.trim();
    if (!rejectionComment) throw new BadRequestException('A comment is required when rejecting');
    return this.prisma.provisioningRequest.update({ where: { id }, data: { status: ProvisioningRequestStatus.REJECTED, approvedById: user.id, approvedAt: new Date(), rejectionComment }, include: requestInclude });
  }

  async listScmQueue(user: AuthenticatedUser) {
    await this.assertScm(user);
    return this.prisma.provisioningRequest.findMany({ where: { status: ProvisioningRequestStatus.SENT_TO_SCM }, include: requestInclude, orderBy: { approvedAt: 'asc' } });
  }

  async fulfill(id: string, user: AuthenticatedUser) {
    await this.assertScm(user);
    const request = await this.findRequest(id);
    if (request.status !== ProvisioningRequestStatus.SENT_TO_SCM || !request.itemType.requiresScmFulfillment) throw new BadRequestException('Only SCM-bound physical requests can be fulfilled');
    return this.prisma.provisioningRequest.update({ where: { id }, data: { status: ProvisioningRequestStatus.FULFILLED, fulfilledById: user.id, fulfilledAt: new Date() }, include: requestInclude });
  }

  private async findRequest(id: string) {
    const request = await this.prisma.provisioningRequest.findUnique({ where: { id }, include: requestInclude });
    if (!request) throw new NotFoundException('Provisioning request not found');
    return request;
  }

  private approverWhere(user: AuthenticatedUser): Prisma.ProvisioningRequestWhereInput {
    if (user.role === Role.SUPER_ADMIN) return {};
    return { employeeId: { not: user.id }, itemType: { approverType: ProvisioningApproverType.VERTICAL_OWNER, approverVertical: { ownerId: user.id } } };
  }

  private assertCanApprove(request: Awaited<ReturnType<ProvisioningService['findRequest']>>, user: AuthenticatedUser) {
    if (user.id === request.employeeId) throw new ForbiddenException('You cannot approve your own provisioning request');
    if (user.role === Role.SUPER_ADMIN) return;
    if (request.itemType.approverType === ProvisioningApproverType.VERTICAL_OWNER && request.itemType.approverVertical?.ownerId === user.id) return;
    throw new ForbiddenException('Only the configured vertical owner or the CEO may act on this request');
  }

  private async assertScm(user: AuthenticatedUser) {
    if (user.role === Role.SUPER_ADMIN) return;
    const employee = await this.prisma.employee.findUnique({ where: { id: user.id }, select: { vertical: { select: { code: true } } } });
    if (employee?.vertical?.code !== 'SCM') throw new ForbiddenException('Only SCM users may fulfill provisioning requests');
  }

  private assertSuperAdmin(user: AuthenticatedUser) {
    if (user.role !== Role.SUPER_ADMIN) throw new ForbiddenException('Only the CEO may manage provisioning item types');
  }

  private async normalizeItemType(dto: CreateProvisioningItemTypeDto | (UpdateProvisioningItemTypeDto & { approverType: ProvisioningApproverType; name: string; requiresScmFulfillment: boolean })) {
    const name = dto.name.trim();
    if (!name) throw new BadRequestException('Name is required');
    if (dto.approverType === ProvisioningApproverType.VERTICAL_OWNER) {
      if (!dto.approverVerticalId) throw new BadRequestException('An approver vertical is required');
      const vertical = await this.prisma.vertical.findUnique({ where: { id: dto.approverVerticalId } });
      if (!vertical) throw new BadRequestException('Approver vertical not found');
      return { name, requiresScmFulfillment: dto.requiresScmFulfillment!, approverType: dto.approverType, approverVerticalId: dto.approverVerticalId };
    }
    return { name, requiresScmFulfillment: dto.requiresScmFulfillment!, approverType: ProvisioningApproverType.SUPER_ADMIN, approverVerticalId: null };
  }
}
