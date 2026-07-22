import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  SupplierFilledBy,
  SupplierQuestionnaireStatus,
  SupplierStatus,
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
import { SupplierAccessService } from './supplier-access.service';
import {
  classify,
  classificationToSupplierStatus,
  CLASSIFICATION_LABEL,
  computeTotalScore,
} from './supplier-scoring';
import {
  CreateAuditDto,
  CreateInviteDto,
  CreateSupplierDto,
  PublicCertConfirmDto,
  PublicCertUploadUrlDto,
  PublicCompanyInfoDto,
  PublicQuestionnaireSaveDto,
} from './dto/supplier.dto';
import {
  SupplierAuditEntity,
  SupplierCertificateFileEntity,
  SupplierCompanyInfoEntity,
  SupplierEntity,
  SupplierInviteEntity,
  SupplierQuestionnaireEntity,
} from './entities/supplier.entity';

/** The Supplier master fields the public form's Company Information section can write. */
type SupplierCompanyInfo = {
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

const DEFAULT_INVITE_EXPIRY_HOURS = 14 * 24;

/** The 9 questionnaire section keys (copy-forward on revision, save/submit). */
const SECTION_KEYS = [
  'materialRange',
  'materialCertifications',
  'compliance',
  'qualityCertifications',
  'commercialTerms',
  'packagingAndDelivery',
  'logistics',
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
export class SupplierService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: SupplierAccessService,
    private readonly storage: VaultStorageService,
    private readonly notifications: KanbanNotificationsService,
  ) {}

  // ── Suppliers ────────────────────────────────────────────────────────
  async createSupplier(
    dto: CreateSupplierDto,
    user: AuthenticatedUser,
  ): Promise<SupplierEntity> {
    await this.access.assertCanManageSuppliers(user);
    const supplier = await this.prisma.$transaction(async (tx) => {
      const created = await tx.supplier.create({
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
      await tx.supplierQuestionnaire.create({
        data: { supplierId: created.id, revisionNumber: 1 },
      });
      return created;
    });
    return this.toSupplier(supplier);
  }

  /** Company-wide read. */
  async listSuppliers(): Promise<SupplierEntity[]> {
    const rows = await this.prisma.supplier.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((s) => this.toSupplier(s));
  }

  async getSupplier(id: string): Promise<
    SupplierEntity & {
      questionnaires: SupplierQuestionnaireEntity[];
      audits: SupplierAuditEntity[];
    }
  > {
    const s = await this.prisma.supplier.findUnique({
      where: { id },
      include: {
        questionnaires: { orderBy: { revisionNumber: 'desc' } },
        audits: {
          orderBy: { createdAt: 'desc' },
          include: { auditor: { select: { firstName: true, lastName: true } } },
        },
      },
    });
    if (!s) throw new NotFoundException('Supplier not found');
    return {
      ...this.toSupplier(s),
      questionnaires: s.questionnaires.map((q) => this.toQuestionnaire(q, s)),
      audits: s.audits.map((a) => this.toAudit(a)),
    };
  }

  // ── Questionnaire revisions ──────────────────────────────────────────
  async createQuestionnaireRevision(
    supplierId: string,
    user: AuthenticatedUser,
  ): Promise<SupplierQuestionnaireEntity> {
    await this.access.assertCanManageSuppliers(user);
    const latest = await this.prisma.supplierQuestionnaire.findFirst({
      where: { supplierId },
      orderBy: { revisionNumber: 'desc' },
    });
    if (!latest) throw new NotFoundException('Supplier or questionnaire not found');

    const copyForward: Prisma.SupplierQuestionnaireCreateInput = {
      supplier: { connect: { id: supplierId } },
      revisionNumber: latest.revisionNumber + 1,
      status: SupplierQuestionnaireStatus.SENT,
    };
    for (const key of SECTION_KEYS) {
      const val = latest[key];
      if (val != null) {
        (copyForward as Record<string, unknown>)[key] = val as Prisma.InputJsonValue;
      }
    }
    if (latest.certificateFiles != null) {
      copyForward.certificateFiles = latest.certificateFiles as Prisma.InputJsonValue;
    }
    const created = await this.prisma.supplierQuestionnaire.create({ data: copyForward });
    const supplier = await this.prisma.supplier.update({
      where: { id: supplierId },
      data: { status: SupplierStatus.PENDING_QUESTIONNAIRE },
    });
    return this.toQuestionnaire(created, supplier);
  }

  // ── Invites (shared token mechanism) ──────────────────────────────────
  async createInvite(
    questionnaireId: string,
    dto: CreateInviteDto,
    user: AuthenticatedUser,
  ): Promise<SupplierInviteEntity> {
    await this.access.assertCanManageSuppliers(user);
    const q = await this.prisma.supplierQuestionnaire.findUnique({
      where: { id: questionnaireId },
      select: { id: true },
    });
    if (!q) throw new NotFoundException('Questionnaire not found');

    const invite = await this.prisma.supplierQuestionnaireInvite.create({
      data: {
        questionnaireId,
        token: generateInviteToken(),
        expiresAt: computeExpiry(dto.expiresInHours ?? DEFAULT_INVITE_EXPIRY_HOURS),
        passwordHash: await hashInvitePassword(dto.password),
        createdById: user.id,
      },
    });
    return this.toInvite(invite);
  }

  async revokeInvite(inviteId: string, user: AuthenticatedUser): Promise<void> {
    await this.access.assertCanManageSuppliers(user);
    const invite = await this.prisma.supplierQuestionnaireInvite.findUnique({
      where: { id: inviteId },
      select: { id: true, revokedAt: true },
    });
    if (!invite) throw new NotFoundException('Invite not found');
    if (invite.revokedAt) return;
    await this.prisma.supplierQuestionnaireInvite.update({
      where: { id: inviteId },
      data: { revokedAt: new Date() },
    });
  }

  // ── Public (token) resolution + save/submit ──────────────────────────
  async resolvePublic(
    token: string,
    password: string | undefined,
    now: Date = new Date(),
  ): Promise<SupplierQuestionnaireEntity> {
    const invite = await this.getValidInvite(token, password, now);
    const q = await this.prisma.supplierQuestionnaire.findUniqueOrThrow({
      where: { id: invite.questionnaireId },
      include: { supplier: true },
    });
    return this.toQuestionnaire(q, q.supplier);
  }

  /**
   * Partial save (resume) of section data — must be a non-submitted revision.
   * `companyInfo`, if present, writes back to the Supplier master record
   * itself (not the questionnaire) — this is how a supplier completes/
   * corrects the fields staff left blank at creation (see PublicCompanyInfoDto).
   */
  async savePublic(
    token: string,
    dto: PublicQuestionnaireSaveDto,
    now: Date = new Date(),
  ): Promise<SupplierQuestionnaireEntity> {
    const invite = await this.getValidInvite(token, dto.password, now);
    const q = await this.assertEditableQuestionnaire(invite.questionnaireId);
    const data: Prisma.SupplierQuestionnaireUpdateInput = {};
    for (const key of SECTION_KEYS) {
      const val = (dto as Record<string, unknown>)[key];
      if (val !== undefined) {
        (data as Record<string, unknown>)[key] = val as Prisma.InputJsonValue;
      }
    }
    const [updated, supplier] = await this.prisma.$transaction([
      this.prisma.supplierQuestionnaire.update({ where: { id: q.id }, data }),
      this.prisma.supplier.update({
        where: { id: q.supplierId },
        data: this.companyInfoUpdateData(dto.companyInfo),
      }),
    ]);
    return this.toQuestionnaire(updated, supplier);
  }

  async submitPublic(
    token: string,
    dto: PublicQuestionnaireSaveDto,
    now: Date = new Date(),
  ): Promise<SupplierQuestionnaireEntity> {
    const invite = await this.getValidInvite(token, dto.password, now);
    const q = await this.assertEditableQuestionnaire(invite.questionnaireId);

    return this.finalizeSubmission(
      q.id,
      dto as Record<string, unknown>,
      dto.companyInfo,
      SupplierFilledBy.EXTERNAL_SUPPLIER,
      null,
      now,
    );
  }

  // ── Public certificate upload (reuses Vault guardrails) ──────────────
  async publicCertUploadUrl(
    token: string,
    dto: PublicCertUploadUrlDto,
    now: Date = new Date(),
  ): Promise<{ storageKey: string; uploadUrl: string; expiresInSeconds: number }> {
    const invite = await this.getValidInvite(token, dto.password, now);
    const q = await this.assertEditableQuestionnaire(invite.questionnaireId);
    return this.createCertUploadUrl(q.id, dto);
  }

  async publicCertConfirm(
    token: string,
    dto: PublicCertConfirmDto,
    now: Date = new Date(),
  ): Promise<SupplierCertificateFileEntity> {
    const invite = await this.getValidInvite(token, dto.password, now);
    const q = await this.assertEditableQuestionnaire(invite.questionnaireId);
    return this.confirmCert(q.id, dto);
  }

  // ── Internal fill (authenticated SCM staff) ──────────────────────────
  // Second path to SUBMITTED: SCM staff fill the same questionnaire in-app
  // (e.g. transcribing a supplier's call/email answers). Every field is
  // optional here — there is no required-section expectation, unlike the
  // external flow. Access is the same as managing an invite.
  async saveInternal(
    questionnaireId: string,
    dto: PublicQuestionnaireSaveDto,
    user: AuthenticatedUser,
  ): Promise<SupplierQuestionnaireEntity> {
    await this.access.assertCanManageSuppliers(user);
    const q = await this.assertEditableQuestionnaire(questionnaireId);
    const data: Prisma.SupplierQuestionnaireUpdateInput = {};
    for (const key of SECTION_KEYS) {
      const val = (dto as Record<string, unknown>)[key];
      if (val !== undefined) {
        (data as Record<string, unknown>)[key] = val as Prisma.InputJsonValue;
      }
    }
    const [updated, supplier] = await this.prisma.$transaction([
      this.prisma.supplierQuestionnaire.update({ where: { id: q.id }, data }),
      this.prisma.supplier.update({
        where: { id: q.supplierId },
        data: this.companyInfoUpdateData(dto.companyInfo),
      }),
    ]);
    return this.toQuestionnaire(updated, supplier);
  }

  async submitInternal(
    questionnaireId: string,
    dto: PublicQuestionnaireSaveDto,
    user: AuthenticatedUser,
    now: Date = new Date(),
  ): Promise<SupplierQuestionnaireEntity> {
    await this.access.assertCanManageSuppliers(user);
    const q = await this.assertEditableQuestionnaire(questionnaireId);
    return this.finalizeSubmission(
      q.id,
      dto as Record<string, unknown>,
      dto.companyInfo,
      SupplierFilledBy.INTERNAL_STAFF,
      user.id,
      now,
    );
  }

  async internalCertUploadUrl(
    questionnaireId: string,
    dto: PublicCertUploadUrlDto,
    user: AuthenticatedUser,
  ): Promise<{ storageKey: string; uploadUrl: string; expiresInSeconds: number }> {
    await this.access.assertCanManageSuppliers(user);
    const q = await this.assertEditableQuestionnaire(questionnaireId);
    return this.createCertUploadUrl(q.id, dto);
  }

  async internalCertConfirm(
    questionnaireId: string,
    dto: PublicCertConfirmDto,
    user: AuthenticatedUser,
  ): Promise<SupplierCertificateFileEntity> {
    await this.access.assertCanManageSuppliers(user);
    const q = await this.assertEditableQuestionnaire(questionnaireId);
    return this.confirmCert(q.id, dto);
  }

  // ── Audits ───────────────────────────────────────────────────────────
  async createAudit(
    supplierId: string,
    dto: CreateAuditDto,
    user: AuthenticatedUser,
  ): Promise<SupplierAuditEntity> {
    await this.access.assertCanAudit(user);
    const questionnaire = await this.prisma.supplierQuestionnaire.findFirst({
      where: { id: dto.questionnaireId, supplierId },
      select: { id: true },
    });
    if (!questionnaire) {
      throw new NotFoundException('Questionnaire revision not found for this supplier');
    }

    const total = computeTotalScore(dto);
    const status = classificationToSupplierStatus(classify(total));

    const audit = await this.prisma.$transaction(async (tx) => {
      const a = await tx.supplierAudit.create({
        data: {
          supplierId,
          questionnaireId: dto.questionnaireId,
          auditType: dto.auditType,
          auditDate: new Date(dto.auditDate),
          auditorId: user.id,
          materialCertificationsQualityScore: dto.materialCertificationsQualityScore,
          complianceScore: dto.complianceScore,
          commercialTermsScore: dto.commercialTermsScore,
          logisticsDeliveryScore: dto.logisticsDeliveryScore,
          financialStabilityScore: dto.financialStabilityScore,
          referencesScore: dto.referencesScore,
          auditNotes: dto.auditNotes ?? null,
        },
        include: { auditor: { select: { firstName: true, lastName: true } } },
      });
      await tx.supplier.update({ where: { id: supplierId }, data: { status } });
      return a;
    });
    return this.toAudit(audit);
  }

  // ── internals ──────────────────────────────────────────────────────
  private async getValidInvite(
    token: string,
    password: string | undefined,
    now: Date,
  ) {
    const invite = await this.prisma.supplierQuestionnaireInvite.findUnique({
      where: { token },
    });
    if (!invite) throw new NotFoundException('Invalid link');
    await assertInviteUsable(invite, password, now);
    return invite;
  }

  private async assertEditableQuestionnaire(questionnaireId: string) {
    const q = await this.prisma.supplierQuestionnaire.findUniqueOrThrow({
      where: { id: questionnaireId },
    });
    if (q.status === SupplierQuestionnaireStatus.SUBMITTED) {
      throw new ForbiddenException(
        'This questionnaire has already been submitted and is locked',
      );
    }
    return q;
  }

  /**
   * Shared submit path for BOTH the external (token) and internal (staff)
   * flows: writes section data, flips to SUBMITTED with the given `filledBy`,
   * moves the supplier to QUESTIONNAIRE_SUBMITTED, and notifies the supplier's
   * creator. Everything downstream (audit/scoring/classification) is identical
   * regardless of `filledBy` — this is the single convergence point.
   */
  private async finalizeSubmission(
    questionnaireId: string,
    sections: Record<string, unknown>,
    companyInfo: PublicCompanyInfoDto | undefined,
    filledBy: SupplierFilledBy,
    actorId: string | null,
    now: Date,
  ): Promise<SupplierQuestionnaireEntity> {
    const data: Prisma.SupplierQuestionnaireUpdateInput = {
      status: SupplierQuestionnaireStatus.SUBMITTED,
      submittedAt: now,
      filledBy,
    };
    for (const key of SECTION_KEYS) {
      const val = sections[key];
      if (val !== undefined) {
        (data as Record<string, unknown>)[key] = val as Prisma.InputJsonValue;
      }
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.supplierQuestionnaire.update({
        where: { id: questionnaireId },
        data,
      });
      const supplier = await tx.supplier.update({
        where: { id: u.supplierId },
        data: {
          status: SupplierStatus.QUESTIONNAIRE_SUBMITTED,
          ...this.companyInfoUpdateData(companyInfo),
        },
      });
      return { u, supplier };
    });

    await this.notifications.notifySupplierQuestionnaireSubmitted({
      recipientId: updated.supplier.createdById,
      actorId,
      supplierId: updated.u.supplierId,
      supplierName: updated.supplier.companyName,
    });
    return this.toQuestionnaire(updated.u, updated.supplier);
  }

  /** Presign a certificate upload for a questionnaire (Vault guardrails). */
  private async createCertUploadUrl(
    questionnaireId: string,
    dto: PublicCertUploadUrlDto,
  ): Promise<{ storageKey: string; uploadUrl: string; expiresInSeconds: number }> {
    assertExtensionAllowed(dto.name);
    assertSizeWithinCap(dto.sizeBytes);

    const rand = randomBytes(8).toString('hex');
    const storageKey = `supplier-questionnaires/${questionnaireId}/certs/${rand}`;
    const { url, expiresInSeconds } = await this.storage.createUploadUrl(
      storageKey,
      dto.mimeType,
    );
    return { storageKey, uploadUrl: url, expiresInSeconds };
  }

  /** Confirm a completed certificate upload, re-checking the ACTUAL size. */
  private async confirmCert(
    questionnaireId: string,
    dto: PublicCertConfirmDto,
  ): Promise<SupplierCertificateFileEntity> {
    if (!dto.storageKey.startsWith(`supplier-questionnaires/${questionnaireId}/certs/`)) {
      throw new BadRequestException('storageKey does not belong to this questionnaire');
    }
    const head = await this.storage.headObject(dto.storageKey);
    if (!head) throw new BadRequestException('Uploaded object not found');
    assertSizeWithinCap(head.sizeBytes); // guard on ACTUAL size

    const file: CertFile = {
      storageKey: dto.storageKey,
      name: dto.name,
      sizeBytes: head.sizeBytes,
      contentType: head.contentType,
    };
    const existing =
      (
        await this.prisma.supplierQuestionnaire.findUniqueOrThrow({
          where: { id: questionnaireId },
          select: { certificateFiles: true },
        })
      ).certificateFiles as CertFile[] | null;
    await this.prisma.supplierQuestionnaire.update({
      where: { id: questionnaireId },
      data: {
        certificateFiles: [...(existing ?? []), file] as unknown as Prisma.InputJsonValue,
      },
    });
    return new SupplierCertificateFileEntity(file);
  }

  // ── mappers ────────────────────────────────────────────────────────
  private toSupplier(s: {
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
    status: SupplierStatus;
    createdById: string;
    createdAt: Date;
    updatedAt: Date;
  }): SupplierEntity {
    return new SupplierEntity({
      ...s,
      createdAt: s.createdAt.toISOString(),
      updatedAt: s.updatedAt.toISOString(),
    });
  }

  /** Prisma update data for the Company Information write-back — undefined fields are left untouched. */
  private companyInfoUpdateData(
    info: PublicCompanyInfoDto | undefined,
  ): Prisma.SupplierUpdateInput {
    if (!info) return {};
    const data: Prisma.SupplierUpdateInput = {};
    if (info.registeredAddress !== undefined) data.registeredAddress = info.registeredAddress;
    if (info.factoryAddress !== undefined) data.factoryAddress = info.factoryAddress;
    if (info.yearEstablished !== undefined) data.yearEstablished = info.yearEstablished;
    if (info.numberOfEmployees !== undefined) data.numberOfEmployees = info.numberOfEmployees;
    if (info.annualTurnover !== undefined) data.annualTurnover = info.annualTurnover;
    if (info.msmeUdyamCertificate !== undefined) data.msmeUdyamCertificate = info.msmeUdyamCertificate;
    if (info.contactPersonName !== undefined) data.contactPersonName = info.contactPersonName;
    if (info.contactPersonDesignation !== undefined) data.contactPersonDesignation = info.contactPersonDesignation;
    if (info.contactPhone !== undefined) data.contactPhone = info.contactPhone;
    if (info.website !== undefined) data.website = info.website;
    return data;
  }

  /** Narrows to exactly the fields the public form may see/edit — the callers pass full Prisma rows. */
  private toCompanyInfo(s: SupplierCompanyInfo): SupplierCompanyInfoEntity {
    return new SupplierCompanyInfoEntity({
      companyName: s.companyName,
      contactEmail: s.contactEmail,
      registeredAddress: s.registeredAddress,
      factoryAddress: s.factoryAddress,
      yearEstablished: s.yearEstablished,
      numberOfEmployees: s.numberOfEmployees,
      annualTurnover: s.annualTurnover,
      msmeUdyamCertificate: s.msmeUdyamCertificate,
      contactPersonName: s.contactPersonName,
      contactPersonDesignation: s.contactPersonDesignation,
      contactPhone: s.contactPhone,
      website: s.website,
    });
  }

  private toQuestionnaire(
    q: {
      [k: string]: unknown;
      id: string;
      supplierId: string;
      revisionNumber: number;
      status: SupplierQuestionnaireStatus;
      submittedAt: Date | null;
      filledBy: SupplierFilledBy | null;
      certificateFiles: unknown;
      createdAt: Date;
      updatedAt: Date;
    },
    supplier: SupplierCompanyInfo,
  ): SupplierQuestionnaireEntity {
    const files = (q.certificateFiles as CertFile[] | null) ?? [];
    const sections: Record<string, unknown> = {};
    for (const key of SECTION_KEYS) sections[key] = q[key] ?? null;
    return new SupplierQuestionnaireEntity({
      id: q.id,
      supplierId: q.supplierId,
      revisionNumber: q.revisionNumber,
      status: q.status,
      submittedAt: q.submittedAt ? q.submittedAt.toISOString() : null,
      companyInfo: this.toCompanyInfo(supplier),
      filledBy: q.filledBy,
      ...sections,
      certificateFiles: files.map((f) => new SupplierCertificateFileEntity(f)),
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
  }): SupplierInviteEntity {
    return new SupplierInviteEntity({
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
    supplierId: string;
    questionnaireId: string;
    auditType: SupplierAuditEntity['auditType'];
    auditDate: Date;
    auditorId: string;
    auditor?: { firstName: string; lastName: string } | null;
    materialCertificationsQualityScore: Prisma.Decimal;
    complianceScore: Prisma.Decimal;
    commercialTermsScore: Prisma.Decimal;
    logisticsDeliveryScore: Prisma.Decimal;
    financialStabilityScore: Prisma.Decimal;
    referencesScore: Prisma.Decimal;
    auditNotes: string | null;
    createdAt: Date;
    updatedAt: Date;
  }): SupplierAuditEntity {
    const scores = {
      materialCertificationsQualityScore: a.materialCertificationsQualityScore.toString(),
      complianceScore: a.complianceScore.toString(),
      commercialTermsScore: a.commercialTermsScore.toString(),
      logisticsDeliveryScore: a.logisticsDeliveryScore.toString(),
      financialStabilityScore: a.financialStabilityScore.toString(),
      referencesScore: a.referencesScore.toString(),
    };
    const total = computeTotalScore(scores);
    const classification = classify(total);
    return new SupplierAuditEntity({
      id: a.id,
      supplierId: a.supplierId,
      questionnaireId: a.questionnaireId,
      auditType: a.auditType,
      auditDate: a.auditDate.toISOString(),
      auditorId: a.auditorId,
      auditorName: a.auditor ? `${a.auditor.firstName} ${a.auditor.lastName}` : null,
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
