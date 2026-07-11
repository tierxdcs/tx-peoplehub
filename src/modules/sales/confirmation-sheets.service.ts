import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  OrderConfirmationSheet,
  OrderConfirmationStatus,
  OrderStatus,
  Prisma,
  Role,
} from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { VaultStorageService } from '../vault/vault-storage.service';
import { SalesAccessService, isSuperAdmin } from './common/sales-access.service';
import { SalesNumberingService } from './common/sales-numbering.service';
import {
  ConfirmSignedCopyDto,
  CreateConfirmationSheetDto,
  RejectConfirmationSheetDto,
  UpdateConfirmationSheetDto,
} from './dto/create-confirmation-sheet.dto';
import { ConfirmationSheetEntity } from './entities/confirmation-sheet.entity';

/** Pre-EXECUTED states a revision can be requested from (§1.6). */
const REVISABLE: OrderConfirmationStatus[] = [
  OrderConfirmationStatus.AWAITING_CUSTOMER_SIGNATURE,
  OrderConfirmationStatus.AWAITING_INTERNAL_SIGNATURE,
  OrderConfirmationStatus.REJECTED,
];

/**
 * The single where-clause for "awaiting the Sales Head's countersignature",
 * shared by the pending list and its count so the two can never drift.
 */
const PENDING_INTERNAL_SIGNATURE_WHERE: Prisma.OrderConfirmationSheetWhereInput =
  { status: OrderConfirmationStatus.AWAITING_INTERNAL_SIGNATURE };

