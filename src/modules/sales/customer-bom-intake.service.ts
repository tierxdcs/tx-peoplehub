import { randomBytes } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import {
  BomEventType,
  BomStatus,
  CustomerBomIntakeStatus,
  GoodsReceiptNoteStatus,
  ItemType,
  Prisma,
  RfqStatus,
} from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { VaultStorageService } from '../vault/vault-storage.service';
import {
  assertExtensionAllowed,
  assertSizeWithinCap,
} from '../vault/vault-guardrails';
import {
  SalesAccessService,
  isSuperAdmin,
} from './common/sales-access.service';
import { SalesNumberingService } from './common/sales-numbering.service';
import { ExplodableBom, explodeProcurementBom } from '../bom/bom-explosion';
import { BomService } from '../bom/bom.service';
import { DesignAccessService } from '../design/design-access.service';
import { DesignService } from '../design/design.service';
import { PingsService } from '../pings/pings.service';
import { DEFAULT_TARGET_MARGIN_PERCENT } from './product-margin';
import {
  CreateCustomerBomIntakeDto,
  CustomerBomIntakeLineDto,
  CustomerBomUploadUrlDto,
  HandoverDesignBomDto,
  ReviseCustomerBomIntakeDto,
  SendBomIntakeToDesignDto,
  UpdateCustomerBomIntakeDto,
} from './dto/customer-bom-intake.dto';

type Candidate = { id: string; itemCode: string; name: string; score: number };

export type IntakeDerivedStatus =
  | 'DESIGN_IN_PROGRESS'
  | 'DRAFT'
  | 'PENDING_APPROVAL'
  | 'RFQ_FLOATED'
  | 'PRICED'
  | 'RELEASED';

/**
 * Register-page lifecycle label, derived — no stored status to drift. Priced
 * (an awarded RFQ quote exists) outranks merely-floated; a RELEASED BOM
 * outranks everything (the intake has graduated to a real engineering doc).
 *
 * Waiting on design sits below both, not above: a DESIGN_PENDING intake has no
 * BOM and no RFQs, so those signals cannot fire for one anyway — and if a stored
 * status ever went stale, the real downstream evidence should still win.
 */
export function deriveIntakeStatus(
  intakeStatus: CustomerBomIntakeStatus | null,
  bomStatus: BomStatus | null,
  rfqStatuses: RfqStatus[],
): IntakeDerivedStatus {
  if (bomStatus === BomStatus.RELEASED) return 'RELEASED';
  if (rfqStatuses.includes(RfqStatus.AWARDED)) return 'PRICED';
  if (rfqStatuses.some((s) => s === RfqStatus.ISSUED || s === RfqStatus.CLOSED))
    return 'RFQ_FLOATED';
  if (intakeStatus === CustomerBomIntakeStatus.DESIGN_PENDING)
    return 'DESIGN_IN_PROGRESS';
  if (bomStatus === BomStatus.PENDING_APPROVAL) return 'PENDING_APPROVAL';
  return 'DRAFT';
}

/**
 * The design work behind a design-required intake, newest first. Only the newest
 * one is ever surfaced: a second row exists only because a rejected or closed
 * request was re-raised, and the live one is always the latest.
 */
const DESIGN_REQUEST_SELECT = {
  select: {
    id: true,
    requestNumber: true,
    status: true,
    title: true,
    priority: true,
    targetDate: true,
    project: {
      select: { id: true, projectNumber: true, name: true, status: true },
    },
  },
  orderBy: { createdAt: 'desc' },
} as const;

/**
 * Same, plus Sales' brief. Only the design-side detail selects it: the brief runs
 * to 4000 characters, which has no business being fetched once per register row.
 */
const DESIGN_REQUEST_BRIEF_SELECT = {
  select: { ...DESIGN_REQUEST_SELECT.select, description: true },
  orderBy: DESIGN_REQUEST_SELECT.orderBy,
} as const;

/** Shape of the RFQ rows both register and detail select for the award check. */
type AwardableRfq = {
  id: string;
  rfqNumber: string;
  status: RfqStatus;
  awardDecisionAt: Date | null;
};

/**
 * The RFQ whose quote has been accepted, if any. This is the "approved quote
 * has been received" signal Sales watches for: at award the supplier's price
 * becomes the BOM's cost, which is what the product gets priced from. Surfaced
 * separately from the lifecycle badge because a released BOM shows RELEASED and
 * would otherwise hide the fact that the quote ever landed.
 */
export function approvedQuote(rfqs: AwardableRfq[]) {
  const awarded = rfqs.find((rfq) => rfq.status === RfqStatus.AWARDED);
  return awarded
    ? {
        rfqId: awarded.id,
        rfqNumber: awarded.rfqNumber,
        receivedAt: awarded.awardDecisionAt,
      }
    : null;
}

function tokens(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .split(/\s+/)
      .filter((part) => part.length > 1),
  );
}

/** Token Dice similarity catches reordered wording without database extensions. */
export function fuzzyItemScore(query: string, candidate: string): number {
  const left = tokens(query);
  const right = tokens(candidate);
  if (!left.size || !right.size) return 0;
  let overlap = 0;
  for (const token of left) if (right.has(token)) overlap += 1;
  return (2 * overlap) / (left.size + right.size);
}

/** The source document is optional, but partial upload provenance is invalid. */
export function customerBomFileInput(dto: {
  fileKey?: string;
  fileName?: string;
}): { key: string; name: string } | null {
  if (!!dto.fileKey !== !!dto.fileName) {
    throw new BadRequestException(
      'Customer BOM file key and file name must be provided together',
    );
  }
  return dto.fileKey && dto.fileName
    ? { key: dto.fileKey, name: dto.fileName }
    : null;
}

function customerBomFileInputs(dto: {
  fileKey?: string;
  fileName?: string;
  attachments?: Array<{ fileKey: string; fileName: string }>;
}) {
  const legacy = customerBomFileInput(dto);
  const files =
    dto.attachments?.map((file) => ({
      key: file.fileKey,
      name: file.fileName,
    })) ?? (legacy ? [legacy] : []);
  if (files.length > 10) {
    throw new BadRequestException('A BOM intake can contain at most 10 files');
  }
  return files;
}

