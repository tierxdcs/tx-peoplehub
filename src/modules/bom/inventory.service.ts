import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, StockBucket } from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { BomAccessService } from './bom-access.service';
import { StockAdjustmentDto } from './dto/bom.dto';
import {
  StockAdjustmentEntity,
  StockBalanceEntity,
  StoreLocationEntity,
} from './entities/bom.entity';

type BalanceRow = Prisma.StockBalanceGetPayload<{
  include: {
    item: { select: { itemCode: true; name: true; baseUnitOfMeasure: true } };
    storeLocation: { select: { name: true } };
  };
}>;

/**
 * Inventory MVP. availableQuantity is DERIVED (onHand - reserved - blocked),
 * never stored. All balance mutations run inside a transaction and re-read the
 * row inside it so concurrent adjustments/reservations don't clobber each other.
 */
@Injectable()
export class InventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: BomAccessService,
  ) {}

  static available(b: {
    onHandQuantity: Prisma.Decimal;
    reservedQuantity: Prisma.Decimal;
    blockedQuantity: Prisma.Decimal;
  }): Prisma.Decimal {
    return b.onHandQuantity.minus(b.reservedQuantity).minus(b.blockedQuantity);
  }

  async listStores(user: AuthenticatedUser): Promise<StoreLocationEntity[]> {
    await this.access.assertCanReadInventory(user);
    const rows = await this.prisma.storeLocation.findMany({
      orderBy: { code: 'asc' },
    });
    return rows.map(
      (r) =>
        new StoreLocationEntity({
          id: r.id,
          code: r.code,
          name: r.name,
          isActive: r.isActive,
        }),
    );
  }

  async listBalances(
    user: AuthenticatedUser,
    opts: { search?: string; storeLocationId?: string } = {},
  ): Promise<StockBalanceEntity[]> {
    await this.access.assertCanReadInventory(user);
    const where: Prisma.StockBalanceWhereInput = {};
    if (opts.storeLocationId) where.storeLocationId = opts.storeLocationId;
    if (opts.search) {
      where.item = {
        OR: [
          { itemCode: { contains: opts.search, mode: 'insensitive' } },
          { name: { contains: opts.search, mode: 'insensitive' } },
        ],
      };
    }
    const rows = await this.prisma.stockBalance.findMany({
      where,
      include: {
        item: { select: { itemCode: true, name: true, baseUnitOfMeasure: true } },
        storeLocation: { select: { name: true } },
      },
      orderBy: [{ item: { itemCode: 'asc' } }],
    });
    return rows.map((r) => this.toBalanceEntity(r));
  }

  /** Every balance row for one item, across locations. */
  async balancesForItem(
    itemId: string,
    user: AuthenticatedUser,
  ): Promise<StockBalanceEntity[]> {
    await this.access.assertCanReadInventory(user);
    const item = await this.prisma.item.findUnique({
      where: { id: itemId },
      select: { id: true },
    });
    if (!item) throw new NotFoundException('Item not found');
    const rows = await this.prisma.stockBalance.findMany({
      where: { itemId },
      include: {
        item: { select: { itemCode: true, name: true, baseUnitOfMeasure: true } },
        storeLocation: { select: { name: true } },
      },
      orderBy: { storeLocation: { code: 'asc' } },
    });
    return rows.map((r) => this.toBalanceEntity(r));
  }

  /**
   * Apply a signed stock adjustment to a bucket (ON_HAND or BLOCKED). Reserved
   * is never adjusted directly — it moves only via reservations. Validates the
   * resulting bucket quantity is not negative. Transactional + append-only
   * history row.
   */
  async adjust(
    dto: StockAdjustmentDto,
    user: AuthenticatedUser,
  ): Promise<StockBalanceEntity> {
    await this.access.assertCanManageInventory(user);

    const [item, store] = await Promise.all([
      this.prisma.item.findUnique({ where: { id: dto.itemId }, select: { id: true } }),
      this.prisma.storeLocation.findUnique({
        where: { id: dto.storeLocationId },
        select: { id: true },
      }),
    ]);
    if (!item) throw new NotFoundException('Item not found');
    if (!store) throw new NotFoundException('Store location not found');

    const bucket = dto.bucket ?? StockBucket.ON_HAND;
    const delta = new Prisma.Decimal(dto.quantityChange);

    await this.prisma.$transaction(async (tx) => {
      // Upsert the balance row, then re-read inside the txn for a fresh value.
      const balance = await tx.stockBalance.upsert({
        where: {
          itemId_storeLocationId: {
            itemId: dto.itemId,
            storeLocationId: dto.storeLocationId,
          },
        },
        create: {
          itemId: dto.itemId,
          storeLocationId: dto.storeLocationId,
        },
        update: {},
      });

      const nextOnHand =
        bucket === StockBucket.ON_HAND
          ? balance.onHandQuantity.plus(delta)
          : balance.onHandQuantity;
      const nextBlocked =
        bucket === StockBucket.BLOCKED
          ? balance.blockedQuantity.plus(delta)
          : balance.blockedQuantity;

      if (nextOnHand.lessThan(0)) {
        throw new BadRequestException('On-hand quantity cannot go negative');
      }
      if (nextBlocked.lessThan(0)) {
        throw new BadRequestException('Blocked quantity cannot go negative');
      }
      // Available must not go negative either (reserved could exceed new on-hand).
      const nextAvailable = nextOnHand
        .minus(balance.reservedQuantity)
        .minus(nextBlocked);
      if (nextAvailable.lessThan(0)) {
        throw new BadRequestException(
          'Adjustment would make available stock negative (reserved exceeds remaining on-hand)',
        );
      }

      const updateData: Prisma.StockBalanceUpdateInput = {};
      if (bucket === StockBucket.ON_HAND) updateData.onHandQuantity = nextOnHand;
      if (bucket === StockBucket.BLOCKED) updateData.blockedQuantity = nextBlocked;
      if (dto.expectedReceiptQuantity !== undefined) {
        updateData.expectedReceiptQuantity = new Prisma.Decimal(
          dto.expectedReceiptQuantity,
        );
      }
      if (dto.expectedReceiptDate !== undefined) {
        updateData.expectedReceiptDate = dto.expectedReceiptDate
          ? new Date(dto.expectedReceiptDate)
          : null;
      }

      await tx.stockBalance.update({
        where: { id: balance.id },
        data: updateData,
      });
      await tx.stockAdjustment.create({
        data: {
          itemId: dto.itemId,
          storeLocationId: dto.storeLocationId,
          bucket,
          quantityChange: delta,
          reason: dto.reason,
          actorId: user.id,
        },
      });
    });

    const fresh = await this.prisma.stockBalance.findFirstOrThrow({
      where: { itemId: dto.itemId, storeLocationId: dto.storeLocationId },
      include: {
        item: { select: { itemCode: true, name: true, baseUnitOfMeasure: true } },
        storeLocation: { select: { name: true } },
      },
    });
    return this.toBalanceEntity(fresh);
  }

  /**
   * Reservation-aware STOCK_OUT, composed INTO a caller's transaction (so the
   * caller can create its own record — e.g. a MaterialIssueNote — atomically
   * with the stock movement). This is the single implementation of the
   * "can I take this stock out?" rule; Material Issue reuses it rather than
   * re-deriving availability.
   *
   * The rule (same `available()` used everywhere): an issue may consume the
   * unreserved available stock (onHand − reserved − blocked) PLUS the quantity
   * reserved for THIS kickoff (if `kickoffId` is given). It may NEVER consume
   * stock reserved for a different project — that reserved quantity is simply
   * not part of this issue's effective availability, so the guard rejects it.
   *
   * Whatever portion is drawn from this kickoff's own reservation is released
   * (both the aggregate balance.reservedQuantity and the StockReservation rows,
   * FIFO) as part of the same movement, keeping availability consistent for the
   * next issue.
   */
  async issueStockOutTx(
    tx: Prisma.TransactionClient,
    params: {
      itemId: string;
      storeLocationId: string;
      quantity: Prisma.Decimal;
      reason: string;
      actorId: string;
      /** When set, this kickoff's own reservations are drawable. */
      kickoffId?: string | null;
    },
  ): Promise<void> {
    const { itemId, storeLocationId, quantity, reason, actorId, kickoffId } =
      params;
    if (quantity.lessThanOrEqualTo(0)) {
      throw new BadRequestException('Issue quantity must be positive');
    }

    const balance = await tx.stockBalance.upsert({
      where: { itemId_storeLocationId: { itemId, storeLocationId } },
      create: { itemId, storeLocationId },
      update: {},
    });

    const available = InventoryService.available(balance);

    // Reservations belonging to THIS kickoff at THIS location are earmarked for
    // this project and therefore drawable by this issue. Reservations for any
    // other project are not, so they never enter effectiveAvailable.
    let reservedForThisKickoff = new Prisma.Decimal(0);
    if (kickoffId) {
      const own = await tx.stockReservation.findMany({
        where: { kickoffId, itemId, storeLocationId, isActive: true },
        orderBy: { createdAt: 'asc' },
      });
      reservedForThisKickoff = own.reduce(
        (s, r) => s.plus(r.quantity),
        new Prisma.Decimal(0),
      );
    }
    const effectiveAvailable = available.plus(reservedForThisKickoff);

    if (quantity.greaterThan(effectiveAvailable)) {
      throw new BadRequestException(
        `Issue of ${quantity} exceeds issuable stock (${effectiveAvailable}) at this location — it would drive available stock negative or consume material reserved for another project`,
      );
    }

    // Portion that has to come out of this kickoff's reservation (only once the
    // unreserved available is exhausted). Bounded by reservedForThisKickoff via
    // the guard above.
    const fromReservation = quantity.greaterThan(available)
      ? quantity.minus(available)
      : new Prisma.Decimal(0);

    await tx.stockBalance.update({
      where: { id: balance.id },
      data: {
        onHandQuantity: balance.onHandQuantity.minus(quantity),
        reservedQuantity: balance.reservedQuantity.minus(fromReservation),
      },
    });

    // Consume this kickoff's StockReservation rows FIFO for the drawn portion,
    // so reservedForThisKickoff stays accurate for subsequent issues.
    if (fromReservation.greaterThan(0) && kickoffId) {
      let remaining = fromReservation;
      const own = await tx.stockReservation.findMany({
        where: { kickoffId, itemId, storeLocationId, isActive: true },
        orderBy: { createdAt: 'asc' },
      });
      for (const r of own) {
        if (remaining.lessThanOrEqualTo(0)) break;
        const take = Prisma.Decimal.min(remaining, r.quantity);
        const nextQty = r.quantity.minus(take);
        await tx.stockReservation.update({
          where: { id: r.id },
          data: {
            quantity: nextQty,
            ...(nextQty.lessThanOrEqualTo(0)
              ? { isActive: false, cancelledById: actorId, cancelledAt: new Date() }
              : {}),
          },
        });
        remaining = remaining.minus(take);
      }
    }

    await tx.stockAdjustment.create({
      data: {
        itemId,
        storeLocationId,
        bucket: StockBucket.ON_HAND,
        quantityChange: quantity.negated(),
        reason,
        actorId,
      },
    });
  }

  async adjustmentHistory(
    itemId: string,
    user: AuthenticatedUser,
  ): Promise<StockAdjustmentEntity[]> {
    await this.access.assertCanReadInventory(user);
    const rows = await this.prisma.stockAdjustment.findMany({
      where: { itemId },
      include: { actor: { select: { firstName: true, lastName: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return rows.map(
      (r) =>
        new StockAdjustmentEntity({
          id: r.id,
          itemId: r.itemId,
          storeLocationId: r.storeLocationId,
          bucket: r.bucket,
          quantityChange: r.quantityChange.toString(),
          reason: r.reason,
          actorId: r.actorId,
          actorName: r.actor
            ? `${r.actor.firstName} ${r.actor.lastName}`.trim()
            : null,
          createdAt: r.createdAt.toISOString(),
        }),
    );
  }

  private toBalanceEntity(r: BalanceRow): StockBalanceEntity {
    return new StockBalanceEntity({
      id: r.id,
      itemId: r.itemId,
      itemCode: r.item.itemCode,
      itemName: r.item.name,
      baseUnitOfMeasure: r.item.baseUnitOfMeasure,
      storeLocationId: r.storeLocationId,
      storeLocationName: r.storeLocation.name,
      onHandQuantity: r.onHandQuantity.toString(),
      reservedQuantity: r.reservedQuantity.toString(),
      blockedQuantity: r.blockedQuantity.toString(),
      availableQuantity: InventoryService.available(r).toString(),
      expectedReceiptQuantity: r.expectedReceiptQuantity
        ? r.expectedReceiptQuantity.toString()
        : null,
      expectedReceiptDate: r.expectedReceiptDate
        ? r.expectedReceiptDate.toISOString()
        : null,
      updatedAt: r.updatedAt.toISOString(),
    });
  }
}
