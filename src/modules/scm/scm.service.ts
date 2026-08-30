import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  Role,
  VendorQuestionnaireStatus,
  VendorStatus,
} from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../core/database/prisma.service';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import {
  assertInviteUsable,
  computeExpiry,
  generateInviteToken,
  hashInvitePassword,
  inviteLinkUrl,
} from '../../common/utils/token-invite';
import { EmailService } from '../../core/email/email.service';
import { EmailSendResultEntity } from '../../core/email/email-send.entity';
import { SendInviteEmailDto } from '../../core/email/send-invite-email.dto';
import { isValidEmailAddress } from '../../core/email/email-content';
import { resolveOrganisationName } from '../../core/email/organisation';
import { qualificationInviteEmail } from '../../core/email/templates/qualification-invite';
import { VaultStorageService } from '../vault/vault-storage.service';
import {
  assertExtensionAllowed,
  assertSizeWithinCap,
  fileExtension,
} from '../vault/vault-guardrails';
import { VaultFilesService } from '../vault/vault-files.service';
import { KanbanNotificationsService } from '../notifications/kanban-notifications.service';
import { ScmAccessService } from './scm-access.service';
import {
  classify,
  classificationToVendorStatus,
  CLASSIFICATION_LABEL,
  computeTotalScore,
  vendorStatusToClassification,
  type VendorClassification,
} from './vendor-scoring';
import {
  CreateAuditDto,
  CreateInviteDto,
  CreateVendorDto,
  OverrideClassificationDto,
  PublicCertConfirmDto,
  PublicCertUploadUrlDto,
  PublicNdaConfirmDto,
  PublicNdaUploadUrlDto,
  NdaTemplateUploadUrlDto,
  PublicCompanyInfoDto,
  PublicQuestionnaireSaveDto,
  UpdateVendorCoreCompetencyDto,
} from './dto/scm.dto';
import {
  VendorAuditEntity,
  VendorCertificateFileEntity,
  VendorCompanyInfoEntity,
  VendorEntity,
  VendorInviteEntity,
  VendorQuestionnaireEntity,
} from './entities/scm.entity';

/** The Vendor master fields the public form's Company Information section can write. */
type VendorCompanyInfo = {
  companyName: string;
  contactEmail: string;
  registeredAddress: string | null;
  factoryAddress: string | null;
  yearEstablished: string | null;
  numberOfEmployees: string | null;
  annualTurnover: string | null;
  msmeUdyamCertificate: string | null;
  contactPersonName: string | null;
  contactPersonDesignation: string | null;
  contactPhone: string | null;
  website: string | null;
};

/** Default invite lifetime — 14 days, generous given the form's length (§5). */
const DEFAULT_INVITE_EXPIRY_HOURS = 14 * 24;

/**
 * The public form's route, token excluded. Must match the frontend page at
 * web/app/public/vendor-questionnaire/[token] — the emailed link and the link
 * the detail page shows for copying are now both built from this.
 */
const PUBLIC_QUESTIONNAIRE_PATH = '/public/vendor-questionnaire';

/** NDA execution is an onboarding gate, not a recurring revision requirement. */
export function requiresSignedNda(revisionNumber: number): boolean {
  return revisionNumber === 1;
}

/** The 18 VSAQ section keys, for copy-forward on revision + save mapping. */
const SECTION_KEYS = [
  'businessProfile',
  'manufacturingCapability',
  'equipmentDetails',
  'productionCapacity',
  'qualityManagement',
  'engineeringCapability',
  'supplyChain',
  'traceability',
  'logistics',
  'sustainability',
  'informationSecurity',
  'businessContinuity',
  'ehs',
  'financialInformation',
  'customerSupport',
  'compliance',
  'references',
  'declaration',
] as const;

type CertFile = {
  storageKey: string;
  name: string;
  sizeBytes: number | null;
  contentType: string | null;
  /** Certification this document evidences (e.g. "ISO 9001"); null = general. */
  label?: string | null;
};

