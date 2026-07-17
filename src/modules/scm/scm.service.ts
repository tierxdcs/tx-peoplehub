import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  VendorQuestionnaireStatus,
  VendorStatus,
} from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../core/database/prisma.service';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import {
  assertInviteUsable,
  computeExpiry,
  generateInviteToken,
  hashInvitePassword,
} from '../../common/utils/token-invite';
import { VaultStorageService } from '../vault/vault-storage.service';
import {
  assertExtensionAllowed,
  assertSizeWithinCap,
} from '../vault/vault-guardrails';
import { KanbanNotificationsService } from '../notifications/kanban-notifications.service';
import { ScmAccessService } from './scm-access.service';
import {
  classify,
  classificationToVendorStatus,
  CLASSIFICATION_LABEL,
  computeTotalScore,
} from './vendor-scoring';
import {
  CreateAuditDto,
  CreateInviteDto,
  CreateVendorDto,
  PublicCertConfirmDto,
  PublicCertUploadUrlDto,
  PublicQuestionnaireSaveDto,
} from './dto/scm.dto';
import {
  VendorAuditEntity,
  VendorCertificateFileEntity,
  VendorEntity,
  VendorInviteEntity,
  VendorQuestionnaireEntity,
} from './entities/scm.entity';

/** Default invite lifetime — 14 days, generous given the form's length (§5). */
const DEFAULT_INVITE_EXPIRY_HOURS = 14 * 24;

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
};

@Injectable()
export class ScmService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ScmAccessService,
    private readonly storage: VaultStorageService,
    private readonly notifications: KanbanNotificationsService,
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
          registeredAddress: dto.registeredAddress,
          factoryAddress: dto.factoryAddress,
          yearEstablished: dto.yearEstablished,
          numberOfEmployees: dto.numberOfEmployees,
          annualTurnover: dto.annualTurnover,
          msmeUdyamCertificate: dto.msmeUdyamCertificate ?? null,
          contactPersonName: dto.contactPersonName,
          contactPersonDesignation: dto.contactPersonDesignation,
          contactEmail: dto.contactEmail,
          contactPhone: dto.contactPhone,
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
          include: { auditor: { select: { firstName: true, lastName: true } } },
        },
      },
    });
    if (!s) throw new NotFoundException('Vendor not found');
    return {
      ...this.toVendor(s),
      questionnaires: s.questionnaires.map((q) => this.toQuestionnaire(q)),
      audits: s.audits.map((a) => this.toAudit(a)),
    };
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
    if (!latest) throw new NotFoundException('Vendor or questionnaire not found');

    const copyForward: Prisma.VendorQuestionnaireCreateInput = {
      vendor: { connect: { id: vendorId } },
      revisionNumber: latest.revisionNumber + 1,
      status: VendorQuestionnaireStatus.SENT,
    };
    for (const key of SECTION_KEYS) {
      const val = latest[key];
      if (val != null) {
        (copyForward as Record<string, unknown>)[key] = val as Prisma.InputJsonValue;
      }
    }
    if (latest.qualityCertificateFiles != null) {
      copyForward.qualityCertificateFiles =
        latest.qualityCertificateFiles as Prisma.InputJsonValue;
    }
    const created = await this.prisma.vendorQuestionnaire.create({
      data: copyForward,
    });
    // Back to pending-questionnaire state for the resubmission cycle.
    await this.prisma.vendor.update({
      where: { id: vendorId },
      data: { status: VendorStatus.PENDING_QUESTIONNAIRE },
    });
    return this.toQuestionnaire(created);
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
    });
    return this.toQuestionnaire(q);
  }

  /** Partial save (resume) of section data — must be a non-submitted revision. */
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
    const updated = await this.prisma.vendorQuestionnaire.update({
      where: { id: q.id },
      data,
    });
    return this.toQuestionnaire(updated);
  }

  /**
   * Final submit — locks the questionnaire (→ SUBMITTED), sets Vendor →
   * QUESTIONNAIRE_SUBMITTED, and notifies the vendor's creator. Accepts the
   * final section payload in the same shape as save.
   */
  async submitPublic(
    token: string,
    dto: PublicQuestionnaireSaveDto,
    now: Date = new Date(),
  ): Promise<VendorQuestionnaireEntity> {
    const invite = await this.getValidInvite(token, dto.password, now);
    const q = await this.assertEditableQuestionnaire(invite.questionnaireId);

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
        data: { status: VendorStatus.QUESTIONNAIRE_SUBMITTED },
        select: { createdById: true, companyName: true },
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
    return this.toQuestionnaire(updated.u);
  }

  // ── Public certificate upload (reuses Vault guardrails) ──────────────
  /** Presign a certificate PUT — same extension/size guardrails as Vault. */
  async publicCertUploadUrl(
    token: string,
    dto: PublicCertUploadUrlDto,
    now: Date = new Date(),
  ): Promise<{ storageKey: string; uploadUrl: string; expiresInSeconds: number }> {
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
      throw new BadRequestException('storageKey does not belong to this questionnaire');
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
      await tx.vendor.update({ where: { id: vendorId }, data: { status } });
      return a;
    });
    return this.toAudit(audit);
  }

  // ── internals ──────────────────────────────────────────────────────
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
    registeredAddress: string;
    factoryAddress: string;
    yearEstablished: string;
    numberOfEmployees: string;
    annualTurnover: string;
    msmeUdyamCertificate: string | null;
    contactPersonName: string;
    contactPersonDesignation: string;
    contactEmail: string;
    contactPhone: string;
    website: string | null;
    status: VendorStatus;
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

  private toQuestionnaire(q: {
    [k: string]: unknown;
    id: string;
    vendorId: string;
    revisionNumber: number;
    status: VendorQuestionnaireStatus;
    submittedAt: Date | null;
    qualityCertificateFiles: unknown;
    createdAt: Date;
    updatedAt: Date;
  }): VendorQuestionnaireEntity {
    const files = (q.qualityCertificateFiles as CertFile[] | null) ?? [];
    const sections: Record<string, unknown> = {};
    for (const key of SECTION_KEYS) sections[key] = q[key] ?? null;
    return new VendorQuestionnaireEntity({
      id: q.id,
      vendorId: q.vendorId,
      revisionNumber: q.revisionNumber,
      status: q.status,
      submittedAt: q.submittedAt ? q.submittedAt.toISOString() : null,
      ...sections,
      qualityCertificateFiles: files.map(
        (f) => new VendorCertificateFileEntity(f),
      ),
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
    const classification = classify(total);
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
      ...scores,
      totalScore: total,
      classification,
      classificationLabel: CLASSIFICATION_LABEL[classification],
      auditNotes: a.auditNotes,
      createdAt: a.createdAt.toISOString(),
      updatedAt: a.updatedAt.toISOString(),
    });
  }
}
