import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CandidateHiringStage,
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
import { PayrollComputationService } from '../payroll/payroll-computation.service';
import { CtcBreakdownEntity } from '../payroll/entities/ctc-breakdown.entity';
import { PushEventsService } from '../notifications/push-events.service';
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
      ownerId: true,
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
  verticalApprovedBy: { select: { firstName: true, lastName: true } },
  ceoApprovedBy: { select: { firstName: true, lastName: true } },
  rejectedBy: { select: { firstName: true, lastName: true } },
  candidateRequisition: {
    select: { id: true, requisitionNumber: true, positionTitle: true },
  },
} satisfies Prisma.OfferLetterInclude;

/** Employee columns surfaced in the pending-approval queue rows. Includes the
 *  vertical owner id so the CEO's queue can filter the owner-less / self-owned
 *  fallbacks in memory (see `ceoMayFinaliseAtVerticalStage`). */
const pendingListInclude = {
  employee: {
    select: {
      id: true,
      employeeId: true,
      firstName: true,
      lastName: true,
      designation: true,
      vertical: { select: { ownerId: true } },
    },
  },
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
    // PushEventsModule is @Global, so this needs no import edge here.
    private readonly pushEvents: PushEventsService,
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
      select: {
        id: true,
        designation: true,
        territory: true,
        verticalId: true,
      },
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
        existing.status === OfferLetterStatus.PENDING_VERTICAL_APPROVAL ||
        existing.status === OfferLetterStatus.PENDING_CEO_APPROVAL ||
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
                submittedAt: null,
                ...this.clearedDecisionStamps,
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
      if (
        !requisition ||
        requisition.status !== 'APPROVED' ||
        requisition.consumedAt ||
        requisition.offerLetter
      ) {
        throw new BadRequestException(
          'The selected candidate requisition is not approved and available',
        );
      }
      if (requisition.verticalId !== employee.verticalId) {
        throw new BadRequestException(
          'The requisition vertical does not match the employee vertical',
        );
      }
      if (
        requisition.positionTitle.trim().toLocaleLowerCase() !==
        (employee.designation ?? '').trim().toLocaleLowerCase()
      ) {
        throw new BadRequestException(
          'The requisition position does not match the employee designation',
        );
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
      await tx.candidateRequisition.update({
        where: { id: requisition.id },
        data: {
          consumedAt: new Date(),
          ...(!requisition.hiringStage ||
          requisition.hiringStage === CandidateHiringStage.JOB_POSTED ||
          requisition.hiringStage === CandidateHiringStage.INTERVIEWING
            ? { hiringStage: CandidateHiringStage.OFFER_EXTENDED }
            : {}),
        },
      });
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
   * approval inbox. Authorized by `assertCanReview` (the routed vertical owner
   * or the CEO) rather than the HR-authoring check — the approver is usually
   * NOT in HR. Serves the frozen snapshot they must decide on.
   */
  async reviewForApproval(id: string, user: AuthenticatedUser) {
    const offer = await this.findWithApprovalContext(id);
    this.assertCanReview(offer, user);
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
      (offer.status === OfferLetterStatus.PENDING_VERTICAL_APPROVAL ||
        offer.status === OfferLetterStatus.PENDING_CEO_APPROVAL ||
        offer.status === OfferLetterStatus.APPROVED) &&
      offer.snapshotData != null;

    const document: RenderedOfferDocument = useSnapshot
      ? (offer.snapshotData as unknown as RenderedOfferDocument)
      : this.assembleDocument(
          offer,
          await this.computeOfferCompensation(offer.employeeId),
        );

    return {
      ...document,
      status: offer.status,
      submittedAt: offer.submittedAt,
      approverComments: offer.approverComments,
      // Each stage's decision (who + when) and the current vertical owner the
      // letter routes to on submit (null → the CEO finalises directly).
      verticalApprovedBy: offer.verticalApprovedBy ?? null,
      verticalApprovedAt: offer.verticalApprovedAt,
      ceoApprovedBy: offer.ceoApprovedBy ?? null,
      ceoApprovedAt: offer.ceoApprovedAt,
      rejectedBy: offer.rejectedBy ?? null,
      rejectedAt: offer.rejectedAt,
      verticalOwner: offer.employee.vertical?.owner
        ? {
            firstName: offer.employee.vertical.owner.firstName,
            lastName: offer.employee.vertical.owner.lastName,
          }
        : null,
    };
  }

  /**
   * Compensation for an offer letter is forward-looking: the letter is authored
   * before the hire starts, so we evaluate the CTC as of the joining date rather
   * than "today". A salary structure effective from the start date therefore
   * applies and its effective date never blocks the offer's release. If the
   * earliest structure on file starts even later than the joining date, we use
   * that date instead so any structure on record is still picked up. Only a
   * genuine absence of any salary structure remains an error (nothing to render).
   */
  private async computeOfferCompensation(
    employeeId: string,
  ): Promise<CtcBreakdownEntity> {
    const [employee, earliest] = await Promise.all([
      this.prisma.employee.findUnique({
        where: { id: employeeId },
        select: { dateOfJoining: true },
      }),
      this.prisma.salaryStructure.findFirst({
        where: { employeeId },
        orderBy: { effectiveFrom: 'asc' },
        select: { effectiveFrom: true },
      }),
    ]);
    const candidates = [
      employee?.dateOfJoining,
      earliest?.effectiveFrom,
    ].filter((date): date is Date => date != null);
    const asOf = candidates.length
      ? new Date(Math.max(...candidates.map((date) => date.getTime())))
      : new Date();
    return this.payroll.computeCtcBreakdown(employeeId, asOf);
  }

  /**
   * DRAFT/REJECTED -> PENDING_VERTICAL_APPROVAL. Freezes the current rendered
   * document (position/reporting + computed CTC/Annexure A) onto the record and
   * routes it to the first-stage vertical-owner approval. Routing is derived
   * live from the new hire's vertical owner at decision time (not stamped here),
   * so reassigning the owner before a decision re-routes the letter correctly;
   * an owner-less / self-owned letter is finalised directly by the CEO from the
   * vertical stage (see `ceoMayFinaliseAtVerticalStage`).
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

    const compensation = await this.computeOfferCompensation(employeeId);
    const snapshot = this.assembleDocument(offer, compensation);

    await this.prisma.offerLetter.update({
      where: { id: offer.id },
      data: {
        status: OfferLetterStatus.PENDING_VERTICAL_APPROVAL,
        // JSON-serialize to freeze Dates as ISO strings and store a pure,
        // curated payload (never the raw employee row).
        snapshotData: JSON.parse(
          JSON.stringify(snapshot),
        ) as Prisma.InputJsonValue,
        submittedAt: new Date(),
        ...this.clearedDecisionStamps,
      },
    });
    this.pushPendingApproval(
      offer,
      OfferLetterStatus.PENDING_VERTICAL_APPROVAL,
      user.id,
    );
    return this.buildResponse(
      await this.findWithApprovalContext(undefined, employeeId),
    );
  }

  /**
   * Records an approval on the frozen snapshot. Dispatches on the letter's
   * stage: at PENDING_VERTICAL_APPROVAL the routed vertical owner gives the
   * first sign-off (→ PENDING_CEO_APPROVAL), except that an owner-less /
   * self-owned letter is finalised by the CEO directly (→ APPROVED, stamping
   * both stages); at PENDING_CEO_APPROVAL only the CEO gives the final sign-off
   * (→ APPROVED). The subject of the letter can never approve their own offer.
   */
  async approve(
    id: string,
    dto: OfferLetterDecisionDto,
    user: AuthenticatedUser,
  ) {
    const offer = await this.findWithApprovalContext(id);
    this.assertNotSubject(offer, user);
    const now = new Date();
    const comment = dto.approverComments?.trim();
    const commentData = comment ? { approverComments: comment } : {};

    if (offer.status === OfferLetterStatus.PENDING_VERTICAL_APPROVAL) {
      // Fallback: no non-conflicted vertical owner — the CEO finalises directly
      // and stamps the vertical stage too so the audit trail is complete.
      if (this.ceoMayFinaliseAtVerticalStage(offer)) {
        this.assertSuperAdmin(user);
        await this.prisma.offerLetter.update({
          where: { id },
          data: {
            status: OfferLetterStatus.APPROVED,
            verticalApprovedById: user.id,
            verticalApprovedAt: now,
            ceoApprovedById: user.id,
            ceoApprovedAt: now,
            ...commentData,
          },
        });
      } else {
        // First stage: only the routed vertical owner may sign off (never the
        // CEO — the final stage is theirs — and never the submitter).
        if (user.role === Role.SUPER_ADMIN)
          throw new ForbiddenException(
            'The vertical owner must give the first approval before the CEO',
          );
        if (user.id === offer.createdById)
          throw new ForbiddenException(
            'You cannot approve an offer letter you submitted',
          );
        if (offer.employee.vertical?.ownerId !== user.id)
          throw new ForbiddenException(
            'Only the new hire’s vertical owner may give the first approval',
          );
        await this.prisma.offerLetter.update({
          where: { id },
          data: {
            status: OfferLetterStatus.PENDING_CEO_APPROVAL,
            verticalApprovedById: user.id,
            verticalApprovedAt: now,
            ...commentData,
          },
        });
        // The letter has moved on to the CEO — tell them, not the owner who just
        // signed. Only this branch pushes: the fallback branch above and the
        // final CEO approval both end the workflow, and nothing is waiting.
        this.pushPendingApproval(
          offer,
          OfferLetterStatus.PENDING_CEO_APPROVAL,
          user.id,
        );
      }
    } else if (offer.status === OfferLetterStatus.PENDING_CEO_APPROVAL) {
      this.assertSuperAdmin(user);
      await this.prisma.offerLetter.update({
        where: { id },
        data: {
          status: OfferLetterStatus.APPROVED,
          ceoApprovedById: user.id,
          ceoApprovedAt: now,
          ...commentData,
        },
      });
    } else {
      throw new BadRequestException(
        'Only an offer letter awaiting approval can be approved',
      );
    }

    // buildResponse (not getForEmployee) — the approver is a vertical owner, who
    // is typically NOT in HR, so re-running the HR-authoring access check would
    // 403 them right after their decision persisted.
    return this.buildResponse(await this.findWithApprovalContext(id));
  }

  /**
   * Rejects the submission at whichever stage the caller is authorized for: the
   * vertical owner at the first stage (or the CEO on an owner-less / self-owned
   * fallback), the CEO at the final stage. A comment is REQUIRED (matches every
   * other rejection gate). The letter returns to a revisable state (REJECTED)
   * with the snapshot discarded, so HR edits against live data and resubmits.
   */
  async reject(
    id: string,
    dto: OfferLetterDecisionDto,
    user: AuthenticatedUser,
  ) {
    const offer = await this.findWithApprovalContext(id);
    this.assertNotSubject(offer, user);
    const comment = dto.approverComments?.trim();
    if (!comment) {
      throw new BadRequestException('A comment is required when rejecting');
    }

    if (offer.status === OfferLetterStatus.PENDING_VERTICAL_APPROVAL) {
      if (this.ceoMayFinaliseAtVerticalStage(offer)) {
        this.assertSuperAdmin(user);
      } else if (
        user.role === Role.SUPER_ADMIN ||
        user.id === offer.createdById ||
        offer.employee.vertical?.ownerId !== user.id
      ) {
        throw new ForbiddenException(
          'Only the new hire’s vertical owner may reject at this stage',
        );
      }
    } else if (offer.status === OfferLetterStatus.PENDING_CEO_APPROVAL) {
      this.assertSuperAdmin(user);
    } else {
      throw new BadRequestException(
        'Only an offer letter awaiting approval can be rejected',
      );
    }

    await this.prisma.offerLetter.update({
      where: { id },
      data: {
        status: OfferLetterStatus.REJECTED,
        rejectedById: user.id,
        rejectedAt: new Date(),
        approverComments: comment,
        snapshotData: Prisma.DbNull,
      },
    });
    return this.buildResponse(await this.findWithApprovalContext(id));
  }

  /**
   * Offer letters awaiting the caller's approval. A non-CEO vertical owner sees
   * the first-stage letters routed to them; the CEO sees every letter awaiting
   * the final sign-off, plus any stuck at the vertical stage that only they can
   * clear (owner-less, or owner is the new hire / submitter). Any caller a
   * letter isn't routed to gets an empty list — role-safe by construction, so
   * this needs no HR-authoring access check.
   */
  async listPendingApproval(user: AuthenticatedUser) {
    if (user.role !== Role.SUPER_ADMIN) {
      return this.prisma.offerLetter.findMany({
        where: this.verticalOwnerPendingWhere(user),
        orderBy: { submittedAt: 'asc' },
        include: pendingListInclude,
      });
    }
    // The CEO's queue: letters awaiting the final approval, plus vertical-stage
    // fallbacks. The owner-is-submitter case can't be expressed in a Prisma
    // where clause (no column-to-column comparison), so pending-vertical rows
    // are fetched and filtered in memory; the pending set is small.
    const rows = await this.prisma.offerLetter.findMany({
      where: {
        status: {
          in: [
            OfferLetterStatus.PENDING_CEO_APPROVAL,
            OfferLetterStatus.PENDING_VERTICAL_APPROVAL,
          ],
        },
      },
      orderBy: { submittedAt: 'asc' },
      include: pendingListInclude,
    });
    return rows.filter(
      (offer) =>
        offer.status === OfferLetterStatus.PENDING_CEO_APPROVAL ||
        this.ceoMayFinaliseAtVerticalStage(offer),
    );
  }

  /** Summary backing the pending-approval sidebar badge: count plus when the
   *  oldest letter was submitted (what the badge's age colour reads). The CEO's
   *  fallback set can't be expressed in the DB (no column-to-column
   *  comparison), so theirs reduces the already-submittedAt-ordered filtered
   *  list; owners get a direct count + oldest lookup. */
  async pendingApprovalQueue(user: AuthenticatedUser): Promise<PendingQueue> {
    if (user.role === Role.SUPER_ADMIN) {
      return pendingQueueFromRows(
        await this.listPendingApproval(user),
        (offer) => offer.submittedAt,
      );
    }
    const where = this.verticalOwnerPendingWhere(user);
    const [count, oldest] = await Promise.all([
      this.prisma.offerLetter.count({ where }),
      this.prisma.offerLetter.findFirst({
        where,
        orderBy: { submittedAt: 'asc' },
        select: { submittedAt: true },
      }),
    ]);
    return { count, oldestPendingAt: oldest?.submittedAt ?? null };
  }

  // ---- internals ----------------------------------------------------------

  /** The set of decision-audit fields, all reset to null. Applied on submit
   *  (starting a fresh approval) and on edit-invalidation (back to DRAFT). */
  private readonly clearedDecisionStamps = {
    verticalApprovedById: null,
    verticalApprovedAt: null,
    ceoApprovedById: null,
    ceoApprovedAt: null,
    rejectedById: null,
    rejectedAt: null,
    approverComments: null,
    // Scalar FK nulls (…ById) live on the Unchecked update variant; spreading
    // this into a data object selects that variant for the whole update.
  } satisfies Prisma.OfferLetterUncheckedUpdateInput;

  /** First-stage queue scope: PENDING_VERTICAL_APPROVAL letters routed to this
   *  owner, excluding ones they submitted or that are for themselves (both of
   *  which fall back to the CEO). */
  private verticalOwnerPendingWhere(
    user: AuthenticatedUser,
  ): Prisma.OfferLetterWhereInput {
    return {
      status: OfferLetterStatus.PENDING_VERTICAL_APPROVAL,
      createdById: { not: user.id },
      employeeId: { not: user.id },
      employee: { vertical: { ownerId: user.id } },
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
   * A letter can be stuck at the vertical stage with no one able to give the
   * first approval: the vertical has no owner, or its owner is the new hire
   * (subject) or the submitter (creator) — self-approval is forbidden. In those
   * cases the CEO finalises it directly, and that single final approval also
   * stamps the vertical stage. Structural so it accepts both the full approval
   * context and the lighter pending-list row (each carries `vertical.ownerId`).
   */
  /**
   * Tell whoever the letter now waits on that it is theirs to decide.
   *
   * Routing mirrors `approve()` exactly — deliberately, by reusing the same
   * `ceoMayFinaliseAtVerticalStage` predicate rather than restating it. A push
   * that reaches someone the gate will then refuse ("the vertical owner must
   * approve first") is worse than no push at all.
   *
   * `status` is passed rather than read off `offer`, because the caller has just
   * written the new one and is holding the pre-update row.
   */
  private pushPendingApproval(
    offer: OfferWithApprovalContext,
    status: OfferLetterStatus,
    actorId: string,
  ): void {
    const toCeo =
      status === OfferLetterStatus.PENDING_CEO_APPROVAL ||
      this.ceoMayFinaliseAtVerticalStage({ ...offer, status });
    const candidate =
      `${offer.employee.firstName} ${offer.employee.lastName}`.trim();
    const position =
      offer.candidateRequisition?.positionTitle ?? offer.employee.designation;
    void this.pushEvents.approvalRequired({
      kind: 'offer-letter',
      audience: toCeo
        ? { pool: 'SUPER_ADMIN' }
        : { employeeIds: [offer.employee.vertical?.ownerId] },
      reference: position ? `${candidate} — ${position}` : candidate,
      requestedById: offer.createdById,
      recordId: offer.id,
      // The review-and-decide page itself, which renders the frozen snapshot and
      // the approve/reject controls — the recipient of this push is exactly its
      // audience, so the tap lands on the decision rather than on a queue.
      url: `/hr/offer-letters/pending-approval/${offer.id}`,
      actorId,
    });
  }

  private ceoMayFinaliseAtVerticalStage(offer: {
    status: OfferLetterStatus;
    employeeId: string;
    createdById: string;
    employee: { vertical: { ownerId: string | null } | null };
  }): boolean {
    const ownerId = offer.employee.vertical?.ownerId ?? null;
    return (
      offer.status === OfferLetterStatus.PENDING_VERTICAL_APPROVAL &&
      (!ownerId ||
        ownerId === offer.employeeId ||
        ownerId === offer.createdById)
    );
  }

  /**
   * The one inviolable rule: the SUBJECT of the letter (the new hire) may never
   * act on their own offer — checked before any role shortcut, so even a CEO who
   * is themselves the new hire is blocked.
   */
  private assertNotSubject(
    offer: { employeeId: string },
    user: AuthenticatedUser,
  ): void {
    if (user.id === offer.employeeId) {
      throw new ForbiddenException('You cannot act on your own offer letter');
    }
  }

  private assertSuperAdmin(user: AuthenticatedUser): void {
    if (user.role !== Role.SUPER_ADMIN) {
      throw new ForbiddenException('Only the CEO may give the final approval');
    }
  }

  /**
   * Throws unless `user` may VIEW `offer` on the review page. The subject is
   * always blocked; the CEO may view anything; a non-CEO may view only a letter
   * whose vertical they own and that they did not submit (which routes to them
   * at some stage). Deciding is separately gated per stage in approve/reject.
   */
  private assertCanReview(
    offer: {
      employeeId: string;
      createdById: string;
      employee: { vertical: { ownerId: string | null } | null };
    },
    user: AuthenticatedUser,
  ): void {
    if (user.id === offer.employeeId) {
      throw new ForbiddenException('You cannot review your own offer letter');
    }
    if (user.role === Role.SUPER_ADMIN) return;
    if (
      offer.employee.vertical?.ownerId === user.id &&
      user.id !== offer.createdById
    ) {
      return;
    }
    throw new ForbiddenException(
      'Only the new hire’s vertical owner or the CEO may review this offer letter',
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
