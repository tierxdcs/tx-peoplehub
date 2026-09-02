import { randomBytes } from 'crypto';
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
import { ConfigService } from '@nestjs/config';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import {
  assertInviteUsable,
  computeExpiry,
  generateInviteToken,
  hashInvitePassword,
  inviteLinkUrl,
} from '../../common/utils/token-invite';
import { PrismaService } from '../../core/database/prisma.service';
import { EmailService } from '../../core/email/email.service';
import { normalizeRecipients } from '../../core/email/email-content';
import { resolveOrganisationName } from '../../core/email/organisation';
import { candidateApplicationInviteEmail } from '../../core/email/templates/candidate-application-invite';
import { VaultStorageService } from '../vault/vault-storage.service';
import {
  assertExtensionAllowed,
  assertSizeWithinCap,
} from '../vault/vault-guardrails';
import {
  CandidateResumeUploadUrlDto,
  CreateCandidateApplicationInviteDto,
  EmailCandidateApplicationInviteDto,
  SubmitCandidateApplicationDto,
} from './dto/candidate-application.dto';
import {
  CandidateApplicationEmailResultEntity,
  CandidateApplicationEmailSummaryEntity,
} from './entities/candidate-application-email.entity';

const RESUME_PREFIX = 'candidate-applications/resumes/';

/**
 * An offer that is out and not refused. Selecting a second applicant, opening a
 * new application link, or letting the public form accept a submission while one
 * of these exists would be inviting people to a position that is already
 * committed. A DECLINED offer deliberately does not match — that is exactly the
 * case where the position reopens.
 */
const LIVE_OFFER_FILTER = {
  declinedAt: null,
  status: {
    in: [
      OfferLetterStatus.DRAFT,
      OfferLetterStatus.PENDING_VERTICAL_APPROVAL,
      OfferLetterStatus.PENDING_CEO_APPROVAL,
      OfferLetterStatus.APPROVED,
    ],
  },
} satisfies Prisma.OfferLetterWhereInput;

/** An offer the candidate has said yes to. The position is filled from here on —
 *  onboarding is paperwork — so applications close. */
const ACCEPTED_OFFER_FILTER = {
  status: OfferLetterStatus.APPROVED,
  acceptedAt: { not: null },
  declinedAt: null,
} satisfies Prisma.OfferLetterWhereInput;
/** The public route the token is appended to. Must match the frontend page. */
const PUBLIC_APPLICATION_PATH = '/public/job-applications';

