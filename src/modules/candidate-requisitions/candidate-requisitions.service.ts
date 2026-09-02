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
import {
  PendingQueue,
  pendingQueueFromRows,
} from '../../common/types/pending-queue';
import { PrismaService } from '../../core/database/prisma.service';
import { SalesNumberingService } from '../sales/common/sales-numbering.service';
import { PushEventsService } from '../notifications/push-events.service';
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
  // A requisition can accumulate several letters over its life — a declined
  // offer releases the requisition so the next applicant can be made one — so
  // this is a list. `consumedAt` is what enforces "only one LIVE offer".
  offerLetters: {
    select: {
      id: true,
      employeeId: true,
      candidateApplicationId: true,
      referenceNumber: true,
      status: true,
      sentAt: true,
      acceptedAt: true,
      declinedAt: true,
    },
    orderBy: { createdAt: 'desc' },
  },
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
    // PushEventsModule is @Global, so this needs no import edge here.
    private readonly pushEvents: PushEventsService,
  ) {}

  /**
   * Tell whoever the requisition now waits on. Routing reuses
   * `ceoMayFinaliseAtVerticalStage`, the same predicate `approveVertical` and the
   * CEO's queue use, so a push can never reach someone the gate would refuse.
   */
  private pushPendingApproval(
    req: {
      id: string;
      status: CandidateRequisitionStatus;
      requisitionNumber: string;
      positionTitle: string;
      requestedById: string;
      vertical?: { ownerId: string | null } | null;
    },
    actorId: string,
  ): void {
    const toCeo =
      req.status === CandidateRequisitionStatus.PENDING_SUPERADMIN_APPROVAL ||
      this.ceoMayFinaliseAtVerticalStage(req);
    void this.pushEvents.approvalRequired({
      kind: 'candidate-requisition',
      // Optional all the way down: assembling a push argument is the one part of
      // this that runs before the best-effort boundary, so it must not be able to
      // throw into the caller. No owner resolves to no recipient, which
      // PushEventsService treats as a silent no-op.
      audience: toCeo
        ? { pool: 'SUPER_ADMIN' }
        : { employeeIds: [req.vertical?.ownerId] },
      reference: `${req.requisitionNumber} — ${req.positionTitle}`,
      requestedById: req.requestedById,
      recordId: req.id,
      // Requisitions live in one list page, so the deep link focuses the row.
      url: `/hr/candidate-requisitions?focus=${encodeURIComponent(req.id)}`,
      actorId,
    });
  }

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
    // Bulk raise: N identical positions in one atomic submit. Each row keeps
    // the 1-requisition-per-candidate lifecycle (own approval, offer letter,
    // onboarding), so ten openings for the same role are ten rows with
    // consecutive REQ numbers — all created or none.
    const count = dto.numberOfPositions ?? 1;
    const created = await this.prisma.$transaction(async (tx) => {
      const created = [];
      for (let i = 0; i < count; i++) {
        const requisitionNumber = await this.numbering.nextNumber(
          'REQ',
          'candidate_requisition',
          new Date().getFullYear(),
          tx,
        );
        created.push(
          await tx.candidateRequisition.create({
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
          }),
        );
      }
      return created;
    });
    this.pushCreated(created, user.id);
    return created;
  }

  /**
   * A bulk raise of N positions is N approvals, so each row pushes its own — the
   * approver has to decide them one at a time, and a single "10 requisitions"
   * notification would not tell them which.
   *
   * Fired after the transaction returns, never inside it: a push about a
   * requisition whose transaction then rolled back points at nothing.
   */
  private pushCreated(
    created: Array<{
      id: string;
      status: CandidateRequisitionStatus;
      requisitionNumber: string;
      positionTitle: string;
      requestedById: string;
      vertical: { ownerId: string | null };
    }>,
    actorId: string,
  ): void {
    for (const req of created) this.pushPendingApproval(req, actorId);
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
   * the authorization. HR staff and the CEO both get unrestricted visibility of
   * every requisition from the moment it is raised; everyone else sees only
   * their own requests or the verticals they own. (The sequential approval gate
   * still governs who may *act* on a requisition — see the approve/reject
   * methods — this only widens what the CEO can *see*.) */
  async listRegister(user: AuthenticatedUser) {
    const hrStaff = await this.isHrStaff(user);
    let where: Prisma.CandidateRequisitionWhereInput;
    if (hrStaff || user.role === Role.SUPER_ADMIN) {
      where = {};
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

  /** Requisitions whose candidate has ACCEPTED an approved offer letter — the
   * only requisitions that may be onboarded.
   *
   * Selection at interview is not a hire and the hiring stage is not the gate:
   * the gate is an approved letter the candidate said yes to. Because that letter
   * is now guaranteed to exist, its frozen snapshot is the normal prefill source
   * rather than optional enrichment — every employment term the wizard needs was
   * approved and agreed before we got here. The requisition reaches
   * CANDIDATE_SELECTED when onboarding completes, not before, so this
   * deliberately does not filter on the stage. */
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
        onboardedEmployeeId: null,
        offerLetters: {
          some: {
            status: OfferLetterStatus.APPROVED,
            acceptedAt: { not: null },
            declinedAt: null,
          },
        },
      },
      select: {
        id: true,
        requisitionNumber: true,
        positionTitle: true,
        employmentType: true,
        selectedCandidateName: true,
        vertical: { select: { id: true, name: true } },
        offerLetters: {
          where: {
            status: OfferLetterStatus.APPROVED,
            acceptedAt: { not: null },
            declinedAt: null,
          },
          select: {
            id: true,
            referenceNumber: true,
            status: true,
            snapshotData: true,
            acceptedAt: true,
            candidateApplication: { select: { id: true, name: true } },
          },
          orderBy: { acceptedAt: 'desc' },
          take: 1,
        },
      },
      orderBy: { superAdminApprovedAt: 'asc' },
    });

    return requisitions.map((requisition) => {
      // Guaranteed present by the `some` filter above; the `?? null` keeps the
      // mapping honest rather than asserting.
      const approvedOffer = requisition.offerLetters[0] ?? null;
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
        offerAcceptedAt: approvedOffer?.acceptedAt ?? null,
        candidateApplicationId: approvedOffer?.candidateApplication?.id ?? null,
        // The name on the accepted offer is the authoritative one — it is who the
        // letter was addressed to. The requisition's copy is the fallback for a
        // legacy employee-anchored letter, which has no application behind it.
        selectedCandidateName:
          approvedOffer?.candidateApplication?.name ??
          requisition.selectedCandidateName ??
          '',
        // Every term below comes from the frozen snapshot the candidate accepted,
        // falling back to the requisition only where the snapshot is silent — so
        // the employee record, the first salary structure and the signed letter
        // all say the same thing.
        designation: employee.designation ?? requisition.positionTitle,
        employmentType: employee.employmentType ?? requisition.employmentType,
        vertical: requisition.vertical,
        dateOfJoining: employee.dateOfJoining ?? null,
        workLocation: employee.workLocation ?? null,
        territory: employee.territory ?? null,
        compensation: {
          monthlyCtc: grandTotal.perMonth ?? null,
          basicSalary: amount(direct, 'Basic Salary'),
          hra: amount(direct, 'House Rent Allowance (HRA)'),
          specialAllowance: amount(direct, 'Special Allowance'),
          variablePay: amount(indirect, 'Variable Pay', 'perAnnum'),
          effectiveDate: compensation.effectiveFrom ?? null,
        },
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

    const targetStage = dto.hiringStage;
    // The last two stages are no longer HR's to type in: OFFER_EXTENDED is what
    // sending an approved offer letter means, and CANDIDATE_SELECTED is what
    // completing the onboarding means. Setting either by hand would claim the
    // position was filled while no offer had been made or accepted — the exact
    // inversion this flow exists to prevent.
    if (targetStage === CandidateHiringStage.OFFER_EXTENDED) {
      throw new BadRequestException(
        'Offer Extended is set by sending the approved offer letter to the candidate',
      );
    }
    if (targetStage === CandidateHiringStage.CANDIDATE_SELECTED) {
      throw new BadRequestException(
        'A requisition is fulfilled when the accepted candidate is onboarded, not before',
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
      data: { hiringStage: targetStage },
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

  async listSuperAdminPending(user: AuthenticatedUser) {
    this.assertSuperAdmin(user);
    // The CEO's queue holds requisitions awaiting the final approval, plus any
    // stuck at the vertical stage that no one else can clear — an ownerless
    // vertical, or one whose owner is the requester (they cannot self-approve).
    // The owner-is-requester case can't be expressed in a Prisma where clause
    // (no column-to-column comparison), so pending-vertical rows are fetched and
    // filtered in memory; the pending set is small.
    const rows = await this.prisma.candidateRequisition.findMany({
      where: {
        status: {
          in: [
            CandidateRequisitionStatus.PENDING_SUPERADMIN_APPROVAL,
            CandidateRequisitionStatus.PENDING_VERTICAL_APPROVAL,
          ],
        },
      },
      include,
      orderBy: { createdAt: 'asc' },
    });
    return rows.filter(
      (req) =>
        req.status === CandidateRequisitionStatus.PENDING_SUPERADMIN_APPROVAL ||
        this.ceoMayFinaliseAtVerticalStage(req),
    );
  }

  /**
   * Badge summary for requisitions awaiting the caller — count plus when the
   * oldest was raised. Mirrors the two queue scopes exactly: the CEO gets the
   * final-approval set plus the vertical-stage fallbacks (which need the same
   * in-memory filter as listSuperAdminPending, since the owner-is-requester case
   * can't be expressed in a where-clause), everyone else gets their own
   * vertical-owner queue. Never throws — a caller who approves nothing reports
   * an empty queue.
   */
  async pendingApprovalQueue(user: AuthenticatedUser): Promise<PendingQueue> {
    if (user.role === Role.SUPER_ADMIN) {
      const rows = await this.prisma.candidateRequisition.findMany({
        where: {
          status: {
            in: [
              CandidateRequisitionStatus.PENDING_SUPERADMIN_APPROVAL,
              CandidateRequisitionStatus.PENDING_VERTICAL_APPROVAL,
            ],
          },
        },
        select: {
          status: true,
          createdAt: true,
          requestedById: true,
          vertical: { select: { ownerId: true } },
        },
        orderBy: { createdAt: 'asc' },
      });
      return pendingQueueFromRows(
        rows.filter(
          (req) =>
            req.status ===
              CandidateRequisitionStatus.PENDING_SUPERADMIN_APPROVAL ||
            this.ceoMayFinaliseAtVerticalStage(req),
        ),
        (req) => req.createdAt,
      );
    }
    const where = {
      status: CandidateRequisitionStatus.PENDING_VERTICAL_APPROVAL,
      requestedById: { not: user.id },
      vertical: { ownerId: user.id },
    };
    const [count, oldest] = await Promise.all([
      this.prisma.candidateRequisition.count({ where }),
      this.prisma.candidateRequisition.findFirst({
        where,
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      }),
    ]);
    return { count, oldestPendingAt: oldest?.createdAt ?? null };
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
    const updated = await this.prisma.candidateRequisition.update({
      where: { id },
      data: {
        status: CandidateRequisitionStatus.PENDING_SUPERADMIN_APPROVAL,
        verticalApprovedById: user.id,
        verticalApprovedAt: new Date(),
      },
      include,
    });
    // Now the CEO's to decide. `approveSuperAdmin` ends the workflow, so it is
    // the only other stage and it has nobody left to notify.
    this.pushPendingApproval(updated, user.id);
    return updated;
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
    const verticalStageFallback = this.ceoMayFinaliseAtVerticalStage(req);
    if (
      !verticalStageFallback &&
      (req.status !== CandidateRequisitionStatus.PENDING_SUPERADMIN_APPROVAL ||
        !req.verticalApprovedAt)
    )
      throw new BadRequestException(
        'Vertical approval must be completed first',
      );
    // When the CEO clears a requisition still at the vertical stage (ownerless
    // vertical, or one the requester owns), stamp the vertical stage too so the
    // audit trail records who approved it.
    const now = new Date();
    return this.prisma.candidateRequisition.update({
      where: { id },
      data: {
        status: CandidateRequisitionStatus.APPROVED,
        superAdminApprovedById: user.id,
        superAdminApprovedAt: now,
        ...(verticalStageFallback
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
      !this.ceoMayFinaliseAtVerticalStage(req) &&
      (req.status !== CandidateRequisitionStatus.PENDING_SUPERADMIN_APPROVAL ||
        !req.verticalApprovedAt)
    )
      throw new BadRequestException(
        'Only requisitions approved by the vertical owner can be decided here',
      );
    return this.rejectRecord(id, comment, user.id);
  }

  /** A requisition can be stuck at the vertical stage with no one able to clear
   * it: the vertical has no owner, or its owner is the requester (self-approval
   * is forbidden). In both cases the CEO finalises it directly, and a single
   * final approval also stamps the vertical stage. */
  private ceoMayFinaliseAtVerticalStage(req: {
    status: CandidateRequisitionStatus;
    requestedById: string;
    vertical?: { ownerId: string | null } | null;
  }) {
    return (
      req.status === CandidateRequisitionStatus.PENDING_VERTICAL_APPROVAL &&
      (!req.vertical?.ownerId || req.vertical.ownerId === req.requestedById)
    );
  }

  // `availableForEmployee` used to match an already-onboarded employee to an
  // unconsumed requisition by vertical + job title, so HR could attach an offer
  // letter to a hire after the fact. Offers are now made to a SELECTED candidate
  // before any employee exists (OfferLettersService.listCandidatesAwaitingOffer),
  // so there is nothing left for it to answer.

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
