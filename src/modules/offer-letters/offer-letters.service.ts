import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OfferLetterStatus, Prisma, Role } from '@prisma/client';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../core/database/prisma.service';
import { PayrollComputationService } from '../payroll/payroll-computation.service';
import { CtcBreakdownEntity } from '../payroll/entities/ctc-breakdown.entity';
import { OfferLetterDecisionDto } from './dto/offer-letter-decision.dto';
import { SaveOfferLetterDto } from './dto/save-offer-letter.dto';

/**
 * Employee include used to assemble the printable document — carries the
 * position/reporting fields plus the vertical (with its owner, who is the
 * approval router) and the reporting manager.
 */
const documentEmployeeInclude = {
  vertical: {
    select: {
      name: true,
      owner: { select: { id: true, firstName: true, lastName: true } },
    },
  },
  reportingManager: {
    select: { firstName: true, lastName: true, designation: true },
  },
} satisfies Prisma.EmployeeInclude;

/** The offer-with-approval-context include reused by every fetch that renders. */
const approvalContextInclude = {
  employee: { include: documentEmployeeInclude },
  approver: { select: { firstName: true, lastName: true } },
  candidateRequisition: { select: { id: true, requisitionNumber: true, positionTitle: true } },
} satisfies Prisma.OfferLetterInclude;

type OfferWithApprovalContext = Prisma.OfferLetterGetPayload<{
  include: typeof approvalContextInclude;
}>;

/**
 * The curated, printable document payload. Assembled live from the offer +
 * computed CTC for DRAFT/REJECTED, and frozen verbatim into `snapshotData` at
 * submission (Dates serialized to ISO strings — the type is intentionally
 * date-as-`unknown`-tolerant since the stored JSON re-hydrates as strings).
 */
type RenderedOfferDocument = {
  referenceNumber: string;
  keyResponsibilities: string;
  kpis: string;
  createdAt: Date | string;
  employee: {
    firstName: string;
    lastName: string;
    gender: string | null;
    designation: string | null;
    employmentType: string | null;
    dateOfJoining: Date | string | null;
    workLocation: string | null;
    territory: string | null;
    vertical: { name: string } | null;
    reportingManager: {
      firstName: string;
      lastName: string;
      designation: string | null;
    } | null;
  };
  compensation: CtcBreakdownEntity;
};

