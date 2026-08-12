import { randomBytes } from 'crypto';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  BomStatus,
  GoodsReceiptNoteStatus,
  ItemType,
  Prisma,
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
import {
  ExplodableBom,
  explodeProcurementBom,
} from '../bom/bom-explosion';
import {
  CreateCustomerBomIntakeDto,
  CustomerBomUploadUrlDto,
} from './dto/customer-bom-intake.dto';

type Candidate = { id: string; itemCode: string; name: string; score: number };

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

@Injectable()
export class CustomerBomIntakeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: SalesAccessService,
    private readonly numbering: SalesNumberingService,
    private readonly storage: VaultStorageService,
  ) {}

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
        ...(await this.quoteStagePricing(row.finishedGoodItemId, row.product?.targetMarginPercent)),
      })),
    );
  }

  async create(
    opportunityId: string,
    dto: CreateCustomerBomIntakeDto,
    user: AuthenticatedUser,
  ) {
    const opportunity = await this.ownedOpportunity(opportunityId, user);
    if (!dto.fileKey.startsWith(`customer-bom-intake/${user.id}/`)) {
      throw new BadRequestException('Invalid customer BOM file key');
    }
    assertExtensionAllowed(dto.fileName);
    const head = await this.storage.headObject(dto.fileKey);
    if (!head)
      throw new BadRequestException(
        'Customer BOM upload was not found in storage',
      );
    assertSizeWithinCap(head.sizeBytes);

    const businessUnit = await this.prisma.businessUnit.findFirst({
      where: { id: dto.businessUnitId, isActive: true },
      select: { id: true },
    });
    if (!businessUnit)
      throw new BadRequestException('Business unit is inactive or unknown');

    // Re-run fuzzy matching server-side. Creation is impossible unless Sales
    // either chose a real Item or explicitly acknowledged the candidates.
    const prepared: Array<{
      input: (typeof dto.lines)[number];
      candidates: Candidate[];
    }> = [];
    for (const input of dto.lines) {
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
          rawFileKey: dto.fileKey,
          rawFileName: dto.fileName,
          rawFileSize: head.sizeBytes,
          rawMimeType: head.contentType ?? 'application/octet-stream',
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
      if (!cost)
        return { liveBomCostEstimate: null, suggestedUnitPrice: null };
      total = total.plus(cost.mul(leaf.quantityPerTopUnit));
    }
    const margin = targetMarginPercent
      ? targetMarginPercent.div(100)
      : null;
    const suggested = margin && margin.lt(1) ? total.div(new Prisma.Decimal(1).minus(margin)) : null;
    return {
      liveBomCostEstimate: total.toFixed(2),
      suggestedUnitPrice: suggested?.toFixed(2) ?? null,
    };
  }
}
