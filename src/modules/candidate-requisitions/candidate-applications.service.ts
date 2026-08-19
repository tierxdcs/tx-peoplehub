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
} from '@prisma/client';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import {
  assertInviteUsable,
  computeExpiry,
  generateInviteToken,
  hashInvitePassword,
} from '../../common/utils/token-invite';
import { PrismaService } from '../../core/database/prisma.service';
import { VaultStorageService } from '../vault/vault-storage.service';
import {
  assertExtensionAllowed,
  assertSizeWithinCap,
} from '../vault/vault-guardrails';
import {
  CandidateResumeUploadUrlDto,
  CreateCandidateApplicationInviteDto,
  SubmitCandidateApplicationDto,
} from './dto/candidate-application.dto';

const RESUME_PREFIX = 'candidate-applications/resumes/';

@Injectable()
export class CandidateApplicationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: VaultStorageService,
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
      throw new BadRequestException('A Fulfilled requisition is already closed');
    }
    const created = await this.prisma.candidateApplicationInvite.create({
      data: {
        requisitionId,
        token: generateInviteToken(),
        passwordHash: await hashInvitePassword(dto.password?.trim() || undefined),
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
    return this.prisma.candidateApplicationInvite.findMany({
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
    }).then((rows) => rows.map(({ passwordHash, ...row }) => ({
      ...row,
      hasPassword: !!passwordHash,
    })));
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

  async resolve(token: string, password?: string) {
    const invite = await this.validInvite(token, password);
    return {
      requisitionNumber: invite.requisition.requisitionNumber,
      positionTitle: invite.requisition.positionTitle,
      verticalName: invite.requisition.vertical.name,
      employmentType: invite.requisition.employmentType,
    };
  }

  async createResumeUploadUrl(
    token: string,
    dto: CandidateResumeUploadUrlDto,
  ) {
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
    if (!application) throw new NotFoundException('Candidate application not found');
    await this.assertCanView(application.requisitionId, user);
    const signed = await this.storage.createDownloadUrl(application.resumeFileKey);
    return { downloadUrl: signed.url, expiresInSeconds: signed.expiresInSeconds };
  }

  async updateStatus(
    applicationId: string,
    status: CandidateApplicationStatus,
    user: AuthenticatedUser,
  ) {
    await this.assertHr(user);
    const application = await this.prisma.candidateApplication.findUnique({
      where: { id: applicationId },
      include: { requisition: true },
    });
    if (!application) throw new NotFoundException('Candidate application not found');
    if (application.requisition.status !== CandidateRequisitionStatus.APPROVED) {
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
    return this.prisma.$transaction(async (tx) => {
      if (status === CandidateApplicationStatus.SELECTED) {
        await tx.candidateRequisition.update({
          where: { id: application.requisitionId },
          data: {
            selectedCandidateName: application.name,
            hiringStage: CandidateHiringStage.CANDIDATE_SELECTED,
          },
        });
        await tx.candidateApplicationInvite.updateMany({
          where: { requisitionId: application.requisitionId, revokedAt: null },
          data: { revokedAt: new Date() },
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
          include: { vertical: { select: { name: true } } },
        },
      },
    });
    if (!invite) throw new NotFoundException('Application link not found');
    await assertInviteUsable(invite, password);
    if (
      invite.requisition.status !== CandidateRequisitionStatus.APPROVED ||
      invite.requisition.hiringStage === CandidateHiringStage.CANDIDATE_SELECTED
    ) {
      throw new ForbiddenException('This position is no longer accepting applications');
    }
    return invite;
  }

  private async requisition(id: string) {
    const row = await this.prisma.candidateRequisition.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Candidate requisition not found');
    return row;
  }

  private async assertCanView(requisitionId: string, user: AuthenticatedUser) {
    const row = await this.requisition(requisitionId);
    if (row.requestedById !== user.id && !(await this.isHr(user))) {
      throw new ForbiddenException(
        'Only HR and the original requester may view candidate applications',
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
