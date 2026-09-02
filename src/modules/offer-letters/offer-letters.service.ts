import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CandidateApplicationStatus,
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
import { PayrollComputationService } from '../payroll/payroll-computation.service';
import { OnboardingCompensationService } from '../payroll/onboarding-compensation.service';
import { CtcBreakdownEntity } from '../payroll/entities/ctc-breakdown.entity';
import { PushEventsService } from '../notifications/push-events.service';
import { OfferLetterDecisionDto } from './dto/offer-letter-decision.dto';
import { DeclineOfferLetterDto } from './dto/offer-letter-response.dto';
import { SaveOfferLetterDto } from './dto/save-offer-letter.dto';

/**
 * Employee include used to assemble the printable document for a LEGACY
 * employee-anchored letter — carries the position/reporting fields plus the
 * vertical (with its owner, who is the approval router) and the reporting
 * manager.
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

/** The offer-with-approval-context include reused by every fetch that renders.
 *  Carries BOTH subjects — the Employee (legacy letters) and the candidate
 *  application + requisition vertical (the normal path) — because either one can
 *  be the letter's subject and its vertical is what routes the approval. */
const approvalContextInclude = {
  employee: { include: documentEmployeeInclude },
  candidateApplication: {
    select: { id: true, name: true, contact: true, status: true },
  },
  reportsTo: {
    select: { firstName: true, lastName: true, designation: true },
  },
  verticalApprovedBy: { select: { firstName: true, lastName: true } },
  ceoApprovedBy: { select: { firstName: true, lastName: true } },
  rejectedBy: { select: { firstName: true, lastName: true } },
  candidateRequisition: {
    select: {
      id: true,
      requisitionNumber: true,
      positionTitle: true,
      hiringStage: true,
      vertical: {
        select: {
          name: true,
          ownerId: true,
          owner: { select: { id: true, firstName: true, lastName: true } },
        },
      },
    },
  },
} satisfies Prisma.OfferLetterInclude;

/** Columns surfaced in the pending-approval queue rows. Includes both possible
 *  vertical owners so the CEO's queue can filter the owner-less / self-owned
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
  candidateApplication: { select: { id: true, name: true } },
  candidateRequisition: {
    select: {
      requisitionNumber: true,
      positionTitle: true,
      vertical: { select: { ownerId: true } },
    },
  },
} satisfies Prisma.OfferLetterInclude;

type OfferWithApprovalContext = Prisma.OfferLetterGetPayload<{
  include: typeof approvalContextInclude;
}>;

/**
 * Who the letter is about, resolved from whichever subject the letter carries.
 * A candidate has no Employee row, so their name comes from the application and
 * their terms from the letter's own `offered*` columns; a legacy letter reads
 * them off the Employee. Everything downstream (the rendered document, the
 * approval routing, the pushes) consumes only this.
 */
type OfferSubject = {
  firstName: string;
  lastName: string;
  gender: string | null;
  designation: string | null;
  employmentType: string | null;
  dateOfJoining: Date | null;
  workLocation: string | null;
  territory: string | null;
  verticalName: string | null;
  verticalOwnerId: string | null;
  verticalOwner: { firstName: string; lastName: string } | null;
  reportingManager: {
    firstName: string;
    lastName: string;
    designation: string | null;
  } | null;
};

/**
 * The curated, printable document payload. Assembled live from the offer +
 * computed CTC for DRAFT/REJECTED, and frozen verbatim into `snapshotData` at
 * submission (Dates serialized to ISO strings — the type is intentionally
 * date-as-`unknown`-tolerant since the stored JSON re-hydrates as strings).
 *
 * The subject block is still called `employee`: it is the shape every stored
 * snapshot already uses and the shape the print document and the onboarding
 * prefill read, so renaming it would orphan every letter written to date.
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

/** Stages a requisition may be in before an offer goes out; reaching any of
 *  them means the send is the event that moves it to OFFER_EXTENDED. */
const PRE_OFFER_STAGES: Array<CandidateHiringStage | null> = [
  null,
  CandidateHiringStage.JOB_POSTED,
  CandidateHiringStage.INTERVIEWING,
];

