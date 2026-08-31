import { randomBytes } from 'crypto';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import {
  BomEventType,
  BomStatus,
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
import { SalesAccessService } from './common/sales-access.service';
import { SalesNumberingService } from './common/sales-numbering.service';
import { ExplodableBom, explodeProcurementBom } from '../bom/bom-explosion';
import { BomService } from '../bom/bom.service';
import { PingsService } from '../pings/pings.service';
import {
  CreateCustomerBomIntakeDto,
  CustomerBomIntakeLineDto,
  CustomerBomUploadUrlDto,
  ReviseCustomerBomIntakeDto,
} from './dto/customer-bom-intake.dto';

type Candidate = { id: string; itemCode: string; name: string; score: number };

export type IntakeDerivedStatus =
  'DRAFT' | 'PENDING_APPROVAL' | 'RFQ_FLOATED' | 'PRICED' | 'RELEASED';

/**
 * Register-page lifecycle label, derived — no stored status to drift. Priced
 * (an awarded RFQ quote exists) outranks merely-floated; a RELEASED BOM
 * outranks everything (the intake has graduated to a real engineering doc).
 */
export function deriveIntakeStatus(
  bomStatus: BomStatus | null,
  rfqStatuses: RfqStatus[],
): IntakeDerivedStatus {
  if (bomStatus === BomStatus.RELEASED) return 'RELEASED';
  if (rfqStatuses.includes(RfqStatus.AWARDED)) return 'PRICED';
  if (rfqStatuses.some((s) => s === RfqStatus.ISSUED || s === RfqStatus.CLOSED))
    return 'RFQ_FLOATED';
  if (bomStatus === BomStatus.PENDING_APPROVAL) return 'PENDING_APPROVAL';
  return 'DRAFT';
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
    const fileInput = customerBomFileInput(dto);

    let uploadedFile: {
      key: string;
      name: string;
      sizeBytes: number;
      contentType: string;
    } | null = null;
    if (fileInput) {
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
      uploadedFile = {
        key: fileInput.key,
        name: fileInput.name,
        sizeBytes: head.sizeBytes,
        contentType: head.contentType ?? 'application/octet-stream',
      };
    }

    const businessUnit = await this.prisma.businessUnit.findFirst({
      where: { id: dto.businessUnitId, isActive: true },
      select: { id: true },
    });
    if (!businessUnit)
      throw new BadRequestException('Business unit is inactive or unknown');

    const prepared = await this.prepareLines(dto.lines, user);

    const intake = await this.prisma.$transaction(async (tx) => {
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
      const bom = await tx.bom.create({
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
          description: `Created from customer BOM intake for ${opportunity.name}`,
          unitPrice: new Prisma.Decimal(0),
          unitOfMeasure: dto.unitOfMeasure,
          itemId: finishedGood.id,
          businessUnitId: dto.businessUnitId,
          targetMarginPercent:
            dto.targetMarginPercent == null
              ? null
              : new Prisma.Decimal(dto.targetMarginPercent),
        },
      });
      return tx.customerBomIntake.create({
        data: {
          opportunityId,
          businessUnitId: dto.businessUnitId,
          productName: dto.productName.trim(),
          unitOfMeasure: dto.unitOfMeasure,
          rawFileKey: uploadedFile?.key ?? null,
          rawFileName: uploadedFile?.name ?? null,
          rawFileSize: uploadedFile?.sizeBytes ?? null,
          rawMimeType: uploadedFile?.contentType ?? null,
          status: 'CREATED',
          finishedGoodItemId: finishedGood.id,
          productId: product.id,
          bomId: bom.id,
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
    });
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
        rfqs: { select: { status: true } },
        createdBy: { select: { firstName: true, lastName: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((row) => ({
      ...row,
      derivedStatus: deriveIntakeStatus(
        row.bom?.status ?? null,
        row.rfqs.map((rfq) => rfq.status),
      ),
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
            createdAt: true,
            createdBy: { select: { firstName: true, lastName: true } },
          },
          orderBy: { createdAt: 'desc' },
        },
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
    return {
      ...row,
      revisions,
      ...pricing,
      derivedStatus: deriveIntakeStatus(
        row.bom?.status ?? null,
        row.rfqs.map((rfq) => rfq.status),
      ),
    };
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

    const prepared = await this.prepareLines(dto.lines, user);
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
   * server-side — shared by create() and revise(). */
  private async prepareLines(
    lines: CustomerBomIntakeLineDto[],
    user: AuthenticatedUser,
  ) {
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
        candidates: await this.matches(input.description, user),
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
      select: { id: true, name: true, ownerId: true },
    });
    if (!opportunity) throw new NotFoundException('Opportunity not found');
    await this.access.assertCanAccessOwned(user, opportunity.ownerId);
    return opportunity;
  }

  /** Working quote estimate only: never persisted and never changes Product.unitPrice. */
  private async quoteStagePricing(
    finishedGoodItemId: string | null,
    targetMarginPercent: Prisma.Decimal | null | undefined,
  ) {
    if (!finishedGoodItemId)
      return { liveBomCostEstimate: null, suggestedUnitPrice: null };
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
    if (!byItem.has(finishedGoodItemId))
      return { liveBomCostEstimate: null, suggestedUnitPrice: null };
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
      if (!cost) return { liveBomCostEstimate: null, suggestedUnitPrice: null };
      total = total.plus(cost.mul(leaf.quantityPerTopUnit));
    }
    const margin = targetMarginPercent ? targetMarginPercent.div(100) : null;
    const suggested =
      margin && margin.lt(1)
        ? total.div(new Prisma.Decimal(1).minus(margin))
        : null;
    return {
      liveBomCostEstimate: total.toFixed(2),
      suggestedUnitPrice: suggested?.toFixed(2) ?? null,
    };
  }
}