@Injectable()
export class OfferLettersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly payroll: PayrollComputationService,
  ) {}

  async list(user: AuthenticatedUser) {
    await this.assertAccess(user);
    return this.prisma.offerLetter.findMany({
      orderBy: { updatedAt: 'desc' },
      include: {
        employee: {
          select: {
            id: true,
            employeeId: true,
            firstName: true,
            lastName: true,
            designation: true,
          },
        },
      },
    });
  }

  async save(dto: SaveOfferLetterDto, user: AuthenticatedUser) {
    await this.assertAccess(user);
    const employee = await this.prisma.employee.findUnique({
      where: { id: dto.employeeId },
      select: { id: true, designation: true, territory: true, verticalId: true },
    });
    if (!employee) throw new NotFoundException('Employee not found');

    const existing = await this.prisma.offerLetter.findUnique({
      where: { employeeId: dto.employeeId },
    });
    if (existing) {
      // Any edit after submission (whether still pending or already approved)
      // invalidates the current approval: the letter drops back to DRAFT and
      // the frozen snapshot is discarded, so a fresh submission is required and
      // an approval never silently carries over data that has since changed.
      const invalidates =
        existing.status === OfferLetterStatus.PENDING_APPROVAL ||
        existing.status === OfferLetterStatus.APPROVED ||
        existing.status === OfferLetterStatus.REJECTED;
      return this.prisma.offerLetter.update({
        where: { id: existing.id },
        data: {
          keyResponsibilities: dto.keyResponsibilities,
          kpis: dto.kpis,
          ...(invalidates
            ? {
                status: OfferLetterStatus.DRAFT,
                snapshotData: Prisma.DbNull,
                approverId: null,
                submittedAt: null,
                decidedAt: null,
                approverComments: null,
              }
            : {}),
        },
      });
    }

    if (!dto.candidateRequisitionId) {
      throw new BadRequestException(
        'An approved, unconsumed candidate requisition is required to create a new offer letter',
      );
    }
    const referenceNumber = await this.generateReferenceNumber(
      employee.designation,
      employee.territory,
    );
    return this.prisma.$transaction(async (tx) => {
      const requisition = await tx.candidateRequisition.findUnique({
        where: { id: dto.candidateRequisitionId },
        include: { offerLetter: { select: { id: true } } },
      });
      if (!requisition || requisition.status !== 'APPROVED' || requisition.consumedAt || requisition.offerLetter) {
        throw new BadRequestException('The selected candidate requisition is not approved and available');
      }
      if (requisition.verticalId !== employee.verticalId) {
        throw new BadRequestException('The requisition vertical does not match the employee vertical');
      }
      if (requisition.positionTitle.trim().toLocaleLowerCase() !== (employee.designation ?? '').trim().toLocaleLowerCase()) {
        throw new BadRequestException('The requisition position does not match the employee designation');
      }
      const offer = await tx.offerLetter.create({
        data: {
          employeeId: dto.employeeId,
          candidateRequisitionId: requisition.id,
          referenceNumber,
          keyResponsibilities: dto.keyResponsibilities,
          kpis: dto.kpis,
          createdById: user.id,
        },
      });
      await tx.candidateRequisition.update({ where: { id: requisition.id }, data: { consumedAt: new Date() } });
      return offer;
    });
  }

  /**
   * The printable document resolved for a given employee. DRAFT/REJECTED return
   * LIVE data (HR is authoring/previewing); PENDING_APPROVAL and APPROVED return
   * the FROZEN snapshot taken at submission — that is exactly what the vertical
   * owner reviewed and what downloads after approval, never a re-fetched version
   * that could have changed since the decision. Always carries the live status
   * metadata (status + approver/owner names + comments) so the UI can gate the
   * download and explain why.
   */
  async getForEmployee(employeeId: string, user: AuthenticatedUser) {
    await this.assertAccess(user);
    const offer = await this.findWithApprovalContext(undefined, employeeId);
    return this.buildResponse(offer);
  }

  /**
   * The offer letter as the APPROVER sees it, fetched by primary id for the
   * approval inbox. Authorized by `assertCanDecide` (the routed vertical owner
   * or a Super Admin) rather than the HR-authoring check — the approver is
   * usually NOT in HR. Serves the frozen snapshot they must decide on.
   */
  async reviewForApproval(id: string, user: AuthenticatedUser) {
    const offer = await this.findWithApprovalContext(id);
    this.assertCanDecide(offer, user);
    return this.buildResponse(offer);
  }

  /**
   * Assembles the API response for a fetched offer (with document + approval
   * includes). PENDING_APPROVAL and APPROVED serve the FROZEN snapshot — exactly
   * what the owner reviewed and what downloads after approval, never a re-fetched
   * version that could have changed since the decision; DRAFT/REJECTED serve LIVE
   * data (HR is authoring). Always carries the live status metadata so the UI can
   * gate the download and explain why. Deliberately does NOT re-check HR access —
   * the caller (getForEmployee, or an approver acting via approve/reject) has
   * already been authorized for its own path.
   */
  private async buildResponse(offer: OfferWithApprovalContext) {
    const useSnapshot =
      (offer.status === OfferLetterStatus.PENDING_APPROVAL ||
        offer.status === OfferLetterStatus.APPROVED) &&
      offer.snapshotData != null;

    const document: RenderedOfferDocument = useSnapshot
      ? (offer.snapshotData as unknown as RenderedOfferDocument)
      : this.assembleDocument(
          offer,
          await this.payroll.computeCtcBreakdown(offer.employeeId),
        );

    return {
      ...document,
      status: offer.status,
      submittedAt: offer.submittedAt,
      decidedAt: offer.decidedAt,
      approverComments: offer.approverComments,
      // Who decided (or is assigned to decide), and the current vertical owner
      // the letter routes to on submit. Either may be null → SuperAdmin-only.
      approver: offer.approver ?? null,
      verticalOwner: offer.employee.vertical?.owner
        ? {
            firstName: offer.employee.vertical.owner.firstName,
            lastName: offer.employee.vertical.owner.lastName,
          }
        : null,
    };
  }

  /**
   * DRAFT/REJECTED -> PENDING_APPROVAL. Freezes the current rendered document
   * (position/reporting + computed CTC/Annexure A) onto the record and routes
   * it to the new hire's vertical owner. If the vertical has no owner — or the
   * owner would be the new hire or the submitter (self-approval) — it routes to
   * SuperAdmin only (approverId left null).
   */
  async submit(employeeId: string, user: AuthenticatedUser) {
    await this.assertAccess(user);
    const offer = await this.findWithApprovalContext(undefined, employeeId);

    if (
      offer.status !== OfferLetterStatus.DRAFT &&
      offer.status !== OfferLetterStatus.REJECTED
    ) {
      throw new BadRequestException(
        `Only a draft or rejected offer letter can be submitted (current status: ${offer.status})`,
      );
    }
    if (!offer.keyResponsibilities.trim() || !offer.kpis.trim()) {
      throw new BadRequestException(
        'Key Responsibilities and KPIs must be authored before submission',
      );
    }

    const compensation = await this.payroll.computeCtcBreakdown(employeeId);
    const snapshot = this.assembleDocument(offer, compensation);
    const approverId = this.resolveApproverId(offer);

    await this.prisma.offerLetter.update({
      where: { id: offer.id },
      data: {
        status: OfferLetterStatus.PENDING_APPROVAL,
        // JSON-serialize to freeze Dates as ISO strings and store a pure,
        // curated payload (never the raw employee row).
        snapshotData: JSON.parse(
          JSON.stringify(snapshot),
        ) as Prisma.InputJsonValue,
        approverId,
        submittedAt: new Date(),
        decidedAt: null,
        approverComments: null,
      },
    });
    return this.buildResponse(
      await this.findWithApprovalContext(undefined, employeeId),
    );
  }

  /** Vertical owner (or SuperAdmin) signs off the frozen snapshot as-is. */
  async approve(id: string, dto: OfferLetterDecisionDto, user: AuthenticatedUser) {
    const offer = await this.findWithApprovalContext(id);
    this.assertCanDecide(offer, user);
    if (offer.status !== OfferLetterStatus.PENDING_APPROVAL) {
      throw new BadRequestException(
        'Only an offer letter awaiting approval can be approved',
      );
    }
    await this.prisma.offerLetter.update({
      where: { id },
      data: {
        status: OfferLetterStatus.APPROVED,
        approverId: user.id,
        decidedAt: new Date(),
        approverComments: dto.approverComments?.trim() || null,
      },
    });
    // buildResponse (not getForEmployee) — the approver is a vertical owner, who
    // is typically NOT in HR, so re-running the HR-authoring access check would
    // 403 them right after their decision persisted.
    return this.buildResponse(await this.findWithApprovalContext(id));
  }

  /**
   * Vertical owner (or SuperAdmin) rejects the submission. A comment is
   * REQUIRED (matches every other rejection gate). The letter returns to a
   * revisable state (REJECTED) with the snapshot discarded, so HR edits against
   * live data and resubmits for a fresh approval.
   */
  async reject(id: string, dto: OfferLetterDecisionDto, user: AuthenticatedUser) {
    const offer = await this.findWithApprovalContext(id);
    this.assertCanDecide(offer, user);
    if (offer.status !== OfferLetterStatus.PENDING_APPROVAL) {
      throw new BadRequestException(
        'Only an offer letter awaiting approval can be rejected',
      );
    }
    const comment = dto.approverComments?.trim();
    if (!comment) {
      throw new BadRequestException('A comment is required when rejecting');
    }
    await this.prisma.offerLetter.update({
      where: { id },
      data: {
        status: OfferLetterStatus.REJECTED,
        approverId: user.id,
        decidedAt: new Date(),
        approverComments: comment,
        snapshotData: Prisma.DbNull,
      },
    });
    return this.buildResponse(await this.findWithApprovalContext(id));
  }

  /**
   * Offer letters awaiting the caller's approval. SuperAdmin sees every pending
   * letter (including owner-less ones that fall back to SuperAdmin-only);
   * everyone else sees only the letters routed to them as vertical owner. Any
   * caller a letter isn't routed to gets an empty list — role-safe by
   * construction, so this needs no HR-authoring access check.
   */
  async listPendingApproval(user: AuthenticatedUser) {
    return this.prisma.offerLetter.findMany({
      where: this.pendingApprovalWhere(user),
      orderBy: { submittedAt: 'asc' },
      include: {
        employee: {
          select: {
            id: true,
            employeeId: true,
            firstName: true,
            lastName: true,
            designation: true,
          },
        },
      },
    });
  }

  /** Count backing the pending-approval sidebar badge (same where-clause). */
  countPendingApproval(user: AuthenticatedUser): Promise<number> {
    return this.prisma.offerLetter.count({
      where: this.pendingApprovalWhere(user),
    });
  }

  // ---- internals ----------------------------------------------------------

  private pendingApprovalWhere(
    user: AuthenticatedUser,
  ): Prisma.OfferLetterWhereInput {
    if (user.role === Role.SUPER_ADMIN) {
      return { status: OfferLetterStatus.PENDING_APPROVAL };
    }
    return {
      status: OfferLetterStatus.PENDING_APPROVAL,
      approverId: user.id,
    };
  }

  /**
   * Fetch one offer with the full document + approval includes, by primary id
   * (approve/reject) or by employeeId (getForEmployee/submit). Throws 404 if
   * absent. The return type is the single source of truth for buildResponse.
   */
  private async findWithApprovalContext(
    id: string | undefined,
    employeeId?: string,
  ): Promise<OfferWithApprovalContext> {
    const offer = await this.prisma.offerLetter.findUnique({
      where: id ? { id } : { employeeId: employeeId! },
      include: approvalContextInclude,
    });
    if (!offer) throw new NotFoundException('Offer letter not found');
    return offer;
  }

  /**
   * The employee who must approve this letter, or null when it falls to
   * SuperAdmin only. The router is the new hire's vertical owner — unless that
   * owner is the new hire themselves (subject) or the submitter (creator), in
   * which case there is no non-conflicted owner and it degrades to SuperAdmin.
   */
  private resolveApproverId(offer: {
    employeeId: string;
    createdById: string;
    employee: { vertical: { owner: { id: string } | null } | null };
  }): string | null {
    const ownerId = offer.employee.vertical?.owner?.id ?? null;
    if (!ownerId) return null;
    if (ownerId === offer.employeeId || ownerId === offer.createdById) {
      return null;
    }
    return ownerId;
  }

  /**
   * Throws unless `user` may approve/reject `offer`. The one inviolable rule is
   * that the SUBJECT of the letter (the new hire) may never approve their own
   * offer — checked first, so even a SuperAdmin who is themselves the new hire
   * is blocked. A SuperAdmin may act on anything else: they are the terminal
   * approver and the owner-less fallback target, so they can clear a letter they
   * submitted too (blocking that would deadlock an owner-less vertical whose
   * letter only a SuperAdmin can approve). A non-SuperAdmin may not approve a
   * letter they submitted (separation of duties: HR submits, the vertical owner
   * approves); otherwise the caller must be the routed vertical owner.
   */
  private assertCanDecide(
    offer: {
      employeeId: string;
      createdById: string;
      approverId: string | null;
    },
    user: AuthenticatedUser,
  ): void {
    if (user.id === offer.employeeId) {
      throw new ForbiddenException('You cannot approve your own offer letter');
    }
    if (user.role === Role.SUPER_ADMIN) return;
    if (user.id === offer.createdById) {
      throw new ForbiddenException(
        'You cannot approve an offer letter you submitted',
      );
    }
    if (offer.approverId && offer.approverId === user.id) return;
    throw new ForbiddenException(
      'Only the new hire’s vertical owner or the CEO may act on this offer letter',
    );
  }

  /** Curated, printable document payload (never the raw employee row). */
  private assembleDocument(
    offer: OfferWithApprovalContext,
    compensation: CtcBreakdownEntity,
  ): RenderedOfferDocument {
    const e = offer.employee;
    return {
      referenceNumber: offer.referenceNumber,
      keyResponsibilities: offer.keyResponsibilities,
      kpis: offer.kpis,
      createdAt: offer.createdAt,
      employee: {
        firstName: e.firstName,
        lastName: e.lastName,
        gender: e.gender ?? null,
        designation: e.designation ?? null,
        employmentType: e.employmentType ?? null,
        dateOfJoining: e.dateOfJoining ?? null,
        workLocation: e.workLocation ?? null,
        territory: e.territory ?? null,
        vertical: e.vertical ? { name: e.vertical.name } : null,
        reportingManager: e.reportingManager
          ? {
              firstName: e.reportingManager.firstName,
              lastName: e.reportingManager.lastName,
              designation: e.reportingManager.designation ?? null,
            }
          : null,
      },
      compensation,
    };
  }

  private async assertAccess(user: AuthenticatedUser) {
    if (user.role === Role.SUPER_ADMIN || user.role === Role.ADMIN) return;
    if (user.role !== Role.MANAGER) {
      throw new ForbiddenException(
        'Offer letters are available only to HR Managers or Admins',
      );
    }
    const employee = await this.prisma.employee.findUnique({
      where: { id: user.id },
      include: { vertical: { select: { code: true } } },
    });
    if (employee?.vertical?.code !== 'HR') {
      throw new ForbiddenException(
        'Offer letters are available only to HR Managers or Admins',
      );
    }
  }

  private async generateReferenceNumber(
    designation: string | null,
    territory: string | null,
  ) {
    const initials = (designation || 'Offer')
      .split(/\s+/)
      .filter(Boolean)
      .map((part) => part[0])
      .join('')
      .toUpperCase();
    const territoryCode = territory
      ? `-${territory
          .trim()
          .split(/\s+/)[0]
          .replace(/[^a-z0-9]/gi, '')}`
      : '';
    const base = `PD/HR/${new Date().getFullYear()}/${initials}${territoryCode}`;
    let candidate = base;
    let suffix = 2;
    while (
      await this.prisma.offerLetter.findUnique({
        where: { referenceNumber: candidate },
      })
    ) {
      candidate = `${base}-${suffix++}`;
    }
    return candidate;
  }
}