@Injectable()
export class CustomerBomIntakeService implements OnModuleInit {
  private readonly logger = new Logger(CustomerBomIntakeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: SalesAccessService,
    private readonly numbering: SalesNumberingService,
    private readonly storage: VaultStorageService,
    private readonly pings: PingsService,
    private readonly moduleRef: ModuleRef,
    private readonly design: DesignService,
    private readonly designAccess: DesignAccessService,
  ) {}

  /**
   * BomService is resolved from the container rather than injected, because
   * SalesModule cannot import BomModule: Sales → Bom → Notifications → Sales
   * is a cycle, and that module edge makes CJS evaluate `SalesModule` while it
   * is still initialising, so every module importing it eagerly sees
   * `undefined` (forwardRef defers Nest's resolution, not that binding).
   *
   * Resolved here rather than lazily at the call site so a missing provider
   * still fails at boot, exactly like a constructor injection would, instead
   * of surfacing the first time a salesperson presses Submit.
   */
  private boms!: BomService;

  onModuleInit() {
    this.boms = this.moduleRef.get(BomService, { strict: false });
  }

  async uploadUrl(dto: CustomerBomUploadUrlDto, user: AuthenticatedUser) {
    await this.access.assertSalesAccess(user);
    assertExtensionAllowed(dto.fileName);
    assertSizeWithinCap(dto.fileSize);
    const fileKey = `customer-bom-intake/${user.id}/${randomBytes(12).toString('hex')}`;
    const signed = await this.storage.createUploadUrl(fileKey, dto.mimeType);
    return {
      fileKey,
      uploadUrl: signed.url,
      expiresInSeconds: signed.expiresInSeconds,
    };
  }

  async matches(
    description: string,
    user: AuthenticatedUser,
  ): Promise<Candidate[]> {
    await this.access.assertSalesAccess(user);
    return this.candidatesFor(description);
  }