@Injectable()
export class CandidateApplicationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: VaultStorageService,
    private readonly email: EmailService,
    private readonly config: ConfigService,
  ) {}

  async createInvite(
    requisitionId: string,
    dto: CreateCandidateApplicationInviteDto,
    user: AuthenticatedUser,
  ) {
    await this.assertHr(user);
    const requisition = await this.requisition(requisitionId);
    if (requisition.status !== CandidateRequisitionStatus.APPROVED) {
      throw new BadRequestException(
        'Application links can only be created for an Approved requisition',
      );
    }
    if (requisition.hiringStage === CandidateHiringStage.CANDIDATE_SELECTED) {
      throw new BadRequestException(
        'A Fulfilled requisition is already closed',
      );
    }
    // The stage alone no longer tells us the position is taken: it reaches
    // CANDIDATE_SELECTED only at onboarding, so between acceptance and joining a
    // stage check would still read as open.
    await this.assertNoAcceptedOffer(requisitionId);
    const created = await this.prisma.candidateApplicationInvite.create({
      data: {
        requisitionId,
        token: generateInviteToken(),
        passwordHash: await hashInvitePassword(
          dto.password?.trim() || undefined,
        ),
        expiresAt: computeExpiry(dto.expiresInHours ?? 2160),
        createdById: user.id,
      },
      select: {
        id: true,
        token: true,
        expiresAt: true,
        revokedAt: true,
        createdAt: true,
      },
    });
    return { ...created, hasPassword: !!dto.password?.trim() };
  }

  async listInvites(requisitionId: string, user: AuthenticatedUser) {
    await this.assertCanView(requisitionId, user);
    return this.prisma.candidateApplicationInvite
      .findMany({
        where: { requisitionId },
        select: {
          id: true,
          token: true,
          expiresAt: true,
          revokedAt: true,
          createdAt: true,
          passwordHash: true,
        },
        orderBy: { createdAt: 'desc' },
      })
      .then((rows) =>
        rows.map(({ passwordHash, ...row }) => ({
          ...row,
          hasPassword: !!passwordHash,
        })),
      );
  }

  async revokeInvite(inviteId: string, user: AuthenticatedUser) {
    await this.assertHr(user);
    const invite = await this.prisma.candidateApplicationInvite.findUnique({
      where: { id: inviteId },
    });
    if (!invite) throw new NotFoundException('Application link not found');
    if (!invite.revokedAt) {
      await this.prisma.candidateApplicationInvite.update({
        where: { id: inviteId },
        data: { revokedAt: new Date() },
      });
    }
    return { success: true };
  }

  /**
   * Email an existing application link to one or more candidates.
   *
   * One message PER candidate, never a shared To line: a shortlist blast that
   * exposed every applicant's address to the others would be a privacy breach,
   * and job seekers are entitled to not know who else was approached. That is
   * also why one bad address is reported rather than allowed to abort the batch.
   *
   * Re-checks the same gates the public form enforces (revoked, expired, the
   * requisition still Approved and not Fulfilled) so we can never mail a link
   * that would greet the candidate with a rejection.
   */
  async emailInvite(
    inviteId: string,
    dto: EmailCandidateApplicationInviteDto,
    user: AuthenticatedUser,
    now: Date = new Date(),
  ): Promise<CandidateApplicationEmailSummaryEntity> {
    await this.assertHr(user);
    const invite = await this.prisma.candidateApplicationInvite.findUnique({
      where: { id: inviteId },
      select: {
        token: true,
        expiresAt: true,
        revokedAt: true,
        passwordHash: true,
        requisition: {
          select: {
            requisitionNumber: true,
            positionTitle: true,
            employmentType: true,
            status: true,
            hiringStage: true,
            vertical: { select: { name: true } },
            // Presence of an accepted offer closes the position; fetched with the
            // invite so the gate costs no extra round trip.
            offerLetters: { where: ACCEPTED_OFFER_FILTER, select: { id: true } },
          },
        },
      },
    });
    if (!invite) throw new NotFoundException('Application link not found');
    if (invite.revokedAt) {
      throw new BadRequestException(
        'This link has been revoked — generate a new one before emailing it',
      );
    }
    if (invite.expiresAt <= now) {
      throw new BadRequestException(
        'This link has expired — generate a new one before emailing it',
      );
    }
    const requisition = invite.requisition;
    if (requisition.status !== CandidateRequisitionStatus.APPROVED) {
      throw new BadRequestException(
        'Only an Approved requisition may be sent to candidates',
      );
    }
    if (requisition.hiringStage === CandidateHiringStage.CANDIDATE_SELECTED) {
      throw new BadRequestException(
        'This requisition is already Fulfilled — the application link is closed',
      );
    }
    if (requisition.offerLetters.length) {
      throw new BadRequestException(
        'A candidate has accepted the offer for this position — the application link is closed',
      );
    }

    const rendered = candidateApplicationInviteEmail({
      positionTitle: requisition.positionTitle,
      requisitionNumber: requisition.requisitionNumber,
      verticalName: requisition.vertical?.name ?? null,
      employmentType: requisition.employmentType,
      url: inviteLinkUrl(
        this.config.get<string>('frontendOrigin') ?? '',
        PUBLIC_APPLICATION_PATH,
        invite.token,
      ),
      expiresAt: invite.expiresAt,
      passwordProtected: !!invite.passwordHash,
      organisationName: await resolveOrganisationName(this.prisma),
      note: dto.note,
      now,
      timezone: this.config.get<string>('timezone'),
    });

    const results: CandidateApplicationEmailResultEntity[] = [];
    // normalizeRecipients de-duplicates case-insensitively, so pasting a list
    // with the same candidate twice mails them once.
    for (const to of normalizeRecipients(dto.to)) {
      try {
        const result = await this.email.send({
          to,
          subject: rendered.subject,
          html: rendered.html,
          text: rendered.text,
          tags: [{ name: 'kind', value: 'candidate-application-invite' }],
        });
        results.push(
          new CandidateApplicationEmailResultEntity({
            to,
            status: result.skipped ? 'skipped' : 'sent',
            reason: result.skipped ?? null,
            messageId: result.id,
          }),
        );
      } catch (err) {
        results.push(
          new CandidateApplicationEmailResultEntity({
            to,
            status: 'failed',
            reason: err instanceof Error ? err.message : String(err),
            messageId: null,
          }),
        );
      }
    }
    return new CandidateApplicationEmailSummaryEntity(results);
  }

  async resolve(token: string, password?: string) {
    const invite = await this.validInvite(token, password);
    return {
      requisitionNumber: invite.requisition.requisitionNumber,
      positionTitle: invite.requisition.positionTitle,
      verticalName: invite.requisition.vertical.name,
      employmentType: invite.requisition.employmentType,
    };
  }

  async createResumeUploadUrl(token: string, dto: CandidateResumeUploadUrlDto) {
    await this.validInvite(token, dto.password);
    assertExtensionAllowed(dto.fileName);
    assertSizeWithinCap(dto.sizeBytes);
    const storageKey = `${RESUME_PREFIX}${randomBytes(24).toString('hex')}`;
    const signed = await this.storage.createUploadUrl(storageKey, dto.mimeType);
    return { ...signed, storageKey };
  }

  async submit(token: string, dto: SubmitCandidateApplicationDto) {
    const invite = await this.validInvite(token, dto.password);
    if (!dto.resumeFileKey.startsWith(RESUME_PREFIX)) {
      throw new BadRequestException('Invalid resume upload key');
    }
    assertExtensionAllowed(dto.resumeFileName);
    assertSizeWithinCap(dto.resumeFileSize);
    const uploaded = await this.storage.headObject(dto.resumeFileKey);
    if (!uploaded) throw new BadRequestException('Resume upload was not found');
    assertSizeWithinCap(uploaded.sizeBytes);
    if (uploaded.sizeBytes !== dto.resumeFileSize) {
      throw new BadRequestException('Uploaded resume size does not match');
    }
    if (uploaded.contentType && uploaded.contentType !== dto.resumeMimeType) {
      throw new BadRequestException('Uploaded resume type does not match');
    }
    if (dto.relevantExperienceYears > dto.totalExperienceYears) {
      throw new BadRequestException(
        'Relevant experience cannot exceed total experience',
      );
    }
    return this.prisma.candidateApplication.create({
      data: {
        requisitionId: invite.requisitionId,
        name: dto.name.trim(),
        contact: dto.contact.trim(),
        areaOfExpertise: dto.areaOfExpertise.trim(),
        totalExperienceYears: dto.totalExperienceYears,
        relevantExperienceYears: dto.relevantExperienceYears,
        currentCtc: dto.currentCtc ?? null,
        expectedCtc: dto.expectedCtc ?? null,
        aboutExperience: dto.aboutExperience.trim(),
        projects: dto.projects?.trim() || null,
        resumeFileKey: dto.resumeFileKey,
        resumeFileName: dto.resumeFileName,
        resumeFileSize: uploaded.sizeBytes,
        resumeMimeType: dto.resumeMimeType,
      },
      select: { id: true, status: true, submittedAt: true },
    });
  }

  async listApplications(requisitionId: string, user: AuthenticatedUser) {
    await this.assertCanView(requisitionId, user);
    return this.prisma.candidateApplication.findMany({
      where: { requisitionId },
      orderBy: { submittedAt: 'desc' },
    });
  }

  async resumeDownloadUrl(applicationId: string, user: AuthenticatedUser) {
    const application = await this.prisma.candidateApplication.findUnique({
      where: { id: applicationId },
    });
    if (!application)
      throw new NotFoundException('Candidate application not found');
    await this.assertCanView(application.requisitionId, user);
    const signed = await this.storage.createDownloadUrl(
      application.resumeFileKey,
    );
    return {
      downloadUrl: signed.url,
      expiresInSeconds: signed.expiresInSeconds,
    };
  }

  async updateStatus(
    applicationId: string,
    status: CandidateApplicationStatus,
    user: AuthenticatedUser,
  ) {
    await this.assertHr(user);
    const application = await this.prisma.candidateApplication.findUnique({
      where: { id: applicationId },
      include: {
        requisition: true,
        offerLetter: { select: { id: true, status: true, declinedAt: true } },
      },
    });
    if (!application)
      throw new NotFoundException('Candidate application not found');
    if (
      application.requisition.status !== CandidateRequisitionStatus.APPROVED
    ) {
      throw new BadRequestException('The requisition is not Approved');
    }
    if (
      application.requisition.hiringStage ===
        CandidateHiringStage.CANDIDATE_SELECTED &&
      status === CandidateApplicationStatus.SELECTED &&
      application.status !== CandidateApplicationStatus.SELECTED
    ) {
      throw new BadRequestException('This requisition is already Fulfilled');
    }
    // An applicant who has been made an offer is no longer a shortlist entry
    // whose status HR can flip: rejecting them here would silently strand a live
    // letter, and their outcome belongs to the offer (accept / decline) instead.
    if (
      application.offerLetter &&
      !application.offerLetter.declinedAt &&
      status !== application.status
    ) {
      throw new BadRequestException(
        'This candidate has a live offer letter — record their acceptance or decline on the offer instead',
      );
    }
    if (
      status === CandidateApplicationStatus.SELECTED &&
      application.status !== CandidateApplicationStatus.SELECTED
    ) {
      // Only one applicant may be in play at a time, so a second selection is
      // refused while an offer is out to somebody else. `consumedAt` is the same
      // guard on the offer-creation side.
      const liveOffer = await this.prisma.offerLetter.findFirst({
        where: {
          candidateRequisitionId: application.requisitionId,
          ...LIVE_OFFER_FILTER,
        },
        select: { candidateApplication: { select: { name: true } } },
      });
      if (liveOffer) {
        throw new BadRequestException(
          `An offer letter is already out to ${liveOffer.candidateApplication?.name ?? 'another candidate'} for this position`,
        );
      }
    }
    return this.prisma.$transaction(async (tx) => {
      if (status === CandidateApplicationStatus.SELECTED) {
        // Selection authorizes an offer; it is NOT the hire. The stage stays put
        // (sending the offer moves it to OFFER_EXTENDED) and the application
        // links stay open, because the candidate may still decline and HR would
        // otherwise have to re-open the position from scratch.
        await tx.candidateRequisition.update({
          where: { id: application.requisitionId },
          data: { selectedCandidateName: application.name },
        });
      }
      return tx.candidateApplication.update({
        where: { id: applicationId },
        data: { status },
      });
    });
  }

  private async validInvite(token: string, password?: string) {
    const invite = await this.prisma.candidateApplicationInvite.findUnique({
      where: { token },
      include: {
        requisition: {
          include: {
            vertical: { select: { name: true } },
            offerLetters: { where: ACCEPTED_OFFER_FILTER, select: { id: true } },
          },
        },
      },
    });
    if (!invite) throw new NotFoundException('Application link not found');
    await assertInviteUsable(invite, password);
    if (
      invite.requisition.status !== CandidateRequisitionStatus.APPROVED ||
      invite.requisition.hiringStage ===
        CandidateHiringStage.CANDIDATE_SELECTED ||
      // Accepted, but not yet joined: the stage is still OFFER_EXTENDED, so this
      // is the check that actually closes the form.
      invite.requisition.offerLetters.length > 0
    ) {
      throw new ForbiddenException(
        'This position is no longer accepting applications',
      );
    }
    return invite;
  }

  /** Refuses when the position is already committed to a candidate who accepted
   *  their offer. */
  private async assertNoAcceptedOffer(requisitionId: string) {
    const accepted = await this.prisma.offerLetter.count({
      where: { candidateRequisitionId: requisitionId, ...ACCEPTED_OFFER_FILTER },
    });
    if (accepted) {
      throw new BadRequestException(
        'A candidate has accepted the offer for this position — applications are closed',
      );
    }
  }

  private async requisition(id: string) {
    const row = await this.prisma.candidateRequisition.findUnique({
      where: { id },
    });
    if (!row) throw new NotFoundException('Candidate requisition not found');
    return row;
  }

  // Mirrors who can see the requisition in the register (candidate-requisitions.service
  // listRegister): HR staff and the CEO see all; the requester and the vertical owner
  // see their own. Anyone who can open the requisition can therefore load its applications.
  private async assertCanView(requisitionId: string, user: AuthenticatedUser) {
    const row = await this.prisma.candidateRequisition.findUnique({
      where: { id: requisitionId },
      select: { requestedById: true, vertical: { select: { ownerId: true } } },
    });
    if (!row) throw new NotFoundException('Candidate requisition not found');
    const canView =
      user.role === Role.SUPER_ADMIN ||
      row.requestedById === user.id ||
      row.vertical.ownerId === user.id ||
      (await this.isHr(user));
    if (!canView) {
      throw new ForbiddenException(
        "Only HR, the CEO, the requisition's vertical owner, and the original requester may view candidate applications",
      );
    }
  }

  private async assertHr(user: AuthenticatedUser) {
    if (!(await this.isHr(user))) {
      throw new ForbiddenException('Only HR may manage candidate applications');
    }
  }

  private async isHr(user: AuthenticatedUser) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: user.id },
      select: { vertical: { select: { code: true } } },
    });
    return employee?.vertical?.code?.toUpperCase() === 'HR';
  }
}
