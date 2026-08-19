import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CandidateHiringStage,
  CandidateRequisitionStatus,
  OfferLetterStatus,
  Prisma,
  Role,
} from '@prisma/client';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../core/database/prisma.service';
import { SalesNumberingService } from '../sales/common/sales-numbering.service';
import {
  CreateCandidateRequisitionDto,
  UpdateCandidateHiringLifecycleDto,
} from './dto/candidate-requisition.dto';

const include = {
  requestedBy: {
    select: { id: true, employeeId: true, firstName: true, lastName: true },
  },
  vertical: {
    select: {
      id: true,
      name: true,
      code: true,
      ownerId: true,
      owner: { select: { id: true, firstName: true, lastName: true } },
    },
  },
  verticalApprovedBy: { select: { id: true, firstName: true, lastName: true } },
  superAdminApprovedBy: {
    select: { id: true, firstName: true, lastName: true },
  },
  rejectedBy: { select: { id: true, firstName: true, lastName: true } },
  offerLetter: { select: { id: true, employeeId: true } },
  onboardedEmployee: {
    select: {
      id: true,
      employeeId: true,
      firstName: true,
      lastName: true,
    },
  },
} satisfies Prisma.CandidateRequisitionInclude;

@Injectable()
export class CandidateRequisitionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: SalesNumberingService,
  ) {}

  async create(dto: CreateCandidateRequisitionDto, user: AuthenticatedUser) {
    if (
      user.role !== Role.MANAGER &&
      user.role !== Role.ADMIN &&
      user.role !== Role.SUPER_ADMIN
    )
      throw new ForbiddenException(
        'Only Managers or above may create a candidate requisition',
      );
    if (!user.verticalId)
      throw new BadRequestException(
        'Your account must belong to a vertical before raising a requisition',
      );
    const positionTitle = dto.positionTitle.trim();
    const justification = dto.justification.trim();
    const keyResponsibilities = dto.keyResponsibilities.trim();
    const keyPerformanceIndicators = dto.keyPerformanceIndicators.trim();
    if (!positionTitle || !justification)
      throw new BadRequestException(
        'Position title and justification are required',
      );
    if (!keyResponsibilities || !keyPerformanceIndicators)
      throw new BadRequestException(
        'Key responsibilities and KPIs are required',
      );
    if (!(dto.budgetAnnualCtc > 0))
      throw new BadRequestException(
        'An annual CTC budget greater than zero is required',
      );
    return this.prisma.$transaction(async (tx) => {
      const requisitionNumber = await this.numbering.nextNumber(
        'REQ',
        'candidate_requisition',
        new Date().getFullYear(),
        tx,
      );
      return tx.candidateRequisition.create({
        data: {
          requisitionNumber,
          requestedById: user.id,
          verticalId: user.verticalId!,
          positionTitle,
          employmentType: dto.employmentType,
          justification,
          keyResponsibilities,
          keyPerformanceIndicators,
          budgetAnnualCtc: dto.budgetAnnualCtc,
          targetJoiningDate: dto.targetJoiningDate
            ? new Date(dto.targetJoiningDate)
            : null,
        },
        include,
      });
    });
  }

  async cancel(id: string, user: AuthenticatedUser) {
    const req = await this.find(id);
    if (req.requestedById !== user.id)
      throw new ForbiddenException(
        'Only the requester may cancel their own requisition',
      );
    if (
      req.status !== CandidateRequisitionStatus.PENDING_VERTICAL_APPROVAL &&
      req.status !== CandidateRequisitionStatus.PENDING_SUPERADMIN_APPROVAL
    )
      throw new BadRequestException(
        'Only a requisition still pending approval can be cancelled',
      );
    return this.prisma.candidateRequisition.update({
      where: { id },
      data: { status: CandidateRequisitionStatus.CANCELLED },
      include,
    });
  }

  listMine(user: AuthenticatedUser) {
    return this.prisma.candidateRequisition.findMany({
      where: {
        requestedById: user.id,
        ...(user.role === Role.SUPER_ADMIN
          ? {
              status: {
                not: CandidateRequisitionStatus.PENDING_VERTICAL_APPROVAL,
              },
            }
          : {}),
      },
      include,
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Full lifecycle register, scoped to the people legitimately connected to
   * the authorization. The CEO remains unable to see configured-owner requests
   * before first approval, preserving the sequential gate's confidentiality. */
  async listRegister(user: AuthenticatedUser) {
    const hrStaff = await this.isHrStaff(user);
    let where: Prisma.CandidateRequisitionWhereInput;
    if (hrStaff) {
      where = {};
    } else if (user.role === Role.SUPER_ADMIN) {
      where = {
        OR: [
          {
            status: {
              not: CandidateRequisitionStatus.PENDING_VERTICAL_APPROVAL,
            },
          },
          {
            status: CandidateRequisitionStatus.PENDING_VERTICAL_APPROVAL,
            vertical: { ownerId: null },
          },
        ],
      };
    } else {
      where = {
        OR: [{ requestedById: user.id }, { vertical: { ownerId: user.id } }],
      };
    }
    return this.prisma.candidateRequisition.findMany({
      where,
      include,
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Approved and fulfilled requisitions available to seed onboarding.
   * An approved Offer Letter is optional enrichment: when present, values come
   * from its frozen approval snapshot; otherwise only the confirmed name is
   * returned and HR enters the employment terms manually. */
  async listOnboardingOptions(user: AuthenticatedUser) {
    const isAdmin = user.role === Role.ADMIN || user.role === Role.SUPER_ADMIN;
    if (!isAdmin && !(await this.isHrStaff(user))) {
      throw new ForbiddenException(
        'Only HR-vertical staff or Admins may access onboarding requisitions',
      );
    }
    const requisitions = await this.prisma.candidateRequisition.findMany({
      where: {
        status: CandidateRequisitionStatus.APPROVED,
        hiringStage: CandidateHiringStage.CANDIDATE_SELECTED,
        onboardedEmployeeId: null,
      },
      select: {
        id: true,
        requisitionNumber: true,
        positionTitle: true,
        employmentType: true,
        selectedCandidateName: true,
        vertical: { select: { id: true, name: true } },
        offerLetter: {
          select: {
            id: true,
            referenceNumber: true,
            status: true,
            snapshotData: true,
          },
        },
      },
      orderBy: { superAdminApprovedAt: 'asc' },
    });

    return requisitions.map((requisition) => {
      const approvedOffer =
        requisition.offerLetter?.status === OfferLetterStatus.APPROVED
          ? requisition.offerLetter
          : null;
      const snapshot = (approvedOffer?.snapshotData ?? {}) as Record<
        string,
        any
      >;
      const employee = (snapshot.employee ?? {}) as Record<string, any>;
      const compensation = (snapshot.compensation ?? {}) as Record<string, any>;
      const direct = Array.isArray(compensation.directComponents)
        ? compensation.directComponents
        : [];
      const indirect = Array.isArray(compensation.indirectBenefits)
        ? compensation.indirectBenefits
        : [];
      const grandTotal = (compensation.grandTotal ?? {}) as Record<string, any>;
      const amount = (
        rows: Array<Record<string, any>>,
        label: string,
        period: 'perMonth' | 'perAnnum' = 'perMonth',
      ) => rows.find((row) => row.label === label)?.[period] ?? null;

      return {
        id: requisition.id,
        requisitionNumber: requisition.requisitionNumber,
        offerLetterId: approvedOffer?.id ?? null,
        offerReferenceNumber: approvedOffer?.referenceNumber ?? null,
        hasApprovedOffer: !!approvedOffer,
        selectedCandidateName: requisition.selectedCandidateName ?? '',
        // Role facts come straight from the approved requisition, so they
        // prefill even before an Offer Letter exists. An approved Offer Letter,
        // when present, can still override the designation/type it snapshotted.
        // (Compensation and joining details below stay offer-gated — those are
        // never safe to guess without an approved offer.)
        designation: approvedOffer
          ? (employee.designation ?? requisition.positionTitle)
          : requisition.positionTitle,
        employmentType: approvedOffer
          ? (employee.employmentType ?? requisition.employmentType)
          : requisition.employmentType,
        vertical: requisition.vertical,
        dateOfJoining: approvedOffer ? (employee.dateOfJoining ?? null) : null,
        workLocation: approvedOffer ? (employee.workLocation ?? null) : null,
        territory: approvedOffer ? (employee.territory ?? null) : null,
        compensation: approvedOffer
          ? {
              monthlyCtc: grandTotal.perMonth ?? null,
              basicSalary: amount(direct, 'Basic Salary'),
              hra: amount(direct, 'House Rent Allowance (HRA)'),
              specialAllowance: amount(direct, 'Special Allowance'),
              variablePay: amount(indirect, 'Variable Pay', 'perAnnum'),
              effectiveDate: compensation.effectiveFrom ?? null,
            }
          : null,
      };
    });
  }

  async updateHiringLifecycle(
    id: string,
    dto: UpdateCandidateHiringLifecycleDto,
    user: AuthenticatedUser,
  ) {
    if (!(await this.isHrStaff(user))) {
      throw new ForbiddenException(
        'Only HR-vertical employees may update the hiring lifecycle',
      );
    }
    const req = await this.find(id);
    if (req.status !== CandidateRequisitionStatus.APPROVED) {
      throw new BadRequestException(
        'Hiring progress can only be updated after the requisition is approved',
      );
    }
    if (req.hiringStage === CandidateHiringStage.CANDIDATE_SELECTED) {
      throw new BadRequestException('A fulfilled requisition is terminal');
    }

    const candidateName = dto.selectedCandidateName?.trim() ?? '';
    const targetStage = candidateName
      ? CandidateHiringStage.CANDIDATE_SELECTED
      : dto.hiringStage;
    if (
      targetStage === CandidateHiringStage.CANDIDATE_SELECTED &&
      !candidateName
    ) {
      throw new BadRequestException(
        'Selected candidate name is required to fulfil the requisition',
      );
    }

    const order: CandidateHiringStage[] = [
      CandidateHiringStage.JOB_POSTED,
      CandidateHiringStage.INTERVIEWING,
      CandidateHiringStage.OFFER_EXTENDED,
      CandidateHiringStage.CANDIDATE_SELECTED,
    ];
    if (
      req.hiringStage &&
      order.indexOf(targetStage) < order.indexOf(req.hiringStage)
    ) {
      throw new BadRequestException('Hiring lifecycle cannot move backwards');
    }

    return this.prisma.candidateRequisition.update({
      where: { id },
      data: {
        hiringStage: targetStage,
        selectedCandidateName:
          targetStage === CandidateHiringStage.CANDIDATE_SELECTED
            ? candidateName
            : null,
      },
      include,
    });
  }

  async listVerticalPending(user: AuthenticatedUser) {
    // This is deliberately stricter than the earlier one-of-many gates:
    // SuperAdmin is invisible until the vertical owner has approved.
    if (user.role === Role.SUPER_ADMIN) return [];
    return this.prisma.candidateRequisition.findMany({
      where: {
        status: CandidateRequisitionStatus.PENDING_VERTICAL_APPROVAL,
        requestedById: { not: user.id },
        vertical: { ownerId: user.id },
      },
      include,
      orderBy: { createdAt: 'asc' },
    });
  }

  listSuperAdminPending(user: AuthenticatedUser) {
    this.assertSuperAdmin(user);
    return this.prisma.candidateRequisition.findMany({
      where: {
        OR: [
          { status: CandidateRequisitionStatus.PENDING_SUPERADMIN_APPROVAL },
          // Fallback: a vertical with no owner has no first-stage approver, so the
          // requisition routes straight to the CEO — a single approval finalises it.
          {
            status: CandidateRequisitionStatus.PENDING_VERTICAL_APPROVAL,
            vertical: { ownerId: null },
          },
        ],
      },
      include,
      orderBy: { createdAt: 'asc' },
    });
  }

  async approveVertical(id: string, user: AuthenticatedUser) {
    if (user.role === Role.SUPER_ADMIN)
      throw new ForbiddenException(
        'The CEO cannot perform the first-stage vertical approval',
      );
    const req = await this.find(id);
    if (req.status !== CandidateRequisitionStatus.PENDING_VERTICAL_APPROVAL)
      throw new BadRequestException(
        'This requisition is not awaiting vertical approval',
      );
    if (req.requestedById === user.id)
      throw new ForbiddenException('You cannot approve your own requisition');
    if (req.vertical.ownerId !== user.id)
      throw new ForbiddenException(
        'Only the requisition vertical owner may perform the first approval',
      );
    return this.prisma.candidateRequisition.update({
      where: { id },
      data: {
        status: CandidateRequisitionStatus.PENDING_SUPERADMIN_APPROVAL,
        verticalApprovedById: user.id,
        verticalApprovedAt: new Date(),
      },
      include,
    });
  }

  async rejectVertical(id: string, comment: string, user: AuthenticatedUser) {
    if (user.role === Role.SUPER_ADMIN)
      throw new ForbiddenException(
        'The CEO cannot perform the first-stage vertical decision',
      );
    const req = await this.find(id);
    this.assertComment(comment);
    if (
      req.status !== CandidateRequisitionStatus.PENDING_VERTICAL_APPROVAL ||
      req.vertical.ownerId !== user.id ||
      req.requestedById === user.id
    )
      throw new ForbiddenException(
        'Only the requisition vertical owner may reject at this stage',
      );
    return this.rejectRecord(id, comment, user.id);
  }

  async approveSuperAdmin(id: string, user: AuthenticatedUser) {
    this.assertSuperAdmin(user);
    const req = await this.find(id);
    const ownerlessFallback = this.isOwnerlessVerticalFallback(req);
    if (
      !ownerlessFallback &&
      (req.status !== CandidateRequisitionStatus.PENDING_SUPERADMIN_APPROVAL ||
        !req.verticalApprovedAt)
    )
      throw new BadRequestException(
        'Vertical approval must be completed first',
      );
    // When the CEO clears an ownerless vertical, stamp the vertical stage too so the audit trail records who approved it.
    const now = new Date();
    return this.prisma.candidateRequisition.update({
      where: { id },
      data: {
        status: CandidateRequisitionStatus.APPROVED,
        superAdminApprovedById: user.id,
        superAdminApprovedAt: now,
        ...(ownerlessFallback
          ? { verticalApprovedById: user.id, verticalApprovedAt: now }
          : {}),
      },
      include,
    });
  }

  async rejectSuperAdmin(id: string, comment: string, user: AuthenticatedUser) {
    this.assertSuperAdmin(user);
    const req = await this.find(id);
    this.assertComment(comment);
    if (
      !this.isOwnerlessVerticalFallback(req) &&
      (req.status !== CandidateRequisitionStatus.PENDING_SUPERADMIN_APPROVAL ||
        !req.verticalApprovedAt)
    )
      throw new BadRequestException(
        'Only requisitions approved by the vertical owner can be decided here',
      );
    return this.rejectRecord(id, comment, user.id);
  }

  /** A requisition whose vertical has no owner has no first-stage approver, so the CEO decides it directly. */
  private isOwnerlessVerticalFallback(req: {
    status: CandidateRequisitionStatus;
    vertical: { ownerId: string | null };
  }) {
    return (
      req.status === CandidateRequisitionStatus.PENDING_VERTICAL_APPROVAL &&
      !req.vertical.ownerId
    );
  }

  async availableForEmployee(employeeId: string, user: AuthenticatedUser) {
    if (
      user.role !== Role.MANAGER &&
      user.role !== Role.ADMIN &&
      user.role !== Role.SUPER_ADMIN
    )
      throw new ForbiddenException('You cannot create offer letters');
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: { verticalId: true, designation: true },
    });
    if (!employee) throw new NotFoundException('Employee not found');
    return this.prisma.candidateRequisition.findMany({
      where: {
        status: CandidateRequisitionStatus.APPROVED,
        consumedAt: null,
        offerLetter: null,
        verticalId: employee.verticalId ?? undefined,
        positionTitle: {
          equals: employee.designation ?? '',
          mode: 'insensitive',
        },
      },
      include,
      orderBy: { superAdminApprovedAt: 'asc' },
    });
  }

  private async find(id: string) {
    const req = await this.prisma.candidateRequisition.findUnique({
      where: { id },
      include,
    });
    if (!req) throw new NotFoundException('Candidate requisition not found');
    return req;
  }
  private rejectRecord(id: string, comment: string, userId: string) {
    return this.prisma.candidateRequisition.update({
      where: { id },
      data: {
        status: CandidateRequisitionStatus.REJECTED,
        rejectedById: userId,
        rejectedAt: new Date(),
        rejectionComment: comment.trim(),
      },
      include,
    });
  }
  private assertComment(comment: string) {
    if (!comment?.trim())
      throw new BadRequestException('A comment is required when rejecting');
  }
  private assertSuperAdmin(user: AuthenticatedUser) {
    if (user.role !== Role.SUPER_ADMIN)
      throw new ForbiddenException(
        'Only the CEO may perform the final approval',
      );
  }
  private async isHrStaff(user: AuthenticatedUser) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: user.id },
      select: { vertical: { select: { code: true } } },
    });
    return employee?.vertical?.code?.toUpperCase() === 'HR';
  }
}