  /**
   * The fuzzy Item Master lookup itself, with no access rule of its own. Split
   * out from `matches` because the design team resolves lines too when it hands
   * over a designed BOM, and a design user is not a Sales user — each door
   * applies its own gate and then shares this.
   */
  private async candidatesFor(description: string): Promise<Candidate[]> {
    const rows = await this.prisma.item.findMany({
      where: { isActive: true },
      select: { id: true, itemCode: true, name: true },
    });
    return rows
      .map((item) => ({
        ...item,
        score: fuzzyItemScore(description, `${item.itemCode} ${item.name}`),
      }))
      .filter((item) => item.score >= 0.25)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);
  }

  async list(opportunityId: string, user: AuthenticatedUser) {
    const opportunity = await this.ownedOpportunity(opportunityId, user);
    const rows = await this.prisma.customerBomIntake.findMany({
      where: { opportunityId: opportunity.id },
      include: {
        product: {
          select: {
            id: true,
            sku: true,
            name: true,
            targetMarginPercent: true,
          },
        },
        bom: { select: { id: true, status: true, revisionNumber: true } },
        lines: {
          orderBy: { sequence: 'asc' },
          include: { resolvedItem: { select: { itemCode: true, name: true } } },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    return Promise.all(
      rows.map(async (row) => ({
        ...row,
        ...(await this.quoteStagePricing(
          row.finishedGoodItemId,
          row.product?.targetMarginPercent,
        )),
      })),
    );
  }

  async create(
    opportunityId: string,
    dto: CreateCustomerBomIntakeDto,
    user: AuthenticatedUser,
  ) {
    const opportunity = await this.ownedOpportunity(opportunityId, user);
    const fileInputs = customerBomFileInputs(dto);
    // The two modes are mutually exclusive by definition: either the customer
    // handed over a parts list (transcribe it) or they did not (design it).
    const requiresDesign = dto.requiresDesign === true;
    if (requiresDesign && dto.lines?.length) {
      throw new BadRequestException(
        'A design-required intake starts with no lines — the design team authors them',
      );
    }
    if (!requiresDesign && !dto.lines?.length) {
      throw new BadRequestException(
        'Transcribe at least one line, or mark the intake as requiring design',
      );
    }
    // The design work is raised with the intake, so the deadline has to be
    // resolvable now. `expectedBy` is the usual answer: the date the design sits
    // inside is the date Sales promised the customer a price.
    const designTargetDate = requiresDesign
      ? (dto.design?.targetDate ?? dto.expectedBy)
      : undefined;
    if (requiresDesign && !designTargetDate) {
      throw new BadRequestException(
        'Set a target date for the design work, or the date the price was promised',
      );
    }

    const uploadedFiles: Array<{
      key: string;
      name: string;
      sizeBytes: number;
      contentType: string;
    }> = [];
    for (const fileInput of fileInputs) {
      if (!fileInput.key.startsWith(`customer-bom-intake/${user.id}/`)) {
        throw new BadRequestException('Invalid customer BOM file key');
      }
      assertExtensionAllowed(fileInput.name);
      const head = await this.storage.headObject(fileInput.key);
      if (!head)
        throw new BadRequestException(
          'Customer BOM upload was not found in storage',
        );
      assertSizeWithinCap(head.sizeBytes);
      uploadedFiles.push({
        key: fileInput.key,
        name: fileInput.name,
        sizeBytes: head.sizeBytes,
        contentType: head.contentType ?? 'application/octet-stream',
      });
    }
    const uploadedFile = uploadedFiles[0] ?? null;

    const businessUnit = await this.prisma.businessUnit.findFirst({
      where: { id: dto.businessUnitId, isActive: true },
      select: { id: true },
    });
    if (!businessUnit)
      throw new BadRequestException('Business unit is inactive or unknown');

    const prepared = await this.prepareLines(dto.lines ?? []);

    const result = await this.prisma.$transaction(async (tx) => {
      const fgCode = await this.numbering.nextContinuousNumber(
        'FG',
        'item_finished_good',
        tx,
      );
      const finishedGood = await tx.item.create({
        data: {
          itemCode: fgCode,
          name: dto.productName.trim(),
          itemType: ItemType.FINISHED_GOOD,
          baseUnitOfMeasure: dto.unitOfMeasure,
        },
      });
      const resolved = await this.resolveItems(tx, prepared);
      // No parts list yet means no BOM to create; the design team's handover
      // authors revision 1 later, against this same finished-good item.
      const bom = requiresDesign
        ? null
        : await tx.bom.create({
            data: {
              itemId: finishedGood.id,
              revisionNumber: 1,
              status: BomStatus.DRAFT,
              revisionNotes: `Quote-stage customer BOM from opportunity ${opportunity.name}`,
              createdById: user.id,
              lines: {
                create: resolved.map((entry, sequence) => ({
                  itemId: entry.itemId,
                  quantityPerUnit: new Prisma.Decimal(entry.row.input.quantity),
                  unitOfMeasure: entry.row.input.unitOfMeasure,
                  wastagePercent: new Prisma.Decimal(0),
                  makeBuy: 'BUY',
                  notes: entry.row.input.customerPartReference?.trim() || null,
                  sequence,
                })),
              },
            },
          });
      const product = await tx.product.create({
        data: {
          sku: fgCode,
          name: dto.productName.trim(),
          // Intake provenance belongs on CustomerBomIntake itself. Do not put
          // it in the customer-facing catalog description: bids print Product
          // descriptions verbatim on the proposal.
          description: null,
          // Nobody can price this yet: the cost arrives later from the awarded
          // RFQ quotes. autoPricedFromBomCost hands the price to the BOM
          // release, which will set it from that cost at the target margin.
          unitPrice: new Prisma.Decimal(0),
          autoPricedFromBomCost: true,
          unitOfMeasure: dto.unitOfMeasure,
          itemId: finishedGood.id,
          businessUnitId: dto.businessUnitId,
          targetMarginPercent: new Prisma.Decimal(
            dto.targetMarginPercent ?? DEFAULT_TARGET_MARGIN_PERCENT,
          ),
        },
      });
      const created = await tx.customerBomIntake.create({
        data: {
          opportunityId,
          businessUnitId: dto.businessUnitId,
          productName: dto.productName.trim(),
          unitOfMeasure: dto.unitOfMeasure,
          expectedBy: dto.expectedBy ? new Date(dto.expectedBy) : null,
          rawFileKey: uploadedFile?.key ?? null,
          rawFileName: uploadedFile?.name ?? null,
          rawFileSize: uploadedFile?.sizeBytes ?? null,
          rawMimeType: uploadedFile?.contentType ?? null,
          rawAttachments:
            uploadedFiles.length > 0
              ? (uploadedFiles as Prisma.InputJsonValue)
              : Prisma.JsonNull,
          status: requiresDesign
            ? CustomerBomIntakeStatus.DESIGN_PENDING
            : CustomerBomIntakeStatus.CREATED,
          finishedGoodItemId: finishedGood.id,
          productId: product.id,
          bomId: bom?.id ?? null,
          createdById: user.id,
          lines: {
            create: resolved.map((entry, sequence) => ({
              description: entry.row.input.description.trim(),
              customerPartReference:
                entry.row.input.customerPartReference?.trim() || null,
              quantity: new Prisma.Decimal(entry.row.input.quantity),
              unitOfMeasure: entry.row.input.unitOfMeasure,
              resolvedItemId: entry.itemId,
              createdNewItem: entry.created,
              fuzzyCandidates: entry.row
                .candidates as unknown as Prisma.InputJsonValue,
              sequence,
            })),
          },
        },
      });
      // Raise the design work here rather than making Sales come back for it: the
      // brief is already in hand, and an intake nobody has briefed is invisible to
      // the design team (their queue only lists intakes that have a request).
      const request =
        requiresDesign && dto.design
          ? await this.design.raiseRequestForBomIntake(
              {
                customerBomIntakeId: created.id,
                title:
                  dto.design.title?.trim() ||
                  `Design & BOM: ${dto.productName.trim()}`,
                description: dto.design.description.trim(),
                priority: dto.design.priority,
                productId: product.id,
                customerId: opportunity.customerId,
                targetDate: new Date(designTargetDate as string),
                requestedById: user.id,
              },
              tx,
            )
          : null;
      return { intake: created, designRequest: request };
    });
    const { intake, designRequest } = result;
    if (designRequest) {
      await this.notifyDesignHeads(
        { ...intake, opportunity: { name: opportunity.name } },
        designRequest,
        user,
      );
    }
    return this.list(opportunityId, user).then((rows) =>
      rows.find((row) => row.id === intake.id),
    );
  }

  /** Every intake visible to this user (owner/hierarchy-scoped like the rest
   * of Sales), with the derived lifecycle status for the register page. */
  async register(user: AuthenticatedUser) {
    await this.access.assertSalesAccess(user);
    const ownerIds = await this.access.visibleOwnerIds(user);
    const rows = await this.prisma.customerBomIntake.findMany({
      where: ownerIds ? { opportunity: { ownerId: { in: ownerIds } } } : {},
      include: {
        opportunity: {
          select: {
            id: true,
            name: true,
            customer: { select: { name: true } },
          },
        },
        businessUnit: { select: { name: true } },
        product: { select: { sku: true, name: true } },
        bom: { select: { id: true, status: true, revisionNumber: true } },
        rfqs: {
          select: {
            id: true,
            rfqNumber: true,
            status: true,
            awardDecisionAt: true,
          },
        },
        designRequests: DESIGN_REQUEST_SELECT,
        createdBy: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(({ designRequests, ...row }) => ({
      ...row,
      derivedStatus: deriveIntakeStatus(
        row.status,
        row.bom?.status ?? null,
        row.rfqs.map((rfq) => rfq.status),
      ),
      approvedQuote: approvedQuote(row.rfqs),
      designRequest: designRequests[0] ?? null,
    }));
  }

  /** One intake with its current revision's BOM lines, the full revision
   * history (every Bom row on the finished-good item), linked RFQs, and the
   * quote-stage pricing estimate. */
  async detail(id: string, user: AuthenticatedUser) {
    await this.access.assertSalesAccess(user);
    const row = await this.prisma.customerBomIntake.findUnique({
      where: { id },
      include: {
        opportunity: {
          select: {
            id: true,
            name: true,
            ownerId: true,
            customer: { select: { name: true } },
          },
        },
        businessUnit: { select: { name: true } },
        product: {
          select: {
            id: true,
            sku: true,
            name: true,
            targetMarginPercent: true,
          },
        },
        bom: {
          include: {
            lines: {
              orderBy: { sequence: 'asc' },
              include: {
                item: { select: { id: true, itemCode: true, name: true } },
              },
            },
          },
        },
        rfqs: {
          select: {
            id: true,
            rfqNumber: true,
            title: true,
            status: true,
            awardDecisionAt: true,
            createdAt: true,
            createdBy: { select: { firstName: true, lastName: true } },
          },
          orderBy: { createdAt: 'desc' },
        },
        designRequests: DESIGN_REQUEST_SELECT,
        createdBy: { select: { firstName: true, lastName: true } },
      },
    });
    if (!row) throw new NotFoundException('Customer BOM intake not found');
    await this.access.assertCanAccessOwned(user, row.opportunity.ownerId);
    const revisions = row.finishedGoodItemId
      ? await this.prisma.bom.findMany({
          where: { itemId: row.finishedGoodItemId },
          orderBy: { revisionNumber: 'desc' },
          select: {
            id: true,
            revisionNumber: true,
            status: true,
            revisionNotes: true,
            createdAt: true,
            createdBy: { select: { firstName: true, lastName: true } },
          },
        })
      : [];
    const pricing = await this.quoteStagePricing(
      row.finishedGoodItemId,
      row.product?.targetMarginPercent,
    );
    const { designRequests, ...rest } = row;
    return {
      ...rest,
      revisions,
      ...pricing,
      derivedStatus: deriveIntakeStatus(
        row.status,
        row.bom?.status ?? null,
        row.rfqs.map((rfq) => rfq.status),
      ),
      approvedQuote: approvedQuote(row.rfqs),
      designRequest: designRequests[0] ?? null,
    };
  }

  /**
   * A maker may withdraw only their own intake while its derived register state
   * is still DRAFT. SUPER_ADMIN/CEO uses the same door for Draft rows. The
   * derived check matters because the intake's stored CREATED state remains in
   * use while its linked BOM moves through its own lifecycle.
   */
  async removeDraft(id: string, user: AuthenticatedUser) {
    await this.access.assertSalesAccess(user);
    const intake = await this.prisma.customerBomIntake.findUnique({
      where: { id },
      select: {
        createdById: true,
        status: true,
        bom: { select: { status: true } },
        rfqs: { select: { status: true } },
      },
    });
    if (!intake) throw new NotFoundException('Customer BOM intake not found');
    const state = deriveIntakeStatus(
      intake.status,
      intake.bom?.status ?? null,
      intake.rfqs.map((rfq) => rfq.status),
    );
    if (state !== 'DRAFT') {
      throw new BadRequestException(
        `Only a Draft BOM intake can be deleted (current status: ${state})`,
      );
    }
    if (!isSuperAdmin(user) && intake.createdById !== user.id) {
      throw new ForbiddenException(
        'Only the employee who created this Draft BOM intake or the CEO/Super Admin can delete it',
      );
    }
    try {
      await this.prisma.customerBomIntake.delete({ where: { id } });
      return { deleted: true };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2003'
      ) {
        throw new ConflictException(
          'This Draft intake has dependent sourcing or engineering records and cannot be deleted until those records are removed.',
        );
      }
      throw error;
    }
  }

  /**
   * A short-lived link to the customer's source document, for Sales. Minted per
   * click rather than embedded in `detail()`: a URL carried in the detail payload
   * would be handed out on every page load and outlive the view that asked for it.
   */
  async fileUrl(id: string, user: AuthenticatedUser) {
    await this.access.assertSalesAccess(user);
    const intake = await this.prisma.customerBomIntake.findUnique({
      where: { id },
      select: {
        rawFileKey: true,
        rawFileName: true,
        opportunity: { select: { ownerId: true } },
      },
    });
    if (!intake) throw new NotFoundException('Customer BOM intake not found');
    await this.access.assertCanAccessOwned(user, intake.opportunity.ownerId);
    return this.signedRawFile(intake);
  }

  /**
   * Set or clear the date Sales promised the customer a price. Owner-scoped like
   * every other intake write, and allowed in any lifecycle state: the promise
   * can be renegotiated long after R&D has released the BOM.
   */
  async setExpectedBy(
    id: string,
    dto: UpdateCustomerBomIntakeDto,
    user: AuthenticatedUser,
  ) {
    await this.access.assertSalesAccess(user);
    const intake = await this.prisma.customerBomIntake.findUnique({
      where: { id },
      select: { id: true, opportunity: { select: { ownerId: true } } },
    });
    if (!intake) throw new NotFoundException('Customer BOM intake not found');
    await this.access.assertCanAccessOwned(user, intake.opportunity.ownerId);
    await this.prisma.customerBomIntake.update({
      where: { id },
      data: {
        expectedBy: dto.expectedBy ? new Date(dto.expectedBy) : null,
      },
    });
    return this.detail(id, user);
  }

  /**
   * Sales quote-stage revision. Reuses the engineering BOM revision mechanism
   * exactly: a NEW Bom row on the same finished-good item with the next
   * revisionNumber — the prior revision's rows are never mutated, so history
   * is a byte-preserved snapshot. Allowed only while the current revision is
   * still DRAFT (or REJECTED): once R&D has RELEASED the BOM it is a formal
   * engineering document and further changes go through the normal BOM
   * revision + approval cycle instead.
   */
  async revise(
    id: string,
    dto: ReviseCustomerBomIntakeDto,
    user: AuthenticatedUser,
  ) {
    await this.access.assertSalesAccess(user);
    const intake = await this.prisma.customerBomIntake.findUnique({
      where: { id },
      select: {
        id: true,
        productName: true,
        finishedGoodItemId: true,
        opportunity: { select: { ownerId: true } },
        bom: { select: { id: true, status: true, revisionNumber: true } },
      },
    });
    if (!intake) throw new NotFoundException('Customer BOM intake not found');
    await this.access.assertCanAccessOwned(user, intake.opportunity.ownerId);
    if (!intake.bom || !intake.finishedGoodItemId)
      throw new BadRequestException('This intake has no BOM to revise');
    if (
      intake.bom.status === BomStatus.RELEASED ||
      intake.bom.status === BomStatus.OBSOLETE
    )
      throw new BadRequestException(
        'This BOM has been released by R&D and is now a formal engineering document — quote-stage self-revision is closed. Request changes through the engineering BOM revision and approval flow instead.',
      );
    if (intake.bom.status === BomStatus.PENDING_APPROVAL)
      throw new BadRequestException(
        'This BOM is awaiting R&D approval — it cannot be revised until R&D approves or rejects it.',
      );

    const prepared = await this.prepareLines(dto.lines);
    const previousRevision = intake.bom.revisionNumber;
    const newRevisionNumber = await this.prisma.$transaction(async (tx) => {
      const resolved = await this.resolveItems(tx, prepared);
      const latest = await tx.bom.findFirst({
        where: { itemId: intake.finishedGoodItemId! },
        orderBy: { revisionNumber: 'desc' },
        select: { revisionNumber: true },
      });
      const bom = await tx.bom.create({
        data: {
          itemId: intake.finishedGoodItemId!,
          revisionNumber: (latest?.revisionNumber ?? 0) + 1,
          status: BomStatus.DRAFT,
          revisionNotes: dto.revisionNotes.trim(),
          createdById: user.id,
          lines: {
            create: resolved.map((entry, sequence) => ({
              itemId: entry.itemId,
              quantityPerUnit: new Prisma.Decimal(entry.row.input.quantity),
              unitOfMeasure: entry.row.input.unitOfMeasure,
              wastagePercent: new Prisma.Decimal(0),
              makeBuy: 'BUY' as const,
              notes: entry.row.input.customerPartReference?.trim() || null,
              sequence,
            })),
          },
        },
      });
      await tx.bomEvent.create({
        data: {
          bomId: bom.id,
          type: BomEventType.REVISION_CREATED,
          actorId: user.id,
          comment: `Quote-stage revision by Sales from Rev ${previousRevision}`,
        },
      });
      // The intake's provenance lines mirror the CURRENT revision (the
      // opportunity page and RFQ auto-populate read "current" from here /
      // bomId); the prior line set survives verbatim in the old Bom row.
      await tx.customerBomIntakeLine.deleteMany({ where: { intakeId: id } });
      await tx.customerBomIntake.update({
        where: { id },
        data: {
          bomId: bom.id,
          lines: {
            create: resolved.map((entry, sequence) => ({
              description: entry.row.input.description.trim(),
              customerPartReference:
                entry.row.input.customerPartReference?.trim() || null,
              quantity: new Prisma.Decimal(entry.row.input.quantity),
              unitOfMeasure: entry.row.input.unitOfMeasure,
              resolvedItemId: entry.itemId,
              createdNewItem: entry.created,
              fuzzyCandidates: entry.row
                .candidates as unknown as Prisma.InputJsonValue,
              sequence,
            })),
          },
        },
      });
      return bom.revisionNumber;
    });

    await this.notifyStaleRfqs(
      intake.id,
      intake.productName,
      newRevisionNumber,
      user,
    );
    return this.detail(id, user);
  }

  /**
   * Sales hands the finished transcription to R&D for release approval.
   *
   * Sales owns the only fact that decides when this is ready — "I have finished
   * transcribing the customer's list" — so Sales pulls the trigger, even though
   * the BOM itself is an R&D document from here on. Authorisation is the same
   * ownership rule as `revise`, NOT the R&D-vertical rule that guards the
   * generic `POST /bom/:id/submit`: this door is only ever opened for the
   * quote-stage BOM behind an intake the caller already owns.
   *
   * The transition is delegated to `BomService.submitTransition`, so the R&D
   * Head notifications, the approval push and the SUBMITTED event are the same
   * ones an R&D author's submission produces. From R&D's side a Sales-submitted
   * BOM is indistinguishable from any other item in the release queue, which is
   * the point.
   */
  async submitForApproval(id: string, user: AuthenticatedUser) {
    await this.access.assertSalesAccess(user);
    const intake = await this.prisma.customerBomIntake.findUnique({
      where: { id },
      select: {
        id: true,
        opportunity: { select: { ownerId: true } },
        bom: { select: { id: true, status: true } },
      },
    });
    if (!intake) throw new NotFoundException('Customer BOM intake not found');
    await this.access.assertCanAccessOwned(user, intake.opportunity.ownerId);
    if (!intake.bom)
      throw new BadRequestException(
        'This intake has no BOM to submit for approval',
      );
    if (intake.bom.status === BomStatus.PENDING_APPROVAL)
      throw new BadRequestException(
        'This BOM has already been submitted and is awaiting R&D approval.',
      );
    if (
      intake.bom.status === BomStatus.RELEASED ||
      intake.bom.status === BomStatus.OBSOLETE
    )
      throw new BadRequestException(
        'This BOM has already been released by R&D — there is nothing to submit.',
      );

    // DRAFT and REJECTED are the submittable states; submitTransition re-checks
    // that (and refuses an empty BOM) so the rule lives in exactly one place.
    await this.boms.submitTransition(intake.bom.id, user);
    return this.detail(id, user);
  }

  /**
   * Re-brief a design-required intake: raise a fresh design request for it.
   *
   * The normal path no longer comes through here — `create` raises the first
   * request in the same transaction as the intake, so the work is never sitting
   * un-briefed and invisible. What is left for this door is the exception: the
   * earlier request was rejected or closed and the brief has to be restated
   * (hence the live-request guard below), plus any intake created before the
   * brief moved onto the intake form.
   *
   * Kept on the Sales side because the ownership rule that decides who may ask
   * is a Sales rule; the DesignRequest shape and its numbering stay behind
   * `DesignService.raiseRequestForBomIntake`.
   */
  async sendToDesign(
    id: string,
    dto: SendBomIntakeToDesignDto,
    user: AuthenticatedUser,
  ) {
    await this.access.assertSalesAccess(user);
    const intake = await this.prisma.customerBomIntake.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        productName: true,
        productId: true,
        expectedBy: true,
        opportunity: {
          select: { name: true, ownerId: true, customerId: true },
        },
        designRequests: {
          select: { id: true, requestNumber: true, status: true },
        },
      },
    });
    if (!intake) throw new NotFoundException('Customer BOM intake not found');
    await this.access.assertCanAccessOwned(user, intake.opportunity.ownerId);
    if (intake.status !== CustomerBomIntakeStatus.DESIGN_PENDING) {
      throw new BadRequestException(
        'Only an intake raised for design can be sent to the design team',
      );
    }
    // A rejected or closed request may be re-raised (the brief usually changes);
    // an open or accepted one means the design team is already on it.
    const live = intake.designRequests.find(
      (request) => request.status === 'OPEN' || request.status === 'ACCEPTED',
    );
    if (live) {
      throw new BadRequestException(
        `${live.requestNumber} is already with the design team for this intake`,
      );
    }
    const targetDate = dto.targetDate
      ? new Date(dto.targetDate)
      : intake.expectedBy;
    if (!targetDate) {
      throw new BadRequestException(
        'Set a target date for the design work, or a promised date on the intake',
      );
    }

    const request = await this.design.raiseRequestForBomIntake({
      customerBomIntakeId: intake.id,
      title: dto.title?.trim() || `Design & BOM: ${intake.productName}`,
      description: dto.description.trim(),
      priority: dto.priority,
      productId: intake.productId,
      customerId: intake.opportunity.customerId,
      targetDate,
      requestedById: user.id,
    });
    await this.notifyDesignHeads(intake, request, user);
    return this.detail(id, user);
  }

  /**
   * The design team's own view of the quote-stage work waiting on it: every
   * intake a design request has been raised for, newest first. Gated by design
   * membership rather than the Sales owner rule — a designer is not the
   * opportunity owner and never will be.
   */
  async designQueue(user: AuthenticatedUser) {
    await this.designAccess.assertUser(user);
    const rows = await this.prisma.customerBomIntake.findMany({
      where: { designRequests: { some: {} } },
      select: {
        id: true,
        productName: true,
        unitOfMeasure: true,
        status: true,
        expectedBy: true,
        createdAt: true,
        opportunity: {
          select: {
            id: true,
            name: true,
            customer: { select: { name: true } },
          },
        },
        businessUnit: { select: { name: true } },
        bom: { select: { id: true, status: true, revisionNumber: true } },
        designRequests: DESIGN_REQUEST_SELECT,
      },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(({ designRequests, ...row }) => ({
      ...row,
      designRequest: designRequests[0] ?? null,
    }));
  }

  /**
   * One queued intake, read as the design team. Deliberately NOT `detail()`:
   * that door enforces Sales ownership and would refuse a designer outright.
   * What is exposed here is only what the design work needs — the requirement,
   * the customer's source document and the resulting BOM — never the quote-stage
   * pricing estimate, which is Sales' commercial information.
   */
  async designIntake(id: string, user: AuthenticatedUser) {
    await this.designAccess.assertUser(user);
    const row = await this.prisma.customerBomIntake.findUnique({
      where: { id },
      select: {
        id: true,
        productName: true,
        unitOfMeasure: true,
        status: true,
        expectedBy: true,
        createdAt: true,
        rawFileName: true,
        finishedGoodItemId: true,
        opportunity: {
          select: {
            id: true,
            name: true,
            customer: { select: { name: true } },
          },
        },
        businessUnit: { select: { name: true } },
        createdBy: { select: { firstName: true, lastName: true } },
        bom: {
          select: {
            id: true,
            status: true,
            revisionNumber: true,
            revisionNotes: true,
            lines: {
              orderBy: { sequence: 'asc' },
              select: {
                id: true,
                quantityPerUnit: true,
                unitOfMeasure: true,
                notes: true,
                item: { select: { id: true, itemCode: true, name: true } },
              },
            },
          },
        },
        designRequests: DESIGN_REQUEST_BRIEF_SELECT,
      },
    });
    if (!row) throw new NotFoundException('Customer BOM intake not found');
    if (!row.designRequests.length) {
      throw new NotFoundException(
        'This intake has not been sent to the design team',
      );
    }
    const { designRequests, ...rest } = row;
    return { ...rest, designRequest: designRequests[0] };
  }

  /**
   * The same document, behind the design gate. `designIntake` names the file the
   * customer's requirement arrived in; without this the design team can see that
   * a document exists and not open it — which is most of the requirement.
   */
  async designFileUrl(id: string, user: AuthenticatedUser) {
    await this.designAccess.assertUser(user);
    const intake = await this.prisma.customerBomIntake.findUnique({
      where: { id },
      select: {
        rawFileKey: true,
        rawFileName: true,
        designRequests: { select: { id: true }, take: 1 },
      },
    });
    if (!intake) throw new NotFoundException('Customer BOM intake not found');
    if (!intake.designRequests.length) {
      throw new NotFoundException(
        'This intake has not been sent to the design team',
      );
    }
    return this.signedRawFile(intake);
  }

  /** Presign whichever door already established the caller may read the intake. */
  private async signedRawFile(intake: {
    rawFileKey: string | null;
    rawFileName: string | null;
  }) {
    if (!intake.rawFileKey) {
      throw new NotFoundException(
        'No customer document is attached to this intake',
      );
    }
    const signed = await this.storage.createDownloadUrl(intake.rawFileKey);
    return {
      url: signed.url,
      fileName: intake.rawFileName,
      expiresInSeconds: signed.expiresInSeconds,
    };
  }

  /** Item Master lookup for the design team's line entry — same fuzzy matcher
   * Sales gets, behind the design gate instead of the Sales one. */
  async designMatches(description: string, user: AuthenticatedUser) {
    await this.designAccess.assertUser(user);
    return this.candidatesFor(description);
  }

  /**
   * The design team hands over the parts list it designed: revision 1 of the
   * intake's BOM, and the intake flips to CREATED — from which moment SCM's
   * quote-stage RFQ picker sees it exactly like a Sales-transcribed one.
   *
   * The flip happens here, at handover, and NOT at BOM approval or release.
   * Release prices the product from the BOM's cost, and that cost only exists
   * once SCM has awarded the RFQ — gating sourcing on release would deadlock.
   * A DRAFT BOM being RFQ-able is the existing model, not a concession.
   */
  async handoverDesignBom(
    id: string,
    dto: HandoverDesignBomDto,
    user: AuthenticatedUser,
  ) {
    await this.designAccess.assertUser(user);
    const intake = await this.prisma.customerBomIntake.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        productName: true,
        finishedGoodItemId: true,
        createdById: true,
        opportunity: { select: { id: true, name: true, ownerId: true } },
        designRequests: {
          select: { id: true, requestNumber: true, status: true },
        },
      },
    });
    if (!intake) throw new NotFoundException('Customer BOM intake not found');
    if (!intake.designRequests.length) {
      throw new NotFoundException(
        'This intake has not been sent to the design team',
      );
    }
    if (intake.status !== CustomerBomIntakeStatus.DESIGN_PENDING) {
      throw new BadRequestException(
        'This intake already has a BOM — further changes go through the BOM revision flow',
      );
    }
    if (!intake.finishedGoodItemId) {
      throw new BadRequestException(
        'This intake has no finished-good item to build a BOM against',
      );
    }
    const finishedGoodItemId = intake.finishedGoodItemId;

    const prepared = await this.prepareLines(dto.lines);
    await this.prisma.$transaction(async (tx) => {
      const resolved = await this.resolveItems(tx, prepared);
      const latest = await tx.bom.findFirst({
        where: { itemId: finishedGoodItemId },
        orderBy: { revisionNumber: 'desc' },
        select: { revisionNumber: true },
      });
      const bom = await tx.bom.create({
        data: {
          itemId: finishedGoodItemId,
          revisionNumber: (latest?.revisionNumber ?? 0) + 1,
          status: BomStatus.DRAFT,
          revisionNotes:
            dto.notes?.trim() ||
            `Designed by the design team for ${intake.designRequests[0].requestNumber}`,
          createdById: user.id,
          lines: {
            create: resolved.map((entry, sequence) => ({
              itemId: entry.itemId,
              quantityPerUnit: new Prisma.Decimal(entry.row.input.quantity),
              unitOfMeasure: entry.row.input.unitOfMeasure,
              wastagePercent: new Prisma.Decimal(0),
              makeBuy: 'BUY' as const,
              notes: entry.row.input.customerPartReference?.trim() || null,
              sequence,
            })),
          },
        },
      });
      await tx.bomEvent.create({
        data: {
          bomId: bom.id,
          type: BomEventType.CREATED,
          actorId: user.id,
          comment: `Designed for quote-stage intake ${intake.productName} (${intake.designRequests[0].requestNumber})`,
        },
      });
      // The intake's own lines mirror the current revision; there are none to
      // clear, because a design-required intake was created without any.
      await tx.customerBomIntakeLine.deleteMany({ where: { intakeId: id } });
      await tx.customerBomIntake.update({
        where: { id },
        data: {
          bomId: bom.id,
          status: CustomerBomIntakeStatus.CREATED,
          lines: {
            create: resolved.map((entry, sequence) => ({
              description: entry.row.input.description.trim(),
              customerPartReference:
                entry.row.input.customerPartReference?.trim() || null,
              quantity: new Prisma.Decimal(entry.row.input.quantity),
              unitOfMeasure: entry.row.input.unitOfMeasure,
              resolvedItemId: entry.itemId,
              createdNewItem: entry.created,
              fuzzyCandidates: entry.row
                .candidates as unknown as Prisma.InputJsonValue,
              sequence,
            })),
          },
        },
      });
    });

    await this.notifyBomHandover(intake, user);
    return this.designIntake(id, user);
  }

  /**
   * Tell the design heads there is quote-stage design work waiting. Best effort:
   * a notification failure never undoes the request that was just raised.
   */
  private async notifyDesignHeads(
    intake: { id: string; productName: string; opportunity: { name: string } },
    request: { id: string; requestNumber: string },
    user: AuthenticatedUser,
  ) {
    try {
      const heads = await this.prisma.employee.findMany({
        where: { isDesignHead: true, status: 'ACTIVE' },
        select: { id: true },
      });
      const recipientIds = heads
        .map((head) => head.id)
        .filter((headId) => headId !== user.id);
      if (!recipientIds.length) return;
      await this.pings.create(user, {
        message: `${request.requestNumber}: ${intake.productName} (${intake.opportunity.name}) needs to be designed and its BOM authored before Sales can be quoted.`,
        recipientIds,
        linkedRecordType: 'DESIGN_BOM_INTAKE',
        linkedRecordId: intake.id,
      });
    } catch (error) {
      this.logger.warn(
        `Design-request ping for ${request.requestNumber} failed: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  /**
   * Tell Sales the designed BOM has landed, so the intake can go to SCM for
   * RFQ. Best effort, for the same reason as every other ping here.
   */
  private async notifyBomHandover(
    intake: {
      id: string;
      productName: string;
      createdById: string;
      opportunity: { ownerId: string };
    },
    user: AuthenticatedUser,
  ) {
    try {
      const recipientIds = [
        ...new Set([intake.opportunity.ownerId, intake.createdById]),
      ].filter((id) => id !== user.id);
      if (!recipientIds.length) return;
      await this.pings.create(user, {
        message: `${intake.productName}: the design team has handed over the BOM — the intake is ready for SCM to float an RFQ.`,
        recipientIds,
        linkedRecordType: 'CUSTOMER_BOM_INTAKE',
        linkedRecordId: intake.id,
      });
    } catch (error) {
      this.logger.warn(
        `Design BOM handover ping for intake ${intake.id} failed: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  /**
   * Stale-RFQ gap: SCM may have floated an RFQ from an earlier revision; a
   * later revision silently invalidates it. Ping each live RFQ's owner via
   * the normal Pings mechanism (sender = the revising Sales user). Best
   * effort — a notification failure never rolls back the committed revision.
   */
  private async notifyStaleRfqs(
    intakeId: string,
    productName: string,
    revisionNumber: number,
    user: AuthenticatedUser,
  ) {
    const rfqs = await this.prisma.rfq.findMany({
      where: {
        customerBomIntakeId: intakeId,
        status: { in: [RfqStatus.DRAFT, RfqStatus.ISSUED] },
      },
      select: { id: true, rfqNumber: true, createdById: true },
    });
    for (const rfq of rfqs) {
      if (rfq.createdById === user.id) continue;
      try {
        await this.pings.create(user, {
          message: `${productName}: the quote-stage BOM was revised to Rev ${revisionNumber} after ${rfq.rfqNumber} was created — please review the RFQ for missing or changed components.`,
          recipientIds: [rfq.createdById],
          linkedRecordType: 'RFQ',
          linkedRecordId: rfq.id,
        });
      } catch (error) {
        this.logger.warn(
          `Stale-RFQ ping for ${rfq.rfqNumber} failed: ${error instanceof Error ? error.message : error}`,
        );
      }
    }
  }

  /** Validates each line's resolution choice and re-runs fuzzy matching
   * server-side — shared by create(), revise() and the design handover. */
  private async prepareLines(lines: CustomerBomIntakeLineDto[]) {
    const prepared: Array<{
      input: CustomerBomIntakeLineDto;
      candidates: Candidate[];
    }> = [];
    for (const input of lines) {
      if (!!input.existingItemId === input.confirmCreateNew) {
        throw new BadRequestException(
          'Each BOM line must select an existing match or explicitly confirm creation of a new item',
        );
      }
      prepared.push({
        input,
        candidates: await this.candidatesFor(input.description),
      });
    }
    return prepared;
  }

  /** Resolves each prepared line to an Item id, creating new COMPONENT items
   * where Sales explicitly confirmed no match — shared by create() and
   * revise(). */
  private async resolveItems(
    tx: Prisma.TransactionClient,
    prepared: Array<{
      input: CustomerBomIntakeLineDto;
      candidates: Candidate[];
    }>,
  ) {
    const resolved: Array<{
      itemId: string;
      created: boolean;
      row: (typeof prepared)[number];
    }> = [];
    for (const row of prepared) {
      if (row.input.existingItemId) {
        const existing = await tx.item.findFirst({
          where: { id: row.input.existingItemId, isActive: true },
        });
        if (!existing)
          throw new BadRequestException(
            'A selected Item Master match is unavailable',
          );
        resolved.push({ itemId: existing.id, created: false, row });
      } else {
        const itemCode = await this.numbering.nextContinuousNumber(
          'CM',
          'item_component',
          tx,
        );
        const created = await tx.item.create({
          data: {
            itemCode,
            name: row.input.description.trim(),
            description: row.input.customerPartReference?.trim() || null,
            itemType: ItemType.COMPONENT,
            baseUnitOfMeasure: row.input.unitOfMeasure,
          },
        });
        resolved.push({ itemId: created.id, created: true, row });
      }
    }
    return resolved;
  }

  private async ownedOpportunity(id: string, user: AuthenticatedUser) {
    await this.access.assertSalesAccess(user);
    const opportunity = await this.prisma.opportunity.findUnique({
      where: { id },
      select: { id: true, name: true, ownerId: true, customerId: true },
    });
    if (!opportunity) throw new NotFoundException('Opportunity not found');
    await this.access.assertCanAccessOwned(user, opportunity.ownerId);
    return opportunity;
  }

  /** Derive a customer-facing price without exposing the underlying BOM cost
   * through the Sales intake API. Never persisted; never changes Product.unitPrice. */
  private async quoteStagePricing(
    finishedGoodItemId: string | null,
    targetMarginPercent: Prisma.Decimal | null | undefined,
  ) {
    if (!finishedGoodItemId) return { suggestedUnitPrice: null };
    const boms = await this.prisma.bom.findMany({
      where: { status: { in: [BomStatus.DRAFT, BomStatus.RELEASED] } },
      orderBy: { revisionNumber: 'desc' },
      select: {
        itemId: true,
        revisionNumber: true,
        status: true,
        lines: {
          select: {
            itemId: true,
            quantityPerUnit: true,
            wastagePercent: true,
            unitOfMeasure: true,
            makeBuy: true,
          },
        },
      },
    });
    const byItem = new Map<string, ExplodableBom>();
    for (const bom of boms) {
      // DRAFT is allowed only for this intake's root. Nested engineering BOMs
      // must remain formally released.
      if (
        !byItem.has(bom.itemId) &&
        (bom.status === BomStatus.RELEASED || bom.itemId === finishedGoodItemId)
      )
        byItem.set(bom.itemId, bom);
    }
    if (!byItem.has(finishedGoodItemId)) return { suggestedUnitPrice: null };
    const leaves = explodeProcurementBom(
      finishedGoodItemId,
      (itemId) => byItem.get(itemId) ?? null,
    );
    let total = new Prisma.Decimal(0);
    for (const leaf of leaves) {
      const accepted = await this.prisma.goodsReceiptNoteLine.findFirst({
        where: {
          itemId: leaf.itemId,
          acceptedQuantity: { gt: 0 },
          grn: {
            status: {
              in: [
                GoodsReceiptNoteStatus.QC_PASSED,
                GoodsReceiptNoteStatus.QC_PARTIAL,
              ],
            },
          },
        },
        orderBy: [{ grn: { inspectedAt: 'desc' } }, { createdAt: 'desc' }],
        select: { purchaseOrderLine: { select: { unitPrice: true } } },
      });
      const awarded = accepted
        ? null
        : await this.prisma.itemQuotedCost.findFirst({
            where: { itemId: leaf.itemId },
            orderBy: [{ awardedAt: 'desc' }, { createdAt: 'desc' }],
            select: { unitPrice: true },
          });
      const manual =
        accepted || awarded
          ? null
          : await this.prisma.item.findUnique({
              where: { id: leaf.itemId },
              select: { manualStandardCost: true },
            });
      const cost =
        accepted?.purchaseOrderLine.unitPrice ??
        awarded?.unitPrice ??
        manual?.manualStandardCost;
      if (!cost) return { suggestedUnitPrice: null };
      total = total.plus(cost.mul(leaf.quantityPerTopUnit));
    }
    const margin = targetMarginPercent ? targetMarginPercent.div(100) : null;
    const suggested =
      margin && margin.lt(1)
        ? total.div(new Prisma.Decimal(1).minus(margin))
        : null;
    return {
      suggestedUnitPrice: suggested?.toFixed(2) ?? null,
    };
  }
}