@Injectable()
export class ScmService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ScmAccessService,
    private readonly storage: VaultStorageService,
    private readonly vaultFiles: VaultFilesService,
    private readonly notifications: KanbanNotificationsService,
    private readonly email: EmailService,
    private readonly config: ConfigService,
  ) {}

  // ── Vendors ────────────────────────────────────────────────────────
  /** Create a Vendor + its first questionnaire (SENT). SCM Manager+/SA. */
  async createVendor(
    dto: CreateVendorDto,
    user: AuthenticatedUser,
  ): Promise<VendorEntity> {
    await this.access.assertCanManageVendors(user);
    const vendor = await this.prisma.$transaction(async (tx) => {
      const created = await tx.vendor.create({
        data: {
          companyName: dto.companyName,
          registeredAddress: dto.registeredAddress ?? null,
          factoryAddress: dto.factoryAddress ?? null,
          yearEstablished: dto.yearEstablished ?? null,
          numberOfEmployees: dto.numberOfEmployees ?? null,
          annualTurnover: dto.annualTurnover ?? null,
          msmeUdyamCertificate: dto.msmeUdyamCertificate ?? null,
          contactPersonName: dto.contactPersonName ?? null,
          contactPersonDesignation: dto.contactPersonDesignation ?? null,
          contactEmail: dto.contactEmail,
          contactPhone: dto.contactPhone ?? null,
          website: dto.website ?? null,
          createdById: user.id,
        },
      });
      await tx.vendorQuestionnaire.create({
        data: { vendorId: created.id, revisionNumber: 1 },
      });
      return created;
    });
    return this.toVendor(vendor);
  }

  /**
   * Set/correct the vendor master's core competency independently of an audit.
   * SCM Manager+/SA. Core competency is normally captured on the audit, but it
   * is a vendor-level attribute (used for sourcing) and staff need to maintain
   * it directly — e.g. before any audit exists, or when it was mis-recorded.
   * This touches only the Vendor master; it never alters audit records or the
   * qualification status.
   */
  async updateVendorCoreCompetency(
    id: string,
    dto: UpdateVendorCoreCompetencyDto,
    user: AuthenticatedUser,
  ): Promise<VendorEntity> {
    await this.access.assertCanManageVendors(user);
    const exists = await this.prisma.vendor.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException('Vendor not found');
    const updated = await this.prisma.vendor.update({
      where: { id },
      data: { coreCompetency: dto.coreCompetency },
    });
    return this.toVendor(updated);
  }

  /** Company-wide read — any authenticated employee. */
  async listVendors(): Promise<VendorEntity[]> {
    const rows = await this.prisma.vendor.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((s) => this.toVendor(s));
  }

  /** Company-wide read: vendor + its questionnaires + audits (with computed). */
  async getVendor(id: string): Promise<
    VendorEntity & {
      questionnaires: VendorQuestionnaireEntity[];
      audits: VendorAuditEntity[];
    }
  > {
    const s = await this.prisma.vendor.findUnique({
      where: { id },
      include: {
        questionnaires: { orderBy: { revisionNumber: 'desc' } },
        audits: {
          orderBy: { createdAt: 'desc' },
          include: {
            auditor: { select: { firstName: true, lastName: true } },
            overriddenBy: { select: { firstName: true, lastName: true } },
          },
        },
      },
    });
    if (!s) throw new NotFoundException('Vendor not found');
    return {
      ...this.toVendor(s),
      questionnaires: s.questionnaires.map((q) => this.toQuestionnaire(q, s)),
      audits: s.audits.map((a) => this.toAudit(a)),
    };
  }

  /**
   * Permanently delete a Vendor master and its owned qualification records.
   * Operational records are never detached or erased: once a vendor has been
   * used for sourcing, PLM, purchasing, or AP, the master must be retained.
   */
  async deleteVendor(
    id: string,
    user: AuthenticatedUser,
  ): Promise<{ id: string; deleted: true }> {
    if (user.role !== Role.SUPER_ADMIN) {
      throw new ForbiddenException('Only CEO/SuperAdmin may delete vendors');
    }

    const vendor = await this.prisma.vendor.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!vendor) throw new NotFoundException('Vendor not found');

    try {
      return await this.prisma.$transaction(async (tx) => {
        const counts = await Promise.all([
          tx.orderLineItem.count({ where: { vendorId: id } }),
          tx.orderLineDeliverySplit.count({ where: { vendorId: id } }),
          tx.plmTracker.count({ where: { vendorId: id } }),
          tx.rfqInvitee.count({ where: { vendorId: id } }),
          tx.purchaseOrder.count({ where: { vendorId: id } }),
          tx.accountsPayableInvoice.count({ where: { vendorId: id } }),
          tx.accountsPayablePayment.count({ where: { vendorId: id } }),
        ]);
        const labels = [
          'order lines',
          'order delivery splits',
          'PLM trackers',
          'RFQ invitations',
          'purchase orders',
          'AP invoices',
          'AP payments',
        ];
        const usedBy = counts
          .map((count, index) => (count ? `${labels[index]} (${count})` : null))
          .filter(Boolean);
        if (usedBy.length) {
          throw new ConflictException(
            `This vendor cannot be deleted because it is used by: ${usedBy.join(', ')}. Retain the vendor to preserve operational history.`,
          );
        }

        await tx.vendor.delete({ where: { id } });
        return { id, deleted: true as const };
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2003'
      ) {
        throw new ConflictException(
          'This vendor cannot be deleted because it is referenced elsewhere in the system. Retain it to preserve operational history.',
        );
      }
      throw error;
    }
  }

  // ── Questionnaire revisions ──────────────────────────────────────────
  /**
   * Create the next questionnaire revision (for resubmission after a
   * Conditionally Approved improvement plan). Append-only: the prior revision
   * is untouched; section content is copied forward into a fresh SENT revision.
   * SCM Manager+/SA.
   */
  async createQuestionnaireRevision(
    vendorId: string,
    user: AuthenticatedUser,
  ): Promise<VendorQuestionnaireEntity> {
    await this.access.assertCanManageVendors(user);
    const latest = await this.prisma.vendorQuestionnaire.findFirst({
      where: { vendorId },
      orderBy: { revisionNumber: 'desc' },
    });
    if (!latest)
      throw new NotFoundException('Vendor or questionnaire not found');

    const copyForward: Prisma.VendorQuestionnaireCreateInput = {
      vendor: { connect: { id: vendorId } },
      revisionNumber: latest.revisionNumber + 1,
      status: VendorQuestionnaireStatus.SENT,
    };
    for (const key of SECTION_KEYS) {
      const val = latest[key];
      if (val != null) {
        (copyForward as Record<string, unknown>)[key] =
          val as Prisma.InputJsonValue;
      }
    }
    if (latest.qualityCertificateFiles != null) {
      copyForward.qualityCertificateFiles =
        latest.qualityCertificateFiles as Prisma.InputJsonValue;
    }
    const created = await this.prisma.vendorQuestionnaire.create({
      data: copyForward,
    });
    // Back to pending-questionnaire state for the resubmission cycle. Any prior
    // classification override no longer applies to a fresh questionnaire cycle.
    const vendor = await this.prisma.vendor.update({
      where: { id: vendorId },
      data: {
        status: VendorStatus.PENDING_QUESTIONNAIRE,
        statusOverridden: false,
      },
    });
    return this.toQuestionnaire(created, vendor);
  }

  // ── Invites (token links) ────────────────────────────────────────────
  /** Generate a public invite for a questionnaire. SCM Manager+/SA. */
  async createInvite(
    questionnaireId: string,
    dto: CreateInviteDto,
    user: AuthenticatedUser,
  ): Promise<VendorInviteEntity> {
    await this.access.assertCanManageVendors(user);
    const q = await this.prisma.vendorQuestionnaire.findUnique({
      where: { id: questionnaireId },
      select: { id: true },
    });
    if (!q) throw new NotFoundException('Questionnaire not found');

    const token = generateInviteToken();
    const expiresAt = computeExpiry(
      dto.expiresInHours ?? DEFAULT_INVITE_EXPIRY_HOURS,
    );
    const passwordHash = await hashInvitePassword(dto.password);
    const invite = await this.prisma.vendorQuestionnaireInvite.create({
      data: {
        questionnaireId,
        token,
        expiresAt,
        passwordHash,
        createdById: user.id,
      },
    });
    return this.toInvite(invite);
  }

  /** Revoke an invite — SCM Manager+/SA. Idempotent. */
  async revokeInvite(inviteId: string, user: AuthenticatedUser): Promise<void> {
    await this.access.assertCanManageVendors(user);
    const invite = await this.prisma.vendorQuestionnaireInvite.findUnique({
      where: { id: inviteId },
      select: { id: true, revokedAt: true },
    });
    if (!invite) throw new NotFoundException('Invite not found');
    if (invite.revokedAt) return;
    await this.prisma.vendorQuestionnaireInvite.update({
      where: { id: inviteId },
      data: { revokedAt: new Date() },
    });
  }

  /**
   * Email an existing invite link to the vendor. SCM Manager+/SA.
   *
   * A separate action rather than auto-send on create, so re-sending (bounced,
   * wrong person, gentle nudge) doesn't mint a new token and invalidate the link
   * the vendor may already have. Strict `send()` — the staff member pressed a
   * "send" button, so a provider failure must surface, not be swallowed.
   */
  async sendInviteEmail(
    inviteId: string,
    dto: SendInviteEmailDto,
    user: AuthenticatedUser,
    now: Date = new Date(),
  ): Promise<EmailSendResultEntity> {
    await this.access.assertCanManageVendors(user);
    const invite = await this.prisma.vendorQuestionnaireInvite.findUnique({
      where: { id: inviteId },
      select: {
        token: true,
        expiresAt: true,
        revokedAt: true,
        passwordHash: true,
        questionnaire: {
          select: {
            vendor: {
              select: {
                companyName: true,
                contactEmail: true,
                contactPersonName: true,
              },
            },
          },
        },
      },
    });
    if (!invite) throw new NotFoundException('Invite not found');
    if (invite.revokedAt)
      throw new BadRequestException(
        'This invite has been revoked — generate a new one before emailing it',
      );
    if (invite.expiresAt <= now)
      throw new BadRequestException(
        'This invite has expired — generate a new one before emailing it',
      );

    const vendor = invite.questionnaire.vendor;
    const to = (dto.to ?? vendor.contactEmail ?? '').trim();
    if (!isValidEmailAddress(to))
      throw new BadRequestException(
        dto.to
          ? 'The recipient address is not valid'
          : 'This vendor has no valid contact email — supply a recipient',
      );

    const url = inviteLinkUrl(
      this.config.get<string>('frontendOrigin') ?? '',
      PUBLIC_QUESTIONNAIRE_PATH,
      invite.token,
    );
    const rendered = qualificationInviteEmail({
      kind: 'vendor',
      companyName: vendor.companyName,
      contactPersonName: vendor.contactPersonName,
      url,
      expiresAt: invite.expiresAt,
      passwordProtected: !!invite.passwordHash,
      organisationName: await resolveOrganisationName(this.prisma),
      note: dto.note,
      now,
      timezone: this.config.get<string>('timezone'),
    });
    // No idempotency key on purpose: a second press IS a deliberate re-send,
    // and Resend would silently suppress it as a duplicate for 24h.
    const result = await this.email.send({
      to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      tags: [{ name: 'kind', value: 'vendor-qualification-invite' }],
    });
    return EmailSendResultEntity.from(result);
  }

  // ── Public (token) resolution + save/submit ──────────────────────────
  /**
   * Resolve a token to its questionnaire, validating expiry/revoke/password —
   * the exact Vault external-share validation order. Returns the questionnaire
   * for the public form. `now` is injectable for deterministic tests.
   */
  async resolvePublic(
    token: string,
    password: string | undefined,
    now: Date = new Date(),
  ): Promise<VendorQuestionnaireEntity> {
    const invite = await this.getValidInvite(token, password, now);
    const q = await this.prisma.vendorQuestionnaire.findUniqueOrThrow({
      where: { id: invite.questionnaireId },
      include: { vendor: true },
    });
    return this.toQuestionnaire(q, q.vendor);
  }

  /**
   * Partial save (resume) of section data — must be a non-submitted revision.
   * `companyInfo`, if present, writes back to the Vendor master record itself
   * (not the questionnaire) — this is how a vendor completes/corrects the
   * fields staff left blank at creation (see PublicCompanyInfoDto).
   */
  async savePublic(
    token: string,
    dto: PublicQuestionnaireSaveDto,
    now: Date = new Date(),
  ): Promise<VendorQuestionnaireEntity> {
    const invite = await this.getValidInvite(token, dto.password, now);
    const q = await this.assertEditableQuestionnaire(invite.questionnaireId);

    const data: Prisma.VendorQuestionnaireUpdateInput = {};
    for (const key of SECTION_KEYS) {
      const val = (dto as Record<string, unknown>)[key];
      if (val !== undefined) {
        (data as Record<string, unknown>)[key] = val as Prisma.InputJsonValue;
      }
    }
    const [updated, vendor] = await this.prisma.$transaction([
      this.prisma.vendorQuestionnaire.update({ where: { id: q.id }, data }),
      this.prisma.vendor.update({
        where: { id: q.vendorId },
        data: this.companyInfoUpdateData(dto.companyInfo),
      }),
    ]);
    return this.toQuestionnaire(updated, vendor);
  }

  /**
   * Final submit — locks the questionnaire (→ SUBMITTED), sets Vendor →
   * QUESTIONNAIRE_SUBMITTED, and notifies the vendor's creator. Accepts the
   * final section payload (+ optional companyInfo) in the same shape as save.
   */
  async submitPublic(
    token: string,
    dto: PublicQuestionnaireSaveDto,
    now: Date = new Date(),
  ): Promise<VendorQuestionnaireEntity> {
    const invite = await this.getValidInvite(token, dto.password, now);
    const q = await this.assertEditableQuestionnaire(invite.questionnaireId);
    if (requiresSignedNda(q.revisionNumber)) {
      const signedNda = q.signedNdaFileId
        ? await this.prisma.vaultFile.findFirst({
            where: { id: q.signedNdaFileId, status: 'ACTIVE' },
            select: { id: true },
          })
        : null;
      if (!signedNda) {
        throw new BadRequestException(
          'Upload the signed NDA before submitting the first questionnaire',
        );
      }
    }

    const data: Prisma.VendorQuestionnaireUpdateInput = {
      status: VendorQuestionnaireStatus.SUBMITTED,
      submittedAt: now,
    };
    for (const key of SECTION_KEYS) {
      const val = (dto as Record<string, unknown>)[key];
      if (val !== undefined) {
        (data as Record<string, unknown>)[key] = val as Prisma.InputJsonValue;
      }
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.vendorQuestionnaire.update({
        where: { id: q.id },
        data,
      });
      const vendor = await tx.vendor.update({
        where: { id: u.vendorId },
        data: {
          status: VendorStatus.QUESTIONNAIRE_SUBMITTED,
          ...this.companyInfoUpdateData(dto.companyInfo),
        },
      });
      return { u, vendor };
    });

    // Notify the SCM creator (post-commit; actor is the external vendor → null).
    await this.notifications.notifyVendorQuestionnaireSubmitted({
      recipientId: updated.vendor.createdById,
      actorId: null,
      vendorId: updated.u.vendorId,
      vendorName: updated.vendor.companyName,
    });
    return this.toQuestionnaire(updated.u, updated.vendor);
  }

  // ── Public certificate upload (reuses Vault guardrails) ──────────────
  /** Presign a certificate PUT — same extension/size guardrails as Vault. */
  async publicCertUploadUrl(
    token: string,
    dto: PublicCertUploadUrlDto,
    now: Date = new Date(),
  ): Promise<{
    storageKey: string;
    uploadUrl: string;
    expiresInSeconds: number;
  }> {
    const invite = await this.getValidInvite(token, dto.password, now);
    const q = await this.assertEditableQuestionnaire(invite.questionnaireId);

    // Reuse the exact Vault guardrails — no separate, looser check.
    assertExtensionAllowed(dto.name);
    assertSizeWithinCap(dto.sizeBytes);

    // Namespaced key so public uploads are isolated from vault/files/*.
    const rand = randomBytes(8).toString('hex');
    const storageKey = `vendor-questionnaires/${q.id}/certs/${rand}`;
    const { url, expiresInSeconds } = await this.storage.createUploadUrl(
      storageKey,
      dto.mimeType,
    );
    return { storageKey, uploadUrl: url, expiresInSeconds };
  }

  /**
   * Confirm a completed upload: verify the object exists and its ACTUAL size
   * is within the cap (a public caller can't declare a small size then push a
   * huge object), then append it to the questionnaire's certificate list.
   */
  async publicCertConfirm(
    token: string,
    dto: PublicCertConfirmDto,
    now: Date = new Date(),
  ): Promise<VendorCertificateFileEntity> {
    const invite = await this.getValidInvite(token, dto.password, now);
    const q = await this.assertEditableQuestionnaire(invite.questionnaireId);

    if (!dto.storageKey.startsWith(`vendor-questionnaires/${q.id}/certs/`)) {
      throw new BadRequestException(
        'storageKey does not belong to this questionnaire',
      );
    }
    const head = await this.storage.headObject(dto.storageKey);
    if (!head) {
      throw new BadRequestException('Uploaded object not found');
    }
    assertSizeWithinCap(head.sizeBytes); // guard on the ACTUAL size

    const file: CertFile = {
      storageKey: dto.storageKey,
      name: dto.name,
      sizeBytes: head.sizeBytes,
      contentType: head.contentType,
      label: dto.label?.trim() || null,
    };
    const existing = (q.qualityCertificateFiles as CertFile[] | null) ?? [];
    await this.prisma.vendorQuestionnaire.update({
      where: { id: q.id },
      data: {
        qualityCertificateFiles: [
          ...existing,
          file,
        ] as unknown as Prisma.InputJsonValue,
      },
    });
    return new VendorCertificateFileEntity(file);
  }

  /** Create a short-lived download URL for a certificate recorded on a questionnaire. */
  async certificateDownload(questionnaireId: string, fileIndex: number) {
    const questionnaire = await this.prisma.vendorQuestionnaire.findUnique({
      where: { id: questionnaireId },
      select: { qualityCertificateFiles: true },
    });
    if (!questionnaire) {
      throw new NotFoundException('Vendor questionnaire not found');
    }
    const files =
      (questionnaire.qualityCertificateFiles as CertFile[] | null) ?? [];
    const file = files[fileIndex];
    if (!Number.isInteger(fileIndex) || fileIndex < 0 || !file) {
      throw new NotFoundException('Vendor certificate not found');
    }
    const signed = await this.storage.createDownloadUrl(file.storageKey);
    return {
      downloadUrl: signed.url,
      expiresInSeconds: signed.expiresInSeconds,
      fileName: file.name,
      contentType: file.contentType,
    };
  }

  async ndaTemplateUploadUrl(
    dto: NdaTemplateUploadUrlDto,
    user: AuthenticatedUser,
  ) {
    this.access.assertIsSuperAdmin(user);
    const configured = await this.prisma.companyDocumentConfig.findUnique({
      where: { id: 'DEFAULT' },
      select: { ndaTemplateFileId: true },
    });
    if (configured?.ndaTemplateFileId) {
      const version = await this.vaultFiles.createVersionUrl(
        configured.ndaTemplateFileId,
        {
          mimeType: dto.mimeType,
          sizeBytes: dto.sizeBytes,
          changeNote: 'Replaced company NDA template',
        },
        user,
      );
      return {
        fileId: configured.ndaTemplateFileId,
        storageKey: version.storageKey,
        uploadUrl: version.uploadUrl,
        expiresInSeconds: version.expiresInSeconds,
      };
    }
    const ext = fileExtension(dto.name);
    return this.vaultFiles.createManagedUploadUrl({
      folderName: 'Vendor NDA',
      name: `Phaze_Dynamics_NDA_Template${ext ? `.${ext}` : ''}`,
      mimeType: dto.mimeType,
      sizeBytes: dto.sizeBytes,
      uploadedById: user.id,
      changeNote: 'Company NDA template',
    });
  }

  async confirmNdaTemplate(fileId: string, user: AuthenticatedUser) {
    this.access.assertIsSuperAdmin(user);
    const configured = await this.prisma.companyDocumentConfig.findUnique({
      where: { id: 'DEFAULT' },
      select: { ndaTemplateFileId: true },
    });
    if (configured?.ndaTemplateFileId === fileId) {
      await this.vaultFiles.confirmVersionUpload(fileId, user);
    } else {
      await this.vaultFiles.confirmManagedUpload(
        fileId,
        'Company NDA template',
      );
    }
    await this.prisma.companyDocumentConfig.upsert({
      where: { id: 'DEFAULT' },
      update: { ndaTemplateFileId: fileId },
      create: { id: 'DEFAULT', ndaTemplateFileId: fileId },
    });
    return { fileId };
  }

  async publicNdaTemplateDownload(token: string, password?: string) {
    await this.getValidInvite(token, password, new Date());
    const config = await this.prisma.companyDocumentConfig.findUnique({
      where: { id: 'DEFAULT' },
      include: {
        ndaTemplateFile: {
          include: {
            versions: { orderBy: { versionNumber: 'desc' }, take: 1 },
          },
        },
      },
    });
    const version = config?.ndaTemplateFile?.versions[0];
    if (!version || config?.ndaTemplateFile?.status !== 'ACTIVE') {
      throw new NotFoundException('NDA template is not configured');
    }
    const signed = await this.storage.createDownloadUrl(version.storageKey);
    return {
      downloadUrl: signed.url,
      expiresInSeconds: signed.expiresInSeconds,
    };
  }

  async publicSignedNdaUploadUrl(token: string, dto: PublicNdaUploadUrlDto) {
    const invite = await this.getValidInvite(token, dto.password, new Date());
    const q = await this.prisma.vendorQuestionnaire.findUnique({
      where: { id: invite.questionnaireId },
      include: { vendor: true },
    });
    if (!q || q.status !== VendorQuestionnaireStatus.SENT) {
      throw new BadRequestException('Questionnaire is not editable');
    }
    if (!requiresSignedNda(q.revisionNumber)) {
      throw new BadRequestException(
        'A signed NDA is required only for the first questionnaire revision',
      );
    }
    if (q.signedNdaFileId) {
      throw new BadRequestException('A signed NDA has already been uploaded');
    }
    const ext = fileExtension(dto.name);
    const safeCompany = q.vendor.companyName
      .replace(/[^a-zA-Z0-9._-]+/g, '_')
      .replace(/^_+|_+$/g, '');
    return this.vaultFiles.createManagedUploadUrl({
      folderName: 'Vendor NDA',
      name: `${safeCompany || 'Vendor'}_NDA${ext ? `.${ext}` : ''}`,
      mimeType: dto.mimeType,
      sizeBytes: dto.sizeBytes,
      uploadedById: q.vendor.createdById,
      changeNote: `Vendor NDA questionnaire:${q.id}`,
    });
  }

  async publicSignedNdaConfirm(token: string, dto: PublicNdaConfirmDto) {
    const invite = await this.getValidInvite(token, dto.password, new Date());
    const q = await this.assertEditableQuestionnaire(invite.questionnaireId);
    if (!requiresSignedNda(q.revisionNumber)) {
      throw new BadRequestException(
        'A signed NDA is required only for the first questionnaire revision',
      );
    }
    await this.vaultFiles.confirmManagedUpload(
      dto.fileId,
      `Vendor NDA questionnaire:${q.id}`,
    );
    await this.prisma.vendorQuestionnaire.update({
      where: { id: q.id },
      data: { signedNdaFileId: dto.fileId },
    });
    return { fileId: dto.fileId, uploaded: true };
  }

  // ── Audits ───────────────────────────────────────────────────────────
  /**
   * Create + finalize an audit against a questionnaire revision — Internal
   * Auditor / SUPER_ADMIN only. Sets Vendor.status to the computed
   * classification. (Create == finalize here; there's no separate draft state.)
   */
  async createAudit(
    vendorId: string,
    dto: CreateAuditDto,
    user: AuthenticatedUser,
  ): Promise<VendorAuditEntity> {
    await this.access.assertCanAudit(user);

    const questionnaire = await this.prisma.vendorQuestionnaire.findFirst({
      where: { id: dto.questionnaireId, vendorId },
      select: { id: true },
    });
    if (!questionnaire) {
      throw new NotFoundException(
        'Questionnaire revision not found for this vendor',
      );
    }

    const total = computeTotalScore(dto);
    const status = classificationToVendorStatus(classify(total));

    const audit = await this.prisma.$transaction(async (tx) => {
      const a = await tx.vendorAudit.create({
        data: {
          vendorId,
          questionnaireId: dto.questionnaireId,
          auditType: dto.auditType,
          auditDate: new Date(dto.auditDate),
          auditorId: user.id,
          coreCompetency: dto.coreCompetency,
          manufacturingCapabilityScore: dto.manufacturingCapabilityScore,
          capacityScore: dto.capacityScore,
          qualitySystemScore: dto.qualitySystemScore,
          engineeringScore: dto.engineeringScore,
          financialStabilityScore: dto.financialStabilityScore,
          supplyChainScore: dto.supplyChainScore,
          exportReadinessScore: dto.exportReadinessScore,
          sustainabilityScore: dto.sustainabilityScore,
          ehsScore: dto.ehsScore,
          customerReferencesScore: dto.customerReferencesScore,
          auditNotes: dto.auditNotes ?? null,
        },
        include: { auditor: { select: { firstName: true, lastName: true } } },
      });
      // A fresh audit's computed classification supersedes any prior override.
      await tx.vendor.update({
        where: { id: vendorId },
        data: {
          status,
          statusOverridden: false,
          coreCompetency: dto.coreCompetency,
        },
      });
      return a;
    });
    return this.toAudit(audit);
  }

  // ── Classification override (SUPER_ADMIN) ─────────────────────────────
  /**
   * SuperAdmin forces an audit's classification, independent of the computed
   * score. The computed classification is never deleted — only the override
   * fields are written. The effective classification (override ?? computed)
   * propagates to Vendor.status so downstream gates (e.g. Project Kickoff
   * vendor selection) see the approved state; `statusOverridden` flags it.
   */
  async overrideAuditClassification(
    vendorId: string,
    auditId: string,
    dto: OverrideClassificationDto,
    user: AuthenticatedUser,
  ): Promise<VendorAuditEntity> {
    this.access.assertIsSuperAdmin(user);
    const reason = dto.reason.trim();
    if (!reason) {
      throw new BadRequestException('An override reason is required');
    }

    await this.loadVendorAudit(vendorId, auditId);
    const isLatest = await this.isLatestAudit(vendorId, auditId);

    const updated = await this.prisma.$transaction(async (tx) => {
      const a = await tx.vendorAudit.update({
        where: { id: auditId },
        data: {
          overrideClassification: dto.overrideClassification,
          overrideReason: reason,
          overriddenById: user.id,
          overriddenAt: new Date(),
        },
        include: {
          auditor: { select: { firstName: true, lastName: true } },
          overriddenBy: { select: { firstName: true, lastName: true } },
        },
      });
      // Only the latest audit drives the master status (older audits are history).
      if (isLatest) {
        await tx.vendor.update({
          where: { id: vendorId },
          data: {
            status: dto.overrideClassification,
            statusOverridden: true,
          },
        });
      }
      return a;
    });
    return this.toAudit(updated);
  }

  /**
   * SuperAdmin clears an override, reverting the effective classification (and,
   * for the latest audit, Vendor.status) to the computed value from the score.
   */
  async clearAuditClassificationOverride(
    vendorId: string,
    auditId: string,
    user: AuthenticatedUser,
  ): Promise<VendorAuditEntity> {
    this.access.assertIsSuperAdmin(user);

    const audit = await this.loadVendorAudit(vendorId, auditId);
    const isLatest = await this.isLatestAudit(vendorId, auditId);

    // Computed classification the master status reverts to.
    const computed = classificationToVendorStatus(
      classify(computeTotalScore(this.auditScoreStrings(audit))),
    );

    const updated = await this.prisma.$transaction(async (tx) => {
      const a = await tx.vendorAudit.update({
        where: { id: auditId },
        data: {
          overrideClassification: null,
          overrideReason: null,
          overriddenById: null,
          overriddenAt: null,
        },
        include: {
          auditor: { select: { firstName: true, lastName: true } },
          overriddenBy: { select: { firstName: true, lastName: true } },
        },
      });
      if (isLatest) {
        await tx.vendor.update({
          where: { id: vendorId },
          data: { status: computed, statusOverridden: false },
        });
      }
      return a;
    });
    return this.toAudit(updated);
  }

  // ── internals ──────────────────────────────────────────────────────
  /** Load an audit scoped to its vendor (404 if either is wrong). */
  private async loadVendorAudit(vendorId: string, auditId: string) {
    const audit = await this.prisma.vendorAudit.findFirst({
      where: { id: auditId, vendorId },
    });
    if (!audit) throw new NotFoundException('Audit not found for this vendor');
    return audit;
  }

  /** The 10 category scores of a raw audit row as strings (for computeTotalScore). */
  private auditScoreStrings(a: {
    manufacturingCapabilityScore: Prisma.Decimal;
    capacityScore: Prisma.Decimal;
    qualitySystemScore: Prisma.Decimal;
    engineeringScore: Prisma.Decimal;
    financialStabilityScore: Prisma.Decimal;
    supplyChainScore: Prisma.Decimal;
    exportReadinessScore: Prisma.Decimal;
    sustainabilityScore: Prisma.Decimal;
    ehsScore: Prisma.Decimal;
    customerReferencesScore: Prisma.Decimal;
  }) {
    return {
      manufacturingCapabilityScore: a.manufacturingCapabilityScore.toString(),
      capacityScore: a.capacityScore.toString(),
      qualitySystemScore: a.qualitySystemScore.toString(),
      engineeringScore: a.engineeringScore.toString(),
      financialStabilityScore: a.financialStabilityScore.toString(),
      supplyChainScore: a.supplyChainScore.toString(),
      exportReadinessScore: a.exportReadinessScore.toString(),
      sustainabilityScore: a.sustainabilityScore.toString(),
      ehsScore: a.ehsScore.toString(),
      customerReferencesScore: a.customerReferencesScore.toString(),
    };
  }

  /** Whether this audit is the vendor's most recent (the one driving status). */
  private async isLatestAudit(
    vendorId: string,
    auditId: string,
  ): Promise<boolean> {
    const latest = await this.prisma.vendorAudit.findFirst({
      where: { vendorId },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    return latest?.id === auditId;
  }

  /** Vault-style token validation: unknown→404, revoked/expired/bad-pw→403. */
  private async getValidInvite(
    token: string,
    password: string | undefined,
    now: Date,
  ) {
    const invite = await this.prisma.vendorQuestionnaireInvite.findUnique({
      where: { token },
    });
    if (!invite) throw new NotFoundException('Invalid link');
    await assertInviteUsable(invite, password, now);
    return invite;
  }

  /** Load a questionnaire and reject edits once it's been submitted (locked). */
  private async assertEditableQuestionnaire(questionnaireId: string) {
    const q = await this.prisma.vendorQuestionnaire.findUniqueOrThrow({
      where: { id: questionnaireId },
    });
    if (q.status === VendorQuestionnaireStatus.SUBMITTED) {
      throw new ForbiddenException(
        'This questionnaire has already been submitted and is locked',
      );
    }
    return q;
  }

  // ── mappers ────────────────────────────────────────────────────────
  private toVendor(s: {
    id: string;
    companyName: string;
    registeredAddress: string | null;
    factoryAddress: string | null;
    yearEstablished: string | null;
    numberOfEmployees: string | null;
    annualTurnover: string | null;
    msmeUdyamCertificate: string | null;
    contactPersonName: string | null;
    contactPersonDesignation: string | null;
    contactEmail: string;
    contactPhone: string | null;
    website: string | null;
    coreCompetency: VendorEntity['coreCompetency'];
    status: VendorStatus;
    statusOverridden: boolean;
    createdById: string;
    createdAt: Date;
    updatedAt: Date;
  }): VendorEntity {
    return new VendorEntity({
      ...s,
      createdAt: s.createdAt.toISOString(),
      updatedAt: s.updatedAt.toISOString(),
    });
  }

  /** Prisma update data for the Company Information write-back — undefined fields are left untouched. */
  private companyInfoUpdateData(
    info: PublicCompanyInfoDto | undefined,
  ): Prisma.VendorUpdateInput {
    if (!info) return {};
    const data: Prisma.VendorUpdateInput = {};
    if (info.registeredAddress !== undefined)
      data.registeredAddress = info.registeredAddress;
    if (info.factoryAddress !== undefined)
      data.factoryAddress = info.factoryAddress;
    if (info.yearEstablished !== undefined)
      data.yearEstablished = info.yearEstablished;
    if (info.numberOfEmployees !== undefined)
      data.numberOfEmployees = info.numberOfEmployees;
    if (info.annualTurnover !== undefined)
      data.annualTurnover = info.annualTurnover;
    if (info.msmeUdyamCertificate !== undefined)
      data.msmeUdyamCertificate = info.msmeUdyamCertificate;
    if (info.contactPersonName !== undefined)
      data.contactPersonName = info.contactPersonName;
    if (info.contactPersonDesignation !== undefined)
      data.contactPersonDesignation = info.contactPersonDesignation;
    if (info.contactPhone !== undefined) data.contactPhone = info.contactPhone;
    if (info.website !== undefined) data.website = info.website;
    return data;
  }

  /** Narrows to exactly the fields the public form may see/edit — the callers pass full Prisma rows. */
  private toCompanyInfo(v: VendorCompanyInfo): VendorCompanyInfoEntity {
    return new VendorCompanyInfoEntity({
      companyName: v.companyName,
      contactEmail: v.contactEmail,
      registeredAddress: v.registeredAddress,
      factoryAddress: v.factoryAddress,
      yearEstablished: v.yearEstablished,
      numberOfEmployees: v.numberOfEmployees,
      annualTurnover: v.annualTurnover,
      msmeUdyamCertificate: v.msmeUdyamCertificate,
      contactPersonName: v.contactPersonName,
      contactPersonDesignation: v.contactPersonDesignation,
      contactPhone: v.contactPhone,
      website: v.website,
    });
  }

  private toQuestionnaire(
    q: {
      [k: string]: unknown;
      id: string;
      vendorId: string;
      revisionNumber: number;
      status: VendorQuestionnaireStatus;
      submittedAt: Date | null;
      qualityCertificateFiles: unknown;
      createdAt: Date;
      updatedAt: Date;
    },
    vendor: VendorCompanyInfo,
  ): VendorQuestionnaireEntity {
    const files = (q.qualityCertificateFiles as CertFile[] | null) ?? [];
    const sections: Record<string, unknown> = {};
    for (const key of SECTION_KEYS) sections[key] = q[key] ?? null;
    return new VendorQuestionnaireEntity({
      id: q.id,
      vendorId: q.vendorId,
      revisionNumber: q.revisionNumber,
      status: q.status,
      submittedAt: q.submittedAt ? q.submittedAt.toISOString() : null,
      companyInfo: this.toCompanyInfo(vendor),
      ...sections,
      qualityCertificateFiles: files.map(
        (f) => new VendorCertificateFileEntity(f),
      ),
      ndaRequired: requiresSignedNda(q.revisionNumber),
      signedNdaUploaded: !!q.signedNdaFileId,
      createdAt: q.createdAt.toISOString(),
      updatedAt: q.updatedAt.toISOString(),
    });
  }

  private toInvite(i: {
    id: string;
    questionnaireId: string;
    token: string;
    expiresAt: Date;
    revokedAt: Date | null;
    passwordHash: string | null;
    createdById: string;
    createdAt: Date;
  }): VendorInviteEntity {
    return new VendorInviteEntity({
      id: i.id,
      questionnaireId: i.questionnaireId,
      token: i.token,
      expiresAt: i.expiresAt.toISOString(),
      revokedAt: i.revokedAt ? i.revokedAt.toISOString() : null,
      hasPassword: !!i.passwordHash,
      createdById: i.createdById,
      createdAt: i.createdAt.toISOString(),
    });
  }

  private toAudit(a: {
    id: string;
    vendorId: string;
    questionnaireId: string;
    auditType: VendorAuditEntity['auditType'];
    auditDate: Date;
    auditorId: string;
    auditor?: { firstName: string; lastName: string } | null;
    coreCompetency: VendorAuditEntity['coreCompetency'];
    manufacturingCapabilityScore: Prisma.Decimal;
    capacityScore: Prisma.Decimal;
    qualitySystemScore: Prisma.Decimal;
    engineeringScore: Prisma.Decimal;
    financialStabilityScore: Prisma.Decimal;
    supplyChainScore: Prisma.Decimal;
    exportReadinessScore: Prisma.Decimal;
    sustainabilityScore: Prisma.Decimal;
    ehsScore: Prisma.Decimal;
    customerReferencesScore: Prisma.Decimal;
    auditNotes: string | null;
    overrideClassification?: VendorStatus | null;
    overrideReason?: string | null;
    overriddenById?: string | null;
    overriddenBy?: { firstName: string; lastName: string } | null;
    overriddenAt?: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }): VendorAuditEntity {
    const scores = {
      manufacturingCapabilityScore: a.manufacturingCapabilityScore.toString(),
      capacityScore: a.capacityScore.toString(),
      qualitySystemScore: a.qualitySystemScore.toString(),
      engineeringScore: a.engineeringScore.toString(),
      financialStabilityScore: a.financialStabilityScore.toString(),
      supplyChainScore: a.supplyChainScore.toString(),
      exportReadinessScore: a.exportReadinessScore.toString(),
      sustainabilityScore: a.sustainabilityScore.toString(),
      ehsScore: a.ehsScore.toString(),
      customerReferencesScore: a.customerReferencesScore.toString(),
    };
    const total = computeTotalScore(scores);
    // Computed classification is ALWAYS surfaced — never deleted or hidden.
    const classification = classify(total);
    const override = a.overrideClassification
      ? vendorStatusToClassification(a.overrideClassification)
      : null;
    const effective: VendorClassification = override ?? classification;
    return new VendorAuditEntity({
      id: a.id,
      vendorId: a.vendorId,
      questionnaireId: a.questionnaireId,
      auditType: a.auditType,
      auditDate: a.auditDate.toISOString(),
      auditorId: a.auditorId,
      auditorName: a.auditor
        ? `${a.auditor.firstName} ${a.auditor.lastName}`
        : null,
      coreCompetency: a.coreCompetency,
      ...scores,
      totalScore: total,
      classification,
      classificationLabel: CLASSIFICATION_LABEL[classification],
      overrideClassification: override,
      overrideClassificationLabel: override
        ? CLASSIFICATION_LABEL[override]
        : null,
      overrideReason: a.overrideReason ?? null,
      overriddenById: a.overriddenById ?? null,
      overriddenByName: a.overriddenBy
        ? `${a.overriddenBy.firstName} ${a.overriddenBy.lastName}`
        : null,
      overriddenAt: a.overriddenAt ? a.overriddenAt.toISOString() : null,
      effectiveClassification: effective,
      effectiveClassificationLabel: CLASSIFICATION_LABEL[effective],
      isOverridden: override != null,
      auditNotes: a.auditNotes,
      createdAt: a.createdAt.toISOString(),
      updatedAt: a.updatedAt.toISOString(),
    });
  }
}
