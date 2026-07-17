import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { BomStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { BomAccessService } from './bom-access.service';
import { InventoryService } from './inventory.service';
import { CreateReservationDto } from './dto/bom.dto';
import { ReservationEntity } from './entities/bom.entity';
import {
  BomSelectionEntity,
  StockAvailabilityReportEntity,
  StockAvailabilityRowEntity,
  StockAvailabilitySummaryEntity,
} from './entities/stock-report.entity';
import {
  baseRequirement,
  classifyAvailability,
  grossRequirement,
  QTY_PRECISION,
  round,
  wastageQuantity,
} from './stock-calc';

/**
 * Project-kickoff stock-availability report (§7–9).
 *
 * The report is SNAPSHOTTED on first generate: the selected released BOM
 * revision + its lines are copied so later BOM revisions never change a
 * historical report. Re-generating rebuilds the live availability numbers
 * against the SNAPSHOTTED requirements (not the current BOM).
 */
@Injectable()
export class StockReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: BomAccessService,
    private readonly inventory: InventoryService,
  ) {}

  // ── Generate (snapshot once) ─────────────────────────────────────────
  async generate(
    kickoffId: string,
    user: AuthenticatedUser,
  ): Promise<StockAvailabilityReportEntity> {
    await this.access.assertCanReadBoms(user);

    const kickoff = await this.prisma.projectKickoff.findUnique({
      where: { id: kickoffId },
      include: {
        order: {
          include: {
            lineItems: {
              include: { product: { select: { id: true, name: true, sku: true } } },
            },
          },
        },
        stockReport: { select: { id: true } },
      },
    });
    if (!kickoff) throw new NotFoundException('Project kickoff not found');

    // Idempotent: if a snapshot already exists, return it (never re-snapshot —
    // that would let a later BOM revision change history).
    if (kickoff.stockReport) {
      return this.readOrThrow(kickoffId, user);
    }

    // Choose the RELEASED BOM per ordered product; validate at least one exists.
    const lineItems = kickoff.order.lineItems;
    if (lineItems.length === 0) {
      throw new BadRequestException(
        'This kickoff’s order has no line items to build requirements from',
      );
    }

    // Resolve the released BOM per DISTINCT product once (reused across lines).
    const productIds = [...new Set(lineItems.map((li) => li.productId))];
    const releasedByProduct = new Map<
      string,
      Prisma.BomGetPayload<{ include: { lines: true } }>
    >();
    for (const pid of productIds) {
      const released = await this.prisma.bom.findFirst({
        where: { productId: pid, status: BomStatus.RELEASED },
        include: { lines: true },
        orderBy: { revisionNumber: 'desc' },
      });
      if (released) releasedByProduct.set(pid, released);
    }
    if (releasedByProduct.size === 0) {
      throw new BadRequestException(
        'No released BOM exists for any product on this order — release a BOM before generating the report',
      );
    }

    // Build + persist the snapshot in one transaction.
    await this.prisma.$transaction(async (tx) => {
      const report = await tx.kickoffStockReport.create({
        data: { kickoffId, quantityPrecision: QTY_PRECISION },
      });
      for (const li of lineItems) {
        const bom = releasedByProduct.get(li.productId);
        if (!bom) continue; // product without a released BOM is skipped (surfaces as UNKNOWN if referenced)
        const selection = await tx.kickoffBomSelection.create({
          data: {
            reportId: report.id,
            orderLineItemId: li.id,
            productId: li.productId,
            productName: li.product.name,
            productSku: li.product.sku,
            orderedQuantity: li.quantity,
            bomId: bom.id,
            bomRevisionNumber: bom.revisionNumber,
          },
        });
        if (bom.lines.length > 0) {
          const items = await tx.item.findMany({
            where: { id: { in: bom.lines.map((l) => l.itemId) } },
            select: { id: true, itemCode: true, name: true },
          });
          const itemById = new Map(items.map((i) => [i.id, i]));
          await tx.kickoffBomSnapshotLine.createMany({
            data: bom.lines.map((l) => {
              const it = itemById.get(l.itemId);
              return {
                selectionId: selection.id,
                itemId: l.itemId,
                itemCode: it?.itemCode ?? l.itemId,
                itemName: it?.name ?? 'Unknown item',
                unitOfMeasure: l.unitOfMeasure,
                quantityPerUnit: l.quantityPerUnit,
                wastagePercent: l.wastagePercent,
              };
            }),
          });
        }
      }
    });

    return this.readOrThrow(kickoffId, user);
  }

  /** read() but guarantees a non-null report (used right after generate). */
  private async readOrThrow(
    kickoffId: string,
    user: AuthenticatedUser,
  ): Promise<StockAvailabilityReportEntity> {
    const report = await this.read(kickoffId, user);
    if (!report) {
      throw new NotFoundException('Stock-availability report not found');
    }
    return report;
  }

  // ── Read (recompute live availability against the snapshot) ──────────
  async read(
    kickoffId: string,
    user: AuthenticatedUser,
  ): Promise<StockAvailabilityReportEntity | null> {
    await this.access.assertCanReadBoms(user);
    const report = await this.prisma.kickoffStockReport.findUnique({
      where: { kickoffId },
      include: {
        bomSelections: { include: { lines: true } },
      },
    });
    if (!report) return null;

    // Aggregate gross requirement per item across ALL selections/lines.
    type Agg = {
      itemId: string;
      itemCode: string;
      itemName: string;
      unitOfMeasure: string;
      orderedProductQuantity: Prisma.Decimal;
      baseRequirement: Prisma.Decimal;
      wastageQuantity: Prisma.Decimal;
      grossRequirement: Prisma.Decimal;
      // last-seen wastage % (informational; requirement already folds it in)
      wastagePercent: Prisma.Decimal;
      revisions: Set<string>;
    };
    const byItem = new Map<string, Agg>();

    for (const sel of report.bomSelections) {
      const orderedQty = sel.orderedQuantity;
      for (const line of sel.lines) {
        const base = baseRequirement(line.quantityPerUnit, orderedQty);
        const wastage = wastageQuantity(base, line.wastagePercent);
        const gross = grossRequirement(base, wastage);
        const key = line.itemId;
        const existing = byItem.get(key);
        if (existing) {
          existing.orderedProductQuantity =
            existing.orderedProductQuantity.plus(orderedQty);
          existing.baseRequirement = round(existing.baseRequirement.plus(base));
          existing.wastageQuantity = round(existing.wastageQuantity.plus(wastage));
          existing.grossRequirement = round(existing.grossRequirement.plus(gross));
          existing.wastagePercent = line.wastagePercent;
          existing.revisions.add(`${sel.productSku} Rev ${sel.bomRevisionNumber}`);
        } else {
          byItem.set(key, {
            itemId: line.itemId,
            itemCode: line.itemCode,
            itemName: line.itemName,
            unitOfMeasure: line.unitOfMeasure,
            orderedProductQuantity: orderedQty,
            baseRequirement: base,
            wastageQuantity: wastage,
            grossRequirement: gross,
            wastagePercent: line.wastagePercent,
            revisions: new Set([`${sel.productSku} Rev ${sel.bomRevisionNumber}`]),
          });
        }
      }
    }

    // Live stock + this-kickoff reservations per item.
    const itemIds = [...byItem.keys()];
    const balances = itemIds.length
      ? await this.prisma.stockBalance.findMany({ where: { itemId: { in: itemIds } } })
      : [];
    const balByItem = new Map<string, typeof balances>();
    for (const b of balances) {
      const arr = balByItem.get(b.itemId) ?? [];
      arr.push(b);
      balByItem.set(b.itemId, arr);
    }
    const kickoffReservations = await this.prisma.stockReservation.findMany({
      where: { kickoffId, isActive: true, itemId: { in: itemIds.length ? itemIds : ['—'] } },
    });
    const reservedForKickoffByItem = new Map<string, Prisma.Decimal>();
    for (const r of kickoffReservations) {
      reservedForKickoffByItem.set(
        r.itemId,
        (reservedForKickoffByItem.get(r.itemId) ?? new Prisma.Decimal(0)).plus(r.quantity),
      );
    }

    const rows: StockAvailabilityRowEntity[] = [];
    const summary = { available: 0, expected: 0, shortage: 0, unknown: 0 };

    for (const agg of byItem.values()) {
      const bals = balByItem.get(agg.itemId) ?? [];
      const zero = new Prisma.Decimal(0);
      const onHand = bals.reduce((s, b) => s.plus(b.onHandQuantity), zero);
      const reserved = bals.reduce((s, b) => s.plus(b.reservedQuantity), zero);
      const blocked = bals.reduce((s, b) => s.plus(b.blockedQuantity), zero);
      const available = round(onHand.minus(reserved).minus(blocked));
      const expectedReceiptQty = bals.reduce(
        (s, b) => s.plus(b.expectedReceiptQuantity ?? zero),
        zero,
      );
      const earliestExpectedDate = bals
        .map((b) => b.expectedReceiptDate)
        .filter((d): d is Date => !!d)
        .sort((a, b) => a.getTime() - b.getTime())[0];

      // Reservations belonging to THIS kickoff are already earmarked (they sit
      // inside `reserved`), so add them back to get the stock this kickoff can
      // still count on — never double-counting its own reservations (§9).
      const reservedHere = reservedForKickoffByItem.get(agg.itemId) ?? zero;
      const effectiveAvailable = round(available.plus(reservedHere));

      const gross = agg.grossRequirement;
      const hasStockRecord = bals.length > 0;

      const { status, shortage, surplus } = classifyAvailability({
        hasStockRecord,
        gross,
        effectiveAvailable,
        expectedReceiptQuantity: expectedReceiptQty,
        expectedInTime: !!earliestExpectedDate &&
          this.expectedBeforeRequired(earliestExpectedDate),
      });

      // Reserved vs unreserved portion of the requirement.
      const reservedRequired = Prisma.Decimal.min(reservedHere, gross);
      const unreservedRequired = round(gross.minus(reservedRequired));

      switch (status) {
        case 'AVAILABLE':
          summary.available += 1;
          break;
        case 'EXPECTED_BEFORE_REQUIRED_DATE':
          summary.expected += 1;
          break;
        case 'SHORTAGE':
          summary.shortage += 1;
          break;
        default:
          summary.unknown += 1;
      }

      rows.push(
        new StockAvailabilityRowEntity({
          itemId: agg.itemId,
          itemCode: agg.itemCode,
          itemName: agg.itemName,
          unitOfMeasure: agg.unitOfMeasure,
          bomRevisionSources: [...agg.revisions],
          orderedProductQuantity: agg.orderedProductQuantity.toString(),
          baseRequirement: agg.baseRequirement.toString(),
          wastagePercent: agg.wastagePercent.toString(),
          wastageQuantity: agg.wastageQuantity.toString(),
          grossRequirement: gross.toString(),
          onHandQuantity: round(onHand).toString(),
          reservedQuantity: round(reserved).toString(),
          blockedQuantity: round(blocked).toString(),
          availableQuantity: available.toString(),
          reservedForThisKickoff: round(reservedHere).toString(),
          expectedReceiptQuantity: hasStockRecord
            ? round(expectedReceiptQty).toString()
            : null,
          expectedReceiptDate: earliestExpectedDate
            ? earliestExpectedDate.toISOString()
            : null,
          shortageQuantity: shortage.toString(),
          surplusQuantity: surplus.toString(),
          reservedRequiredQuantity: round(reservedRequired).toString(),
          unreservedRequiredQuantity: unreservedRequired.toString(),
          availabilityStatus: status,
        }),
      );
    }

    rows.sort((a, b) => a.itemCode.localeCompare(b.itemCode));

    return new StockAvailabilityReportEntity({
      kickoffId,
      generatedAt: report.generatedAt.toISOString(),
      quantityPrecision: report.quantityPrecision,
      bomSelections: report.bomSelections.map(
        (s) =>
          new BomSelectionEntity({
            orderLineItemId: s.orderLineItemId,
            productId: s.productId,
            productName: s.productName,
            productSku: s.productSku,
            orderedQuantity: s.orderedQuantity.toString(),
            bomId: s.bomId,
            bomRevisionNumber: s.bomRevisionNumber,
          }),
      ),
      rows,
      summary: new StockAvailabilitySummaryEntity({
        ...summary,
        totalItems: rows.length,
      }),
    });
  }

  /**
   * "Expected before required date": the MVP has no explicit required-by date on
   * the kickoff, so we treat any FUTURE-dated expected receipt as timely (a
   * receipt already in the past that hasn't landed is not counted as timely).
   */
  private expectedBeforeRequired(expectedDate: Date): boolean {
    return expectedDate.getTime() >= Date.now();
  }

  // ── Reservations (§9) ────────────────────────────────────────────────
  async createReservation(
    kickoffId: string,
    dto: CreateReservationDto,
    user: AuthenticatedUser,
  ): Promise<ReservationEntity> {
    await this.access.assertCanManageInventory(user);

    const [kickoff, item, store] = await Promise.all([
      this.prisma.projectKickoff.findUnique({
        where: { id: kickoffId },
        select: { id: true },
      }),
      this.prisma.item.findUnique({ where: { id: dto.itemId }, select: { id: true } }),
      this.prisma.storeLocation.findUnique({
        where: { id: dto.storeLocationId },
        select: { id: true },
      }),
    ]);
    if (!kickoff) throw new NotFoundException('Project kickoff not found');
    if (!item) throw new NotFoundException('Item not found');
    if (!store) throw new NotFoundException('Store location not found');
    if (dto.quantity <= 0) throw new BadRequestException('Reservation quantity must be positive');

    const qty = new Prisma.Decimal(dto.quantity);

    const reservation = await this.prisma.$transaction(async (tx) => {
      const balance = await tx.stockBalance.upsert({
        where: {
          itemId_storeLocationId: {
            itemId: dto.itemId,
            storeLocationId: dto.storeLocationId,
          },
        },
        create: { itemId: dto.itemId, storeLocationId: dto.storeLocationId },
        update: {},
      });
      const available = balance.onHandQuantity
        .minus(balance.reservedQuantity)
        .minus(balance.blockedQuantity);
      if (qty.greaterThan(available) && !dto.allowOverride) {
        throw new BadRequestException(
          'Reservation exceeds available stock at this location. Pass allowOverride to reserve anyway.',
        );
      }
      await tx.stockBalance.update({
        where: { id: balance.id },
        data: { reservedQuantity: balance.reservedQuantity.plus(qty) },
      });
      return tx.stockReservation.create({
        data: {
          kickoffId,
          itemId: dto.itemId,
          storeLocationId: dto.storeLocationId,
          quantity: qty,
          createdById: user.id,
        },
      });
    });

    return this.reservationEntity(reservation.id);
  }

  async listReservations(
    kickoffId: string,
    user: AuthenticatedUser,
  ): Promise<ReservationEntity[]> {
    await this.access.assertCanReadInventory(user);
    const rows = await this.prisma.stockReservation.findMany({
      where: { kickoffId },
      include: {
        item: { select: { itemCode: true, name: true } },
        storeLocation: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) =>
      this.mapReservation(r as ReservationRow),
    );
  }

  async cancelReservation(
    kickoffId: string,
    reservationId: string,
    user: AuthenticatedUser,
  ): Promise<void> {
    await this.access.assertCanManageInventory(user);
    const reservation = await this.prisma.stockReservation.findUnique({
      where: { id: reservationId },
    });
    if (!reservation || reservation.kickoffId !== kickoffId) {
      throw new NotFoundException('Reservation not found for this kickoff');
    }
    if (!reservation.isActive) {
      throw new BadRequestException('Reservation is already cancelled');
    }
    await this.prisma.$transaction(async (tx) => {
      const balance = await tx.stockBalance.findUnique({
        where: {
          itemId_storeLocationId: {
            itemId: reservation.itemId,
            storeLocationId: reservation.storeLocationId,
          },
        },
      });
      if (balance) {
        const nextReserved = balance.reservedQuantity.minus(reservation.quantity);
        await tx.stockBalance.update({
          where: { id: balance.id },
          data: {
            reservedQuantity: nextReserved.lessThan(0)
              ? new Prisma.Decimal(0)
              : nextReserved,
          },
        });
      }
      await tx.stockReservation.update({
        where: { id: reservationId },
        data: {
          isActive: false,
          cancelledById: user.id,
          cancelledAt: new Date(),
        },
      });
    });
  }

  private async reservationEntity(id: string): Promise<ReservationEntity> {
    const r = await this.prisma.stockReservation.findUniqueOrThrow({
      where: { id },
      include: {
        item: { select: { itemCode: true, name: true } },
        storeLocation: { select: { name: true } },
      },
    });
    return this.mapReservation(r as ReservationRow);
  }

  private mapReservation(r: ReservationRow): ReservationEntity {
    return new ReservationEntity({
      id: r.id,
      kickoffId: r.kickoffId,
      itemId: r.itemId,
      itemCode: r.item.itemCode,
      itemName: r.item.name,
      storeLocationId: r.storeLocationId,
      storeLocationName: r.storeLocation.name,
      quantity: r.quantity.toString(),
      isActive: r.isActive,
      createdById: r.createdById,
      createdAt: r.createdAt.toISOString(),
      cancelledAt: r.cancelledAt ? r.cancelledAt.toISOString() : null,
    });
  }
}

type ReservationRow = Prisma.StockReservationGetPayload<{
  include: {
    item: { select: { itemCode: true; name: true } };
    storeLocation: { select: { name: true } };
  };
}>;