@Injectable()
export class OfferLettersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly payroll: PayrollComputationService,
    private readonly onboardingCompensation: OnboardingCompensationService,
    // PushEventsModule is @Global, so this needs no import edge here.
    private readonly pushEvents: PushEventsService,
  ) {}

  /**
   * The offer register: every letter with enough context to identify its
   * subject, its approval state and — separately — the candidate's answer.
   */
  async list(user: AuthenticatedUser) {
    await this.assertAccess(user);
    const rows = await this.prisma.offerLetter.findMany({
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
        candidateApplication: { select: { id: true, name: true } },
        candidateRequisition: {
          select: {
            id: true,
            requisitionNumber: true,
            positionTitle: true,
            vertical: { select: { ownerId: true } },
          },
        },
      },
    });
    return rows.map((offer) => ({
      id: offer.id,
      referenceNumber: offer.referenceNumber,
      status: offer.status,
      sentAt: offer.sentAt,
      acceptedAt: offer.acceptedAt,
      declinedAt: offer.declinedAt,
      declineReason: offer.declineReason,
      submittedAt: offer.submittedAt,
      updatedAt: offer.updatedAt,
      // The subject, however the letter is anchored.
      candidateName:
        offer.candidateApplication?.name ??
        (offer.employee
          ? `${offer.employee.firstName} ${offer.employee.lastName}`.trim()
          : null),
      positionTitle:
        offer.offeredDesignation ??
        offer.candidateRequisition?.positionTitle ??
        offer.employee?.designation ??
        null,
      employee: offer.employee,
      candidateApplicationId: offer.candidateApplicationId,
      candidateRequisition: offer.candidateRequisition,
    }));
  }

  /**
   * Applicants who are SELECTED and waiting for an offer: the requisition is
   * approved, nobody has been onboarded against it, and it carries no live
   * (undeclined) offer. This is the "new offer" picker — the offer letter now
   * starts from a candidate, not from an employee who has somehow already been
   * hired.
   */
  async listCandidatesAwaitingOffer(user: AuthenticatedUser) {
    await this.assertAccess(user);
    const applications = await this.prisma.candidateApplication.findMany({
      where: {
        status: CandidateApplicationStatus.SELECTED,
        offerLetter: null,
        requisition: {
          status: CandidateRequisitionStatus.APPROVED,
          onboardedEmployeeId: null,
          consumedAt: null,
        },
      },
      select: {
        id: true,
        name: true,
        contact: true,
        expectedCtc: true,
        requisition: {
          select: {
            id: true,
            requisitionNumber: true,
            positionTitle: true,
            employmentType: true,
            keyResponsibilities: true,
            keyPerformanceIndicators: true,
            budgetAnnualCtc: true,
            targetJoiningDate: true,
            vertical: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { updatedAt: 'asc' },
    });
    return applications;
  }

  /**
   * Create or update authored offer content.
   *
   * A NEW letter is always addressed to a SELECTED candidate application —
   * months before an Employee row exists. Employee-anchored letters can still be
   * edited (everything written before candidate-anchoring is one) but are never
   * created: an offer precedes the hire.
   */
  async save(dto: SaveOfferLetterDto, user: AuthenticatedUser) {
    await this.assertAccess(user);
    const existing = await this.findExistingForSave(dto);
    if (existing) return this.updateExisting(existing, dto);

    if (!dto.candidateApplicationId) {
      throw new BadRequestException(
        'A selected candidate application is required to create a new offer letter',
      );
    }
    return this.createForCandidate(dto, user);
  }

  /** Resolve which letter (if any) this save targets, by whichever anchor the
   *  caller sent. */
  private async findExistingForSave(dto: SaveOfferLetterDto) {
    if (dto.offerLetterId) {
      const found = await this.prisma.offerLetter.findUnique({
        where: { id: dto.offerLetterId },
      });
      if (!found) throw new NotFoundException('Offer letter not found');
      return found;
    }
    if (dto.employeeId) {
      const found = await this.prisma.offerLetter.findUnique({
        where: { employeeId: dto.employeeId },
      });
      if (!found) {
        // Deliberately not "create one": an employee-anchored offer would mean
        // the hire happened before the offer, which is the inversion this whole
        // flow exists to remove.
        throw new NotFoundException(
          'No offer letter exists for this employee. New offers are made to a selected candidate, before onboarding.',
        );
      }
      return found;
    }
    if (dto.candidateApplicationId) {
      return this.prisma.offerLetter.findUnique({
        where: { candidateApplicationId: dto.candidateApplicationId },
      });
    }
    throw new BadRequestException(
      'Specify the offer letter, the candidate application, or the employee to save',
    );
  }

  private async updateExisting(
    existing: Prisma.OfferLetterGetPayload<object>,
    dto: SaveOfferLetterDto,
  ) {
    // An accepted offer is a commitment already given. Quietly rewriting its
    // terms would change what the candidate agreed to, so it is not editable at
    // all — a change of terms after acceptance is a fresh offer.
    if (existing.acceptedAt) {
      throw new BadRequestException(
        'This offer has been accepted by the candidate and can no longer be edited',
      );
    }
    // Any edit after submission (whether still pending or already approved)
    // invalidates the current approval: the letter drops back to DRAFT and the
    // frozen snapshot is discarded, so a fresh submission is required and an
    // approval never silently carries over data that has since changed.
    const invalidates =
      existing.status === OfferLetterStatus.PENDING_VERTICAL_APPROVAL ||
      existing.status === OfferLetterStatus.PENDING_CEO_APPROVAL ||
      existing.status === OfferLetterStatus.APPROVED ||
      existing.status === OfferLetterStatus.REJECTED;
    // Editing an offer that is already out with the candidate un-sends it: the
    // PDF they hold no longer matches the record, so the letter must be
    // re-approved and re-sent before any answer can be recorded against it.
    const unsends = !!existing.sentAt;

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.offerLetter.update({
        where: { id: existing.id },
        data: {
          keyResponsibilities: dto.keyResponsibilities,
          kpis: dto.kpis,
          // Offer terms live on the letter only for a candidate-anchored one; a
          // legacy letter reads them off its Employee row, which stays the
          // source of truth for it.
          ...(existing.employeeId ? {} : this.offerTermsData(dto)),
          ...(invalidates
            ? {
                status: OfferLetterStatus.DRAFT,
                snapshotData: Prisma.DbNull,
                submittedAt: null,
                ...this.clearedDecisionStamps,
              }
            : {}),
          ...(unsends
            ? { sentAt: null, declinedAt: null, declineReason: null }
            : {}),
        },
      });
      if (unsends && existing.candidateRequisitionId) {
        // Roll the hiring stage back off OFFER_EXTENDED — no offer is out.
        await tx.candidateRequisition.updateMany({
          where: {
            id: existing.candidateRequisitionId,
            hiringStage: CandidateHiringStage.OFFER_EXTENDED,
          },
          data: { hiringStage: CandidateHiringStage.INTERVIEWING },
        });
      }
      return updated;
    });
  }

  /** The `offered*` columns as an update payload. `reportsToId` is tri-state:
   *  absent leaves it alone, explicit null clears it. */
  private offerTermsData(dto: SaveOfferLetterDto) {
    return {
      ...(dto.offeredDesignation !== undefined
        ? { offeredDesignation: dto.offeredDesignation.trim() || null }
        : {}),
      ...(dto.offeredEmploymentType !== undefined
        ? { offeredEmploymentType: dto.offeredEmploymentType }
        : {}),
      ...(dto.offeredDateOfJoining !== undefined
        ? { offeredDateOfJoining: new Date(dto.offeredDateOfJoining) }
        : {}),
      ...(dto.offeredWorkLocation !== undefined
        ? { offeredWorkLocation: dto.offeredWorkLocation.trim() || null }
        : {}),
      ...(dto.offeredTerritory !== undefined
        ? { offeredTerritory: dto.offeredTerritory.trim() || null }
        : {}),
      ...(dto.offeredMonthlyCtc !== undefined
        ? { offeredMonthlyCtc: new Prisma.Decimal(dto.offeredMonthlyCtc) }
        : {}),
      ...(dto.reportsToId !== undefined
        ? { reportsToId: dto.reportsToId || null }
        : {}),
    } satisfies Prisma.OfferLetterUncheckedUpdateInput;
  }

  private async createForCandidate(
    dto: SaveOfferLetterDto,
    user: AuthenticatedUser,
  ) {
    const application = await this.prisma.candidateApplication.findUnique({
      where: { id: dto.candidateApplicationId },
      select: {
        id: true,
        name: true,
        status: true,
        requisition: {
          select: {
            id: true,
            status: true,
            consumedAt: true,
            onboardedEmployeeId: true,
          },
        },
      },
    });
    if (!application)
      throw new NotFoundException('Candidate application not found');
    if (application.status !== CandidateApplicationStatus.SELECTED) {
      throw new BadRequestException(
        'An offer letter can only be made to a candidate marked Selected after their interview',
      );
    }
    const requisition = application.requisition;
    if (requisition.status !== CandidateRequisitionStatus.APPROVED) {
      throw new BadRequestException(
        'The candidate requisition is not approved and available',
      );
    }
    if (requisition.onboardedEmployeeId) {
      throw new BadRequestException(
        'This requisition has already been fulfilled by an onboarded employee',
      );
    }
    // consumedAt is the "one live offer per requisition" guard: it is set here
    // and cleared again only when an offer is declined.
    if (requisition.consumedAt) {
      throw new BadRequestException(
        'This requisition already has a live offer letter out',
      );
    }
    // Required to render the letter at all: the document quotes the position,
    // the joining date, the place of posting and the CTC, and none of those can
    // be guessed from a candidate application.
    const missing = [
      !dto.offeredDesignation?.trim() && 'position',
      !dto.offeredEmploymentType && 'employment type',
      !dto.offeredDateOfJoining && 'date of joining',
      !dto.offeredWorkLocation?.trim() && 'place of posting',
      !dto.offeredMonthlyCtc && 'monthly CTC',
    ].filter(Boolean);
    if (missing.length) {
      throw new BadRequestException(
        `The offer terms are incomplete — ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} required`,
      );
    }

    const referenceNumber = await this.generateReferenceNumber(
      dto.offeredDesignation ?? null,
      dto.offeredTerritory ?? null,
    );
    return this.prisma.$transaction(async (tx) => {
      const offer = await tx.offerLetter.create({
        data: {
          candidateApplicationId: application.id,
          candidateRequisitionId: requisition.id,
          referenceNumber,
          keyResponsibilities: dto.keyResponsibilities,
          kpis: dto.kpis,
          offeredDesignation: dto.offeredDesignation!.trim(),
          offeredEmploymentType: dto.offeredEmploymentType!,
          offeredDateOfJoining: new Date(dto.offeredDateOfJoining!),
          offeredWorkLocation: dto.offeredWorkLocation!.trim(),
          offeredTerritory: dto.offeredTerritory?.trim() || null,
          offeredMonthlyCtc: new Prisma.Decimal(dto.offeredMonthlyCtc!),
          reportsToId: dto.reportsToId || null,
          createdById: user.id,
        },
      });
      // Claim the requisition with a compare-and-set so two HR users cannot both
      // author a live offer against it. The hiring stage stays where it is —
      // OFFER_EXTENDED means the letter reached the candidate, which is `send`,
      // not "a draft exists".
      const claimed = await tx.candidateRequisition.updateMany({
        where: { id: requisition.id, consumedAt: null },
        data: {
          consumedAt: new Date(),
          selectedCandidateName: application.name,
        },
      });
      if (claimed.count !== 1) {
        throw new BadRequestException(
          'This requisition already has a live offer letter out',
        );
      }
      return offer;
    });
  }

  /**
   * The printable document for one letter, by id. DRAFT/REJECTED return LIVE
   * data (HR is authoring/previewing); PENDING_APPROVAL and APPROVED return the
   * FROZEN snapshot taken at submission — exactly what the vertical owner
   * reviewed and what downloads after approval, never a re-fetched version that
   * could have changed since the decision.
   */
  async getById(id: string, user: AuthenticatedUser) {
    await this.assertAccess(user);
    return this.buildResponse(await this.findWithApprovalContext(id));
  }

  /** The same document resolved by employee — the lookup a legacy
   *  employee-anchored letter is addressed by, and by which an onboarded hire's
   *  letter stays reachable once `employeeId` is back-filled. */
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
   * what the owner reviewed and what downloads after approval; DRAFT/REJECTED
   * serve LIVE data (HR is authoring). Always carries the live status metadata
   * and the candidate-response axis so the UI can gate the download, the send
   * and the accept/decline, and explain why. Deliberately does NOT re-check HR
   * access — the caller (getById/getForEmployee, or an approver acting via
   * approve/reject) has already been authorized for its own path.
   */
  private async buildResponse(offer: OfferWithApprovalContext) {
    const subject = this.resolveSubject(offer);
    const useSnapshot =
      (offer.status === OfferLetterStatus.PENDING_VERTICAL_APPROVAL ||
        offer.status === OfferLetterStatus.PENDING_CEO_APPROVAL ||
        offer.status === OfferLetterStatus.APPROVED) &&
      offer.snapshotData != null;

    const document: RenderedOfferDocument = useSnapshot
      ? (offer.snapshotData as unknown as RenderedOfferDocument)
      : this.assembleDocument(
          offer,
          subject,
          await this.computeOfferCompensation(offer, subject),
        );

    return {
      ...document,
      id: offer.id,
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
      verticalOwner: subject.verticalOwner,
      // The candidate's own answer — orthogonal to `status`, which is only our
      // internal approval. Onboarding needs BOTH.
      sentAt: offer.sentAt,
      acceptedAt: offer.acceptedAt,
      declinedAt: offer.declinedAt,
      declineReason: offer.declineReason,
      // Editable offer terms, so the authoring form can round-trip them.
      offeredDesignation: offer.offeredDesignation,
      offeredEmploymentType: offer.offeredEmploymentType,
      offeredDateOfJoining: offer.offeredDateOfJoining,
      offeredWorkLocation: offer.offeredWorkLocation,
      offeredTerritory: offer.offeredTerritory,
      offeredMonthlyCtc: offer.offeredMonthlyCtc?.toString() ?? null,
      reportsToId: offer.reportsToId,
      employeeId: offer.employeeId,
      candidateApplication: offer.candidateApplication,
      candidateRequisition: offer.candidateRequisition
        ? {
            id: offer.candidateRequisition.id,
            requisitionNumber: offer.candidateRequisition.requisitionNumber,
            positionTitle: offer.candidateRequisition.positionTitle,
          }
        : null,
    };
  }

  /**
   * Who the letter is about. A legacy letter reads its subject off the Employee
   * row; a candidate-anchored one has no Employee row at all, so the name comes
   * from the application and the terms from the letter's own `offered*` columns.
   */
  private resolveSubject(offer: OfferWithApprovalContext): OfferSubject {
    const employee = offer.employee;
    if (employee) {
      return {
        firstName: employee.firstName,
        lastName: employee.lastName,
        gender: employee.gender ?? null,
        designation: employee.designation ?? null,
        employmentType: employee.employmentType ?? null,
        dateOfJoining: employee.dateOfJoining ?? null,
        workLocation: employee.workLocation ?? null,
        territory: employee.territory ?? null,
        verticalName: employee.vertical?.name ?? null,
        verticalOwnerId: employee.vertical?.ownerId ?? null,
        verticalOwner: employee.vertical?.owner
          ? {
              firstName: employee.vertical.owner.firstName,
              lastName: employee.vertical.owner.lastName,
            }
          : null,
        reportingManager: employee.reportingManager
          ? {
              firstName: employee.reportingManager.firstName,
              lastName: employee.reportingManager.lastName,
              designation: employee.reportingManager.designation ?? null,
            }
          : null,
      };
    }
    const application = offer.candidateApplication;
    if (!application) {
      throw new BadRequestException(
        'This offer letter has neither an employee nor a candidate on it',
      );
    }
    const vertical = offer.candidateRequisition?.vertical ?? null;
    const { firstName, lastName } = this.splitCandidateName(application.name);
    return {
      firstName,
      lastName,
      // A candidate application collects no gender, and asking for one to pick a
      // salutation would be the wrong trade — the document already falls back to
      // the neutral "Mr./Ms.".
      gender: null,
      designation: offer.offeredDesignation,
      employmentType: offer.offeredEmploymentType,
      dateOfJoining: offer.offeredDateOfJoining,
      workLocation: offer.offeredWorkLocation,
      territory: offer.offeredTerritory,
      verticalName: vertical?.name ?? null,
      verticalOwnerId: vertical?.ownerId ?? null,
      verticalOwner: vertical?.owner
        ? {
            firstName: vertical.owner.firstName,
            lastName: vertical.owner.lastName,
          }
        : null,
      reportingManager: offer.reportsTo
        ? {
            firstName: offer.reportsTo.firstName,
            lastName: offer.reportsTo.lastName,
            designation: offer.reportsTo.designation ?? null,
          }
        : null,
    };
  }

  /**
   * A candidate application collects one free-text `name`, but the letter greets
   * them by first name ("Dear Priya,"). First token is the given name, the rest
   * the surname; a single-token name leaves the surname empty rather than
   * inventing one.
   */
  private splitCandidateName(name: string): {
    firstName: string;
    lastName: string;
  } {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    return {
      firstName: parts[0] ?? name.trim(),
      lastName: parts.slice(1).join(' '),
    };
  }

  /**
   * Compensation for an offer letter is forward-looking: the letter is authored
   * before the hire starts, so it is evaluated as of the joining date rather
   * than "today".
   *
   * A CANDIDATE has no salary structure — there is no Employee row to hang one
   * on — so the breakdown is derived from the offered monthly CTC through
   * `OnboardingCompensationService`, the very calculator that will later build
   * the real salary structure at onboarding. The offer and the first payslip
   * therefore cannot disagree.
   *
   * A LEGACY employee-anchored letter keeps reading the salary structure: we
   * evaluate as of the joining date so a structure effective from the start date
   * applies and never blocks the offer's release; if the earliest structure on
   * file starts even later, that date is used instead so any structure on record
   * is still picked up. Only a genuine absence of any salary structure remains an
   * error (nothing to render).
   */
  private async computeOfferCompensation(
    offer: OfferWithApprovalContext,
    subject: OfferSubject,
  ): Promise<CtcBreakdownEntity> {
    if (!offer.employeeId) {
      if (offer.offeredMonthlyCtc == null) {
        throw new BadRequestException(
          'An offered monthly CTC is required before this offer letter can be rendered',
        );
      }
      const effectiveFrom = subject.dateOfJoining ?? new Date();
      const components = await this.onboardingCompensation.calculate(
        offer.offeredMonthlyCtc.toString(),
        effectiveFrom,
      );
      // Mapped exactly as employees.onboard persists them, so the Annexure A the
      // candidate signs is the structure they will be paid on. (The existing
      // schema's Special Allowance slot holds the fixed Conveyance component for
      // CTC-derived structures.)
      return this.payroll.composeCtcBreakdown({
        employeeId: null,
        effectiveFrom,
        workLocation: subject.workLocation,
        basic: new Prisma.Decimal(components.basicMonthly),
        hra: new Prisma.Decimal(components.hraMonthly),
        specialAllowance: new Prisma.Decimal(components.conveyanceMonthly),
        otherAllowances: new Prisma.Decimal(components.otherAllowanceMonthly),
        variablePayAnnual: new Prisma.Decimal(components.incentiveAnnual),
        asOf: effectiveFrom,
      });
    }
    const employeeId = offer.employeeId;
    const earliest = await this.prisma.salaryStructure.findFirst({
      where: { employeeId },
      orderBy: { effectiveFrom: 'asc' },
      select: { effectiveFrom: true },
    });
    const candidates = [subject.dateOfJoining, earliest?.effectiveFrom].filter(
      (date): date is Date => date != null,
    );
    const asOf = candidates.length
      ? new Date(Math.max(...candidates.map((date) => date.getTime())))
      : new Date();
    return this.payroll.computeCtcBreakdown(employeeId, asOf);
  }

  /**
   * DRAFT/REJECTED -> PENDING_VERTICAL_APPROVAL. Freezes the current rendered
   * document (position/reporting + computed CTC/Annexure A) onto the record and
   * routes it to the first-stage vertical-owner approval. Routing is derived
   * live from the subject's vertical owner at decision time (not stamped here),
   * so reassigning the owner before a decision re-routes the letter correctly;
   * an owner-less / self-owned letter is finalised directly by the CEO from the
   * vertical stage (see `ceoMayFinaliseAtVerticalStage`).
   */
  async submit(id: string, user: AuthenticatedUser) {
    await this.assertAccess(user);
    const offer = await this.findWithApprovalContext(id);

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

    const subject = this.resolveSubject(offer);
    const compensation = await this.computeOfferCompensation(offer, subject);
    const snapshot = this.assembleDocument(offer, subject, compensation);

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
    return this.buildResponse(await this.findWithApprovalContext(offer.id));
  }

  /**
   * Records that the approved letter has gone out to the candidate, and moves
   * the requisition to OFFER_EXTENDED — the stage that was previously
   * unreachable, because nothing in the flow ever represented "an offer is with
   * the candidate".
   *
   * Re-sending an already-sent offer is allowed (HR resends the PDF, or sends a
   * reminder) and re-stamps the send.
   */
  async send(id: string, user: AuthenticatedUser) {
    await this.assertAccess(user);
    const offer = await this.findWithApprovalContext(id);
    if (offer.status !== OfferLetterStatus.APPROVED) {
      throw new BadRequestException(
        'Only a fully approved offer letter can be sent to the candidate',
      );
    }
    if (offer.acceptedAt) {
      throw new BadRequestException(
        'This offer has already been accepted by the candidate',
      );
    }
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.offerLetter.update({
        where: { id: offer.id },
        // A re-send after a decline is a fresh attempt, so the decline is
        // cleared with it rather than left contradicting the new send.
        data: { sentAt: now, declinedAt: null, declineReason: null },
      });
      if (offer.candidateRequisitionId) {
        await tx.candidateRequisition.updateMany({
          where: {
            id: offer.candidateRequisitionId,
            hiringStage: { in: PRE_OFFER_STAGES.filter((s) => s !== null) },
          },
          data: { hiringStage: CandidateHiringStage.OFFER_EXTENDED },
        });
        // A requisition with no stage set yet cannot be matched by an `in`
        // filter (SQL NULL), so it is advanced separately.
        await tx.candidateRequisition.updateMany({
          where: { id: offer.candidateRequisitionId, hiringStage: null },
          data: { hiringStage: CandidateHiringStage.OFFER_EXTENDED },
        });
      }
    });
    return this.buildResponse(await this.findWithApprovalContext(id));
  }

  /**
   * The candidate said yes. This — not "an employee row exists" — is what
   * authorizes onboarding (see EmployeesService.onboard). The requisition stays
   * at OFFER_EXTENDED until the hire is actually onboarded, which is what sets
   * CANDIDATE_SELECTED; but the public application links close now, because the
   * position is committed.
   */
  async accept(id: string, user: AuthenticatedUser) {
    await this.assertAccess(user);
    const offer = await this.findWithApprovalContext(id);
    if (offer.acceptedAt) {
      return this.buildResponse(offer);
    }
    if (offer.status !== OfferLetterStatus.APPROVED) {
      throw new BadRequestException(
        'The offer letter must be approved before an acceptance can be recorded',
      );
    }
    if (!offer.sentAt) {
      throw new BadRequestException(
        'Record the offer as sent to the candidate before recording their acceptance',
      );
    }
    if (offer.declinedAt) {
      throw new BadRequestException(
        'This offer was declined — send a fresh offer instead of accepting this one',
      );
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.offerLetter.update({
        where: { id: offer.id },
        data: { acceptedAt: new Date() },
      });
      if (offer.candidateRequisitionId) {
        await tx.candidateApplicationInvite.updateMany({
          where: {
            requisitionId: offer.candidateRequisitionId,
            revokedAt: null,
          },
          data: { revokedAt: new Date() },
        });
      }
    });
    return this.buildResponse(await this.findWithApprovalContext(id));
  }

  /**
   * The candidate said no. The requisition is released — `consumedAt` cleared,
   * the selected name dropped, the stage rolled back off OFFER_EXTENDED — so HR
   * can select another applicant and make them an offer without re-raising and
   * re-approving the whole requisition. The declined application is marked
   * OFFER_DECLINED, which is deliberately not REJECTED: that would record our
   * decision about them, and this was theirs.
   */
  async decline(
    id: string,
    dto: DeclineOfferLetterDto,
    user: AuthenticatedUser,
  ) {
    await this.assertAccess(user);
    const offer = await this.findWithApprovalContext(id);
    const reason = dto.declineReason?.trim();
    if (!reason) {
      throw new BadRequestException(
        'A reason is required when recording a declined offer',
      );
    }
    if (!offer.sentAt) {
      throw new BadRequestException(
        'An offer that was never sent to the candidate cannot be declined',
      );
    }
    if (offer.acceptedAt) {
      throw new BadRequestException(
        'This offer has already been accepted by the candidate',
      );
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.offerLetter.update({
        where: { id: offer.id },
        data: { declinedAt: new Date(), declineReason: reason },
      });
      if (offer.candidateApplicationId) {
        await tx.candidateApplication.update({
          where: { id: offer.candidateApplicationId },
          data: { status: CandidateApplicationStatus.OFFER_DECLINED },
        });
      }
      if (offer.candidateRequisitionId) {
        await tx.candidateRequisition.update({
          where: { id: offer.candidateRequisitionId },
          data: {
            consumedAt: null,
            selectedCandidateName: null,
            // Back to interviewing: no offer is out, and the shortlist is where
            // HR resumes. (A system transition, unlike the HR-driven
            // updateHiringLifecycle, which forbids moving backwards.)
            hiringStage: CandidateHiringStage.INTERVIEWING,
          },
        });
      }
    });
    return this.buildResponse(await this.findWithApprovalContext(id));
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
        if (this.verticalOwnerId(offer) !== user.id)
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

    // buildResponse (not getById) — the approver is a vertical owner, who is
    // typically NOT in HR, so re-running the HR-authoring access check would
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
        this.verticalOwnerId(offer) !== user.id
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
   *  which fall back to the CEO). The subject's vertical is the Employee's for a
   *  legacy letter and the requisition's for a candidate-anchored one, so the
   *  scope is a union of the two — the exclusions are expressed INSIDE the
   *  employee filter rather than as `employeeId: { not }`, which on a nullable
   *  column would silently drop every candidate letter. */
  private verticalOwnerPendingWhere(
    user: AuthenticatedUser,
  ): Prisma.OfferLetterWhereInput {
    return {
      status: OfferLetterStatus.PENDING_VERTICAL_APPROVAL,
      createdById: { not: user.id },
      OR: [
        {
          employee: {
            is: { id: { not: user.id }, vertical: { ownerId: user.id } },
          },
        },
        {
          employee: null,
          candidateRequisition: { vertical: { ownerId: user.id } },
        },
      ],
    };
  }

  /**
   * Fetch one offer with the full document + approval includes, by primary id
   * (the normal path) or by employeeId (a legacy employee-anchored letter).
   * Throws 404 if absent. The return type is the single source of truth for
   * buildResponse.
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
    const subject = this.resolveSubject(offer);
    const candidate = `${subject.firstName} ${subject.lastName}`.trim();
    const position =
      subject.designation ?? offer.candidateRequisition?.positionTitle ?? null;
    void this.pushEvents.approvalRequired({
      kind: 'offer-letter',
      audience: toCeo
        ? { pool: 'SUPER_ADMIN' }
        : { employeeIds: [this.verticalOwnerId(offer)] },
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

  /** The vertical owner the letter routes to: the subject employee's vertical
   *  for a legacy letter, the requisition's vertical for a candidate one.
   *  Structural, so it accepts the lighter pending-list row too. */
  private verticalOwnerId(offer: {
    employee?: { vertical: { ownerId: string | null } | null } | null;
    candidateRequisition?: {
      vertical?: { ownerId: string | null } | null;
    } | null;
  }): string | null {
    return (
      offer.employee?.vertical?.ownerId ??
      offer.candidateRequisition?.vertical?.ownerId ??
      null
    );
  }

  /**
   * A letter can be stuck at the vertical stage with no one able to give the
   * first approval: the vertical has no owner, or its owner is the new hire
   * (subject) or the submitter (creator) — self-approval is forbidden. In those
   * cases the CEO finalises it directly, and that single final approval also
   * stamps the vertical stage. Structural so it accepts both the full approval
   * context and the lighter pending-list row.
   */
  private ceoMayFinaliseAtVerticalStage(offer: {
    status: OfferLetterStatus;
    employeeId: string | null;
    createdById: string;
    employee?: { vertical: { ownerId: string | null } | null } | null;
    candidateRequisition?: {
      vertical?: { ownerId: string | null } | null;
    } | null;
  }): boolean {
    const ownerId = this.verticalOwnerId(offer);
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
   * is themselves the new hire is blocked. A candidate-anchored letter has no
   * employee id yet, so there is nobody it could be.
   */
  private assertNotSubject(
    offer: { employeeId: string | null },
    user: AuthenticatedUser,
  ): void {
    if (offer.employeeId && user.id === offer.employeeId) {
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
      employeeId: string | null;
      createdById: string;
      employee?: { vertical: { ownerId: string | null } | null } | null;
      candidateRequisition?: {
        vertical?: { ownerId: string | null } | null;
      } | null;
    },
    user: AuthenticatedUser,
  ): void {
    this.assertNotSubject(offer, user);
    if (user.role === Role.SUPER_ADMIN) return;
    if (
      this.verticalOwnerId(offer) === user.id &&
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
    subject: OfferSubject,
    compensation: CtcBreakdownEntity,
  ): RenderedOfferDocument {
    return {
      referenceNumber: offer.referenceNumber,
      keyResponsibilities: offer.keyResponsibilities,
      kpis: offer.kpis,
      createdAt: offer.createdAt,
      employee: {
        firstName: subject.firstName,
        lastName: subject.lastName,
        gender: subject.gender,
        designation: subject.designation,
        employmentType: subject.employmentType,
        dateOfJoining: subject.dateOfJoining,
        workLocation: subject.workLocation,
        territory: subject.territory,
        vertical: subject.verticalName ? { name: subject.verticalName } : null,
        reportingManager: subject.reportingManager,
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
