import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { CandidateRequisitionStatus, Prisma, Role } from '@prisma/client';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../core/database/prisma.service';
import { SalesNumberingService } from '../sales/common/sales-numbering.service';
import { CreateCandidateRequisitionDto } from './dto/candidate-requisition.dto';

const include = {
  requestedBy: { select: { id: true, employeeId: true, firstName: true, lastName: true } },
  vertical: { select: { id: true, name: true, code: true, ownerId: true, owner: { select: { id: true, firstName: true, lastName: true } } } },
  verticalApprovedBy: { select: { id: true, firstName: true, lastName: true } },
  superAdminApprovedBy: { select: { id: true, firstName: true, lastName: true } },
  rejectedBy: { select: { id: true, firstName: true, lastName: true } },
  offerLetter: { select: { id: true, employeeId: true } },
} satisfies Prisma.CandidateRequisitionInclude;

@Injectable()
export class CandidateRequisitionsService {
  constructor(private readonly prisma: PrismaService, private readonly numbering: SalesNumberingService) {}

  async create(dto: CreateCandidateRequisitionDto, user: AuthenticatedUser) {
    if (user.role !== Role.MANAGER && user.role !== Role.ADMIN && user.role !== Role.SUPER_ADMIN) throw new ForbiddenException('Only Managers or above may create a candidate requisition');
    if (!user.verticalId) throw new BadRequestException('Your account must belong to a vertical before raising a requisition');
    const positionTitle = dto.positionTitle.trim(); const justification = dto.justification.trim();
    if (!positionTitle || !justification) throw new BadRequestException('Position title and justification are required');
    return this.prisma.$transaction(async (tx) => {
      const requisitionNumber = await this.numbering.nextNumber('REQ', 'candidate_requisition', new Date().getFullYear(), tx);
      return tx.candidateRequisition.create({ data: { requisitionNumber, requestedById: user.id, verticalId: user.verticalId!, positionTitle, employmentType: dto.employmentType, justification, targetJoiningDate: dto.targetJoiningDate ? new Date(dto.targetJoiningDate) : null }, include });
    });
  }

  listMine(user: AuthenticatedUser) {
    return this.prisma.candidateRequisition.findMany({ where: { requestedById: user.id, ...(user.role === Role.SUPER_ADMIN ? { status: { not: CandidateRequisitionStatus.PENDING_VERTICAL_APPROVAL } } : {}) }, include, orderBy: { createdAt: 'desc' } });
  }

  async listVerticalPending(user: AuthenticatedUser) {
    // This is deliberately stricter than the earlier one-of-many gates:
    // SuperAdmin is invisible until the vertical owner has approved.
    if (user.role === Role.SUPER_ADMIN) return [];
    return this.prisma.candidateRequisition.findMany({ where: { status: CandidateRequisitionStatus.PENDING_VERTICAL_APPROVAL, requestedById: { not: user.id }, vertical: { ownerId: user.id } }, include, orderBy: { createdAt: 'asc' } });
  }

  listSuperAdminPending(user: AuthenticatedUser) {
    this.assertSuperAdmin(user);
    return this.prisma.candidateRequisition.findMany({ where: { status: CandidateRequisitionStatus.PENDING_SUPERADMIN_APPROVAL }, include, orderBy: { verticalApprovedAt: 'asc' } });
  }

  async approveVertical(id: string, user: AuthenticatedUser) {
    if (user.role === Role.SUPER_ADMIN) throw new ForbiddenException('The CEO cannot perform the first-stage vertical approval');
    const req = await this.find(id);
    if (req.status !== CandidateRequisitionStatus.PENDING_VERTICAL_APPROVAL) throw new BadRequestException('This requisition is not awaiting vertical approval');
    if (req.requestedById === user.id) throw new ForbiddenException('You cannot approve your own requisition');
    if (req.vertical.ownerId !== user.id) throw new ForbiddenException('Only the requisition vertical owner may perform the first approval');
    return this.prisma.candidateRequisition.update({ where: { id }, data: { status: CandidateRequisitionStatus.PENDING_SUPERADMIN_APPROVAL, verticalApprovedById: user.id, verticalApprovedAt: new Date() }, include });
  }

  async rejectVertical(id: string, comment: string, user: AuthenticatedUser) {
    if (user.role === Role.SUPER_ADMIN) throw new ForbiddenException('The CEO cannot perform the first-stage vertical decision');
    const req = await this.find(id); this.assertComment(comment);
    if (req.status !== CandidateRequisitionStatus.PENDING_VERTICAL_APPROVAL || req.vertical.ownerId !== user.id || req.requestedById === user.id) throw new ForbiddenException('Only the requisition vertical owner may reject at this stage');
    return this.rejectRecord(id, comment, user.id);
  }

  async approveSuperAdmin(id: string, user: AuthenticatedUser) {
    this.assertSuperAdmin(user); const req = await this.find(id);
    if (req.status !== CandidateRequisitionStatus.PENDING_SUPERADMIN_APPROVAL || !req.verticalApprovedAt) throw new BadRequestException('Vertical approval must be completed first');
    return this.prisma.candidateRequisition.update({ where: { id }, data: { status: CandidateRequisitionStatus.APPROVED, superAdminApprovedById: user.id, superAdminApprovedAt: new Date() }, include });
  }

  async rejectSuperAdmin(id: string, comment: string, user: AuthenticatedUser) {
    this.assertSuperAdmin(user); const req = await this.find(id); this.assertComment(comment);
    if (req.status !== CandidateRequisitionStatus.PENDING_SUPERADMIN_APPROVAL || !req.verticalApprovedAt) throw new BadRequestException('Only requisitions approved by the vertical owner can be decided here');
    return this.rejectRecord(id, comment, user.id);
  }

  async availableForEmployee(employeeId: string, user: AuthenticatedUser) {
    if (user.role !== Role.MANAGER && user.role !== Role.ADMIN && user.role !== Role.SUPER_ADMIN) throw new ForbiddenException('You cannot create offer letters');
    const employee = await this.prisma.employee.findUnique({ where: { id: employeeId }, select: { verticalId: true, designation: true } });
    if (!employee) throw new NotFoundException('Employee not found');
    return this.prisma.candidateRequisition.findMany({ where: { status: CandidateRequisitionStatus.APPROVED, consumedAt: null, offerLetter: null, verticalId: employee.verticalId ?? undefined, positionTitle: { equals: employee.designation ?? '', mode: 'insensitive' } }, include, orderBy: { superAdminApprovedAt: 'asc' } });
  }

  private async find(id: string) { const req = await this.prisma.candidateRequisition.findUnique({ where: { id }, include }); if (!req) throw new NotFoundException('Candidate requisition not found'); return req; }
  private rejectRecord(id: string, comment: string, userId: string) { return this.prisma.candidateRequisition.update({ where: { id }, data: { status: CandidateRequisitionStatus.REJECTED, rejectedById: userId, rejectedAt: new Date(), rejectionComment: comment.trim() }, include }); }
  private assertComment(comment: string) { if (!comment?.trim()) throw new BadRequestException('A comment is required when rejecting'); }
  private assertSuperAdmin(user: AuthenticatedUser) { if (user.role !== Role.SUPER_ADMIN) throw new ForbiddenException('Only the CEO may perform the final approval'); }
}