@Injectable()
export class ConfirmationSheetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: SalesAccessService,
    private readonly numbering: SalesNumberingService,
    private readonly storage: VaultStorageService,
  ) {}

  /** R2 key for a sheet's single signed-copy attachment. */
  private storageKeyFor(sheetId: string): string {
    return `order-confirmations/${sheetId}/signed-copy`;
  }

  /**
   * Create the first DRAFT sheet for a CONFIRMED order. Pre-fills
   * requirementsOverview from the linked Bid's technicalSpecification when the
   * caller omits it. Write-scoped to the order's owner/team.
   */
  async create(
    orderId: string,
    dto: CreateConfirmationSheetDto,
    user: AuthenticatedUser,
  ): Promise<ConfirmationSheetEntity> {
    await this.access.assertSalesAccess(user);
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { bid: true },
    });
    if (!order) {
      throw new NotFoundException('Order not found');
    }
    await this.access.assertCanAccessOwned(user, order.ownerId);
    if (order.status !== OrderStatus.CONFIRMED) {
      throw new BadRequestException(
        'A confirmation sheet can only be started for a CONFIRMED order',
      );
    }

    // Only one sheet may be in-flight at a time. A DRAFT / AWAITING_* sheet is
    // still being worked; use it (or Request Revision) rather than spawning a
    // parallel one. REJECTED/EXECUTED are terminal, so a fresh sheet is fine.
    const inFlight = await this.prisma.orderConfirmationSheet.findFirst({
      where: {
        orderId,
        status: {
          in: [
            OrderConfirmationStatus.DRAFT,
            OrderConfirmationStatus.AWAITING_CUSTOMER_SIGNATURE,
            OrderConfirmationStatus.AWAITING_INTERNAL_SIGNATURE,
          ],
        },
      },
    });
    if (inFlight) {
      throw new BadRequestException(
        'This order already has a confirmation sheet in progress — edit it or request a revision instead of creating another',
      );
    }

    const overview =
      dto.requirementsOverview ?? order.bid?.technicalSpecification ?? '';

    const sheet = await this.prisma.$transaction(async (tx) => {
      const confirmationNumber = await this.numbering.nextNumber(
        'OC',
        'order_confirmation',
        new Date().getUTCFullYear(),
        tx,
      );
      return tx.orderConfirmationSheet.create({
        data: {
          confirmationNumber,
          orderId,
          revisionNumber: 1,
          status: OrderConfirmationStatus.DRAFT,
          createdById: user.id,
          // A DRAFT may be created incomplete — NOT NULL text columns default
          // to '' and are enforced non-empty later at generate-pdf.
          ...this.createData({ ...dto, requirementsOverview: overview }),
        },
      });
    });
    return this.toEntity(sheet);
  }

  /** Edit a sheet — only while DRAFT. */
  async update(
    id: string,
    dto: UpdateConfirmationSheetDto,
    user: AuthenticatedUser,
  ): Promise<ConfirmationSheetEntity> {
    const { sheet } = await this.loadForWrite(id, user);
    if (sheet.status !== OrderConfirmationStatus.DRAFT) {
      throw new BadRequestException(
        'Only a DRAFT sheet can be edited. Request a revision to change a locked one.',
      );
    }
    const updated = await this.prisma.orderConfirmationSheet.update({
      where: { id },
      data: this.editableData(dto),
    });
    return this.toEntity(updated);
  }

  /**
   * Lock the sheet and move it to AWAITING_CUSTOMER_SIGNATURE. Enforces the
   * full required-field set here (including the structured packaging block,
   * §2.1) — a DRAFT may be saved incomplete, but the version that gets sent
   * out must be complete. The PDF itself is rendered client-side (browser
   * print of the shared letterhead layout); this endpoint just stamps
   * pdfGeneratedAt and locks editing so what's sent can't later diverge.
   */
  async generatePdf(
    id: string,
    user: AuthenticatedUser,
  ): Promise<ConfirmationSheetEntity> {
    const { sheet } = await this.loadForWrite(id, user);
    if (sheet.status !== OrderConfirmationStatus.DRAFT) {
      throw new BadRequestException(
        'Only a DRAFT sheet can be generated and locked',
      );
    }
    this.assertComplete(sheet);
    const updated = await this.prisma.orderConfirmationSheet.update({
      where: { id },
      data: {
        status: OrderConfirmationStatus.AWAITING_CUSTOMER_SIGNATURE,
        pdfGeneratedAt: new Date(),
      },
    });
    return this.toEntity(updated);
  }

  /**
   * Presign a PUT for the single signed-copy attachment. Only valid once the
   * PDF is generated (AWAITING_CUSTOMER_SIGNATURE) — you can't upload a signed
   * copy of a document that hasn't been sent. Reuses the Vault R2 client
   * directly with a sheet-scoped key (no Vault folder/permission model).
   */
  async createSignedCopyUploadUrl(
    id: string,
    contentType: string,
    user: AuthenticatedUser,
  ): Promise<{ storageKey: string; uploadUrl: string; expiresInSeconds: number }> {
    const { sheet } = await this.loadForWrite(id, user);
    if (sheet.status !== OrderConfirmationStatus.AWAITING_CUSTOMER_SIGNATURE) {
      throw new BadRequestException(
        'A signed copy can only be uploaded after the PDF is generated and before internal signing',
      );
    }
    const storageKey = this.storageKeyFor(sheet.id);
    const { url, expiresInSeconds } = await this.storage.createUploadUrl(
      storageKey,
      contentType || 'application/pdf',
    );
    return { storageKey, uploadUrl: url, expiresInSeconds };
  }

  /**
   * Confirm the signed-copy upload landed in R2, record it, and move to
   * AWAITING_INTERNAL_SIGNATURE. Verifies the object actually exists (same
   * head-check discipline as Vault) so a claimed-but-absent upload can't
   * advance the workflow.
   */
  async confirmSignedCopy(
    id: string,
    dto: ConfirmSignedCopyDto,
    user: AuthenticatedUser,
  ): Promise<ConfirmationSheetEntity> {
    const { sheet } = await this.loadForWrite(id, user);
    if (sheet.status !== OrderConfirmationStatus.AWAITING_CUSTOMER_SIGNATURE) {
      throw new BadRequestException(
        'This sheet is not awaiting a signed copy',
      );
    }
    const expectedKey = this.storageKeyFor(sheet.id);
    if (dto.storageKey !== expectedKey) {
      throw new BadRequestException('Unexpected storage key for this sheet');
    }
    const head = await this.storage.headObject(expectedKey);
    if (!head) {
      throw new BadRequestException(
        'No uploaded object found — the upload may not have completed',
      );
    }
    const updated = await this.prisma.orderConfirmationSheet.update({
      where: { id },
      data: {
        status: OrderConfirmationStatus.AWAITING_INTERNAL_SIGNATURE,
        signedCopyStorageKey: expectedKey,
        signedCopyUploadedById: user.id,
        signedCopyUploadedAt: new Date(),
      },
    });
    return this.toEntity(updated);
  }

  /**
   * Sales Head (or SUPER_ADMIN) countersigns → EXECUTED. This is the state
   * that unblocks the order's move to production. Requires a signed copy to
   * actually be on file.
   */
  async sign(
    id: string,
    user: AuthenticatedUser,
  ): Promise<ConfirmationSheetEntity> {
    await this.assertCanReview(user);
    const sheet = await this.findRawOrThrow(id);
    if (sheet.status !== OrderConfirmationStatus.AWAITING_INTERNAL_SIGNATURE) {
      throw new BadRequestException(
        'Only a sheet awaiting internal signature can be countersigned',
      );
    }
    // Snapshot the Sales Head's name + e-signature at countersignature time —
    // this is what renders onto the printed sheet's internal-signature line.
    // Name is snapshotted too so the executed doc shows who signed even when
    // they had no typed signature configured. Null-safe.
    const emp = await this.prisma.employee.findUnique({
      where: { id: user.id },
      select: {
        firstName: true,
        lastName: true,
        signatureText: true,
        signatureFont: true,
      },
    });
    const signerName = emp
      ? `${emp.firstName} ${emp.lastName}`.trim()
      : null;
    const updated = await this.prisma.orderConfirmationSheet.update({
      where: { id },
      data: {
        status: OrderConfirmationStatus.EXECUTED,
        internalSignedById: user.id,
        internalSignedAt: new Date(),
        internalReviewComments: null,
        internalSignedByName: signerName,
        approverSignatureTextSnapshot: emp?.signatureText ?? null,
        approverSignatureFontSnapshot: emp?.signatureFont ?? null,
      },
    });
    return this.toEntity(updated);
  }

  /** Sales Head/SUPER_ADMIN rejects with mandatory comments → REJECTED. */
  async reject(
    id: string,
    dto: RejectConfirmationSheetDto,
    user: AuthenticatedUser,
  ): Promise<ConfirmationSheetEntity> {
    await this.assertCanReview(user);
    const sheet = await this.findRawOrThrow(id);
    if (sheet.status !== OrderConfirmationStatus.AWAITING_INTERNAL_SIGNATURE) {
      throw new BadRequestException(
        'Only a sheet awaiting internal signature can be rejected',
      );
    }
    const updated = await this.prisma.orderConfirmationSheet.update({
      where: { id },
      data: {
        status: OrderConfirmationStatus.REJECTED,
        internalSignedById: user.id,
        internalSignedAt: new Date(),
        internalReviewComments: dto.comments,
      },
    });
    return this.toEntity(updated);
  }

  /**
   * Create a new DRAFT revision (revisionNumber+1) pre-filled from an existing
   * pre-EXECUTED sheet, leaving the source untouched (history preserved). No
   * approval is needed to create a revision — the customer-signs → Sales Head
   * countersigns gate still applies before the new revision can reach EXECUTED
   * (§1.6). Any writer on the order may trigger this.
   */
  async requestRevision(
    id: string,
    user: AuthenticatedUser,
  ): Promise<ConfirmationSheetEntity> {
    const { sheet } = await this.loadForWrite(id, user);
    if (!REVISABLE.includes(sheet.status)) {
      throw new BadRequestException(
        sheet.status === OrderConfirmationStatus.DRAFT
          ? 'This sheet is still a DRAFT — edit it directly instead of revising'
          : 'An EXECUTED sheet cannot be revised',
      );
    }
    const revision = await this.prisma.$transaction(async (tx) => {
      const confirmationNumber = await this.numbering.nextNumber(
        'OC',
        'order_confirmation',
        new Date().getUTCFullYear(),
        tx,
      );
      return tx.orderConfirmationSheet.create({
        data: {
          confirmationNumber,
          orderId: sheet.orderId,
          revisionNumber: sheet.revisionNumber + 1,
          status: OrderConfirmationStatus.DRAFT,
          createdById: user.id,
          // Copy every editable field forward; signature/PDF/review fields
          // reset (a fresh revision starts clean).
          requirementsOverview: sheet.requirementsOverview,
          deliveryDate: sheet.deliveryDate,
          deliveryLocation: sheet.deliveryLocation,
          deliveryType: sheet.deliveryType,
          qualityReportsExpected: sheet.qualityReportsExpected,
          qualityReportNotes: sheet.qualityReportNotes,
          installationCommissioningRequired:
            sheet.installationCommissioningRequired,
          installationNotes: sheet.installationNotes,
          warrantyTerms: sheet.warrantyTerms,
          paymentMilestones: sheet.paymentMilestones,
          siteReadinessRequirements: sheet.siteReadinessRequirements,
          specialHandlingInstructions: sheet.specialHandlingInstructions,
          packagingType: sheet.packagingType,
          protectiveMeasures: sheet.protectiveMeasures,
          packagingComplianceStandard: sheet.packagingComplianceStandard,
          labelingRequirements: sheet.labelingRequirements,
          customerPackagingSpecReference: sheet.customerPackagingSpecReference,
          customerContactName: sheet.customerContactName,
          customerContactPhone: sheet.customerContactPhone,
          customerContactEmail: sheet.customerContactEmail,
        },
      });
    });
    return this.toEntity(revision);
  }

  /**
   * Every sheet AWAITING_INTERNAL_SIGNATURE across all orders — the Sales
   * Head's / SuperAdmin's countersignature queue. A discovery surface; the
   * actual sign/reject still happens on the order's OCS section. Gated by
   * assertCanReview (the same Sales-Head/SuperAdmin check as sign/reject).
   */
  async findPendingApproval(
    user: AuthenticatedUser,
  ): Promise<ConfirmationSheetEntity[]> {
    await this.assertCanReview(user);
    const sheets = await this.prisma.orderConfirmationSheet.findMany({
      where: PENDING_INTERNAL_SIGNATURE_WHERE,
      orderBy: { createdAt: 'asc' },
    });
    return sheets.map((s) => this.toEntity(s));
  }

  /**
   * Count of sheets awaiting the caller's countersignature — reuses the EXACT
   * same where-clause as findPendingApproval (no drift). Returns 0 for a
   * caller who isn't a reviewer, rather than throwing, so the unified
   * notifications endpoint can call it uniformly for any role.
   */
  async countPendingForReviewer(user: AuthenticatedUser): Promise<number> {
    if (!(await this.isReviewer(user))) {
      return 0;
    }
    return this.prisma.orderConfirmationSheet.count({
      where: PENDING_INTERNAL_SIGNATURE_WHERE,
    });
  }

  /** All sheets for an order, newest revision first (full history, §7). */
  async listForOrder(
    orderId: string,
    user: AuthenticatedUser,
  ): Promise<ConfirmationSheetEntity[]> {
    await this.access.assertSalesAccess(user);
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) {
      throw new NotFoundException('Order not found');
    }
    // Newest first by creation time. revisionNumber alone ties across
    // independent sheet cycles (each starts at rev 1), so it can't order the
    // list; createdAt is the stable "latest" the UI relies on.
    const sheets = await this.prisma.orderConfirmationSheet.findMany({
      where: { orderId },
      orderBy: { createdAt: 'desc' },
    });
    return sheets.map((s) => this.toEntity(s));
  }

  async findOne(
    id: string,
    user: AuthenticatedUser,
  ): Promise<ConfirmationSheetEntity> {
    await this.access.assertSalesAccess(user);
    return this.toEntity(await this.findRawOrThrow(id));
  }

  /** Presigned GET for the signed copy (Sales Head reviews the real doc). */
  async getSignedCopyDownloadUrl(
    id: string,
    user: AuthenticatedUser,
  ): Promise<{ downloadUrl: string; expiresInSeconds: number }> {
    await this.access.assertSalesAccess(user);
    const sheet = await this.findRawOrThrow(id);
    if (!sheet.signedCopyStorageKey) {
      throw new BadRequestException('No signed copy has been uploaded yet');
    }
    const { url, expiresInSeconds } = await this.storage.createDownloadUrl(
      sheet.signedCopyStorageKey,
    );
    return { downloadUrl: url, expiresInSeconds };
  }

  /**
   * Order gate helper (mirrors bidAssessments.latestApprovedFor): true iff the
   * order's most-recent confirmation sheet is EXECUTED. Injected into
   * OrdersService to hard-block CONFIRMED → IN_PRODUCTION.
   */
  async latestIsExecutedFor(orderId: string): Promise<boolean> {
    // "Latest" = most recently created (stable across independent sheet cycles,
    // which each restart revisionNumber at 1).
    const latest = await this.prisma.orderConfirmationSheet.findFirst({
      where: { orderId },
      orderBy: { createdAt: 'desc' },
    });
    return latest?.status === OrderConfirmationStatus.EXECUTED;
  }

  // ── internals ──────────────────────────────────────────────────────

  /** Load a sheet + assert the caller may WRITE it (order owner/team scope). */
  private async loadForWrite(
    id: string,
    user: AuthenticatedUser,
  ): Promise<{ sheet: OrderConfirmationSheet; ownerId: string }> {
    await this.access.assertSalesAccess(user);
    const sheet = await this.findRawOrThrow(id);
    const order = await this.prisma.order.findUnique({
      where: { id: sheet.orderId },
      select: { ownerId: true },
    });
    if (!order) {
      throw new NotFoundException('Order not found');
    }
    await this.access.assertCanAccessOwned(user, order.ownerId);
    return { sheet, ownerId: order.ownerId };
  }

  private async findRawOrThrow(id: string): Promise<OrderConfirmationSheet> {
    const sheet = await this.prisma.orderConfirmationSheet.findUnique({
      where: { id },
    });
    if (!sheet) {
      throw new NotFoundException('Confirmation sheet not found');
    }
    return sheet;
  }

  /** Sales Head or SUPER_ADMIN — same routing as the Bid/No-Bid gate. */
  /** True if the caller may review (Sales Head, or SUPER_ADMIN fallback). */
  private async isReviewer(user: AuthenticatedUser): Promise<boolean> {
    if (isSuperAdmin(user)) {
      return true;
    }
    const me = await this.prisma.employee.findUnique({
      where: { id: user.id },
      select: { isSalesHead: true },
    });
    return !!me?.isSalesHead;
  }

  private async assertCanReview(user: AuthenticatedUser): Promise<void> {
    if (!(await this.isReviewer(user))) {
      throw new ForbiddenException(
        'Only the designated Sales Head or a SUPER_ADMIN may sign or reject a confirmation sheet',
      );
    }
  }

  /**
   * Required-field enforcement at generate-pdf time. The structured packaging
   * block (§2.1) is mandatory, plus the core delivery/warranty/payment/contact
   * fields. Nullable free-text notes stay optional.
   */
  private assertComplete(sheet: OrderConfirmationSheet): void {
    const missing: string[] = [];
    const req = (val: unknown, label: string) => {
      if (val === null || val === undefined || val === '') missing.push(label);
    };
    req(sheet.requirementsOverview, 'requirements overview');
    // deliveryDate is NOT NULL; an unset DRAFT uses the epoch sentinel.
    if (!sheet.deliveryDate || sheet.deliveryDate.getTime() === 0) {
      missing.push('delivery date');
    }
    req(sheet.deliveryLocation, 'delivery location');
    req(sheet.deliveryType, 'delivery type');
    req(sheet.warrantyTerms, 'warranty terms');
    req(sheet.paymentMilestones, 'payment milestones');
    // Packaging block — all required (§2.1).
    req(sheet.packagingType, 'packaging type');
    req(sheet.protectiveMeasures, 'protective measures');
    req(sheet.labelingRequirements, 'labeling requirements');
    // Delivery coordination contact.
    req(sheet.customerContactName, 'customer contact name');
    req(sheet.customerContactPhone, 'customer contact phone');
    req(sheet.customerContactEmail, 'customer contact email');
    if (missing.length > 0) {
      throw new BadRequestException(
        `Cannot generate the PDF — these required fields are still empty: ${missing.join(
          ', ',
        )}`,
      );
    }
  }

  /**
   * Full create payload for the editable columns. NOT NULL text/enum columns
   * default to '' / FULL_TRUCKLOAD so an incomplete DRAFT can be saved; the
   * generate-pdf gate enforces real values before the sheet is sent out.
   */
  private createData(
    dto: CreateConfirmationSheetDto,
  ): Omit<
    Prisma.OrderConfirmationSheetUncheckedCreateInput,
    'confirmationNumber' | 'orderId' | 'createdById'
  > {
    return {
      requirementsOverview: dto.requirementsOverview ?? '',
      deliveryDate: dto.deliveryDate
        ? new Date(dto.deliveryDate)
        : new Date(0),
      deliveryLocation: dto.deliveryLocation ?? '',
      deliveryType: dto.deliveryType ?? 'FULL_TRUCKLOAD',
      qualityReportsExpected: dto.qualityReportsExpected ?? [],
      qualityReportNotes: dto.qualityReportNotes ?? null,
      installationCommissioningRequired:
        dto.installationCommissioningRequired ?? false,
      installationNotes: dto.installationNotes ?? null,
      warrantyTerms: dto.warrantyTerms ?? '',
      paymentMilestones: dto.paymentMilestones ?? '',
      siteReadinessRequirements: dto.siteReadinessRequirements ?? null,
      specialHandlingInstructions: dto.specialHandlingInstructions ?? null,
      packagingType: dto.packagingType ?? '',
      protectiveMeasures: dto.protectiveMeasures ?? '',
      packagingComplianceStandard: dto.packagingComplianceStandard ?? null,
      labelingRequirements: dto.labelingRequirements ?? '',
      customerPackagingSpecReference:
        dto.customerPackagingSpecReference ?? null,
      customerContactName: dto.customerContactName ?? '',
      customerContactPhone: dto.customerContactPhone ?? '',
      customerContactEmail: dto.customerContactEmail ?? '',
    };
  }

  /** Map a create/update DTO to the editable Prisma columns (undefined skips). */
  private editableData(
    dto: UpdateConfirmationSheetDto,
  ): Prisma.OrderConfirmationSheetUncheckedUpdateInput {
    return {
      requirementsOverview: dto.requirementsOverview,
      deliveryDate: dto.deliveryDate ? new Date(dto.deliveryDate) : undefined,
      deliveryLocation: dto.deliveryLocation,
      deliveryType: dto.deliveryType,
      qualityReportsExpected: dto.qualityReportsExpected,
      qualityReportNotes: dto.qualityReportNotes,
      installationCommissioningRequired: dto.installationCommissioningRequired,
      installationNotes: dto.installationNotes,
      warrantyTerms: dto.warrantyTerms,
      paymentMilestones: dto.paymentMilestones,
      siteReadinessRequirements: dto.siteReadinessRequirements,
      specialHandlingInstructions: dto.specialHandlingInstructions,
      packagingType: dto.packagingType,
      protectiveMeasures: dto.protectiveMeasures,
      packagingComplianceStandard: dto.packagingComplianceStandard,
      labelingRequirements: dto.labelingRequirements,
      customerPackagingSpecReference: dto.customerPackagingSpecReference,
      customerContactName: dto.customerContactName,
      customerContactPhone: dto.customerContactPhone,
      customerContactEmail: dto.customerContactEmail,
    };
  }

  private toEntity(s: OrderConfirmationSheet): ConfirmationSheetEntity {
    return new ConfirmationSheetEntity({
      id: s.id,
      confirmationNumber: s.confirmationNumber,
      orderId: s.orderId,
      revisionNumber: s.revisionNumber,
      status: s.status,
      requirementsOverview: s.requirementsOverview,
      deliveryDate: s.deliveryDate ? s.deliveryDate.toISOString() : null,
      deliveryLocation: s.deliveryLocation,
      deliveryType: s.deliveryType,
      qualityReportsExpected: s.qualityReportsExpected,
      qualityReportNotes: s.qualityReportNotes,
      installationCommissioningRequired: s.installationCommissioningRequired,
      installationNotes: s.installationNotes,
      warrantyTerms: s.warrantyTerms,
      paymentMilestones: s.paymentMilestones,
      siteReadinessRequirements: s.siteReadinessRequirements,
      specialHandlingInstructions: s.specialHandlingInstructions,
      packagingType: s.packagingType,
      protectiveMeasures: s.protectiveMeasures,
      packagingComplianceStandard: s.packagingComplianceStandard,
      labelingRequirements: s.labelingRequirements,
      customerPackagingSpecReference: s.customerPackagingSpecReference,
      customerContactName: s.customerContactName,
      customerContactPhone: s.customerContactPhone,
      customerContactEmail: s.customerContactEmail,
      pdfGeneratedAt: s.pdfGeneratedAt ? s.pdfGeneratedAt.toISOString() : null,
      hasSignedCopy: !!s.signedCopyStorageKey,
      signedCopyUploadedById: s.signedCopyUploadedById,
      signedCopyUploadedAt: s.signedCopyUploadedAt
        ? s.signedCopyUploadedAt.toISOString()
        : null,
      internalSignedById: s.internalSignedById,
      internalSignedAt: s.internalSignedAt
        ? s.internalSignedAt.toISOString()
        : null,
      internalReviewComments: s.internalReviewComments,
      internalSignedByName: s.internalSignedByName,
      approverSignatureTextSnapshot: s.approverSignatureTextSnapshot,
      approverSignatureFontSnapshot: s.approverSignatureFontSnapshot,
      createdById: s.createdById,
      createdAt: s.createdAt.toISOString(),
      updatedAt: s.updatedAt.toISOString(),
    });
  }
}
