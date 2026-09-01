import { Injectable } from '@nestjs/common';
import { BomStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { ExplodableBom, explodeProcurementBom } from './bom-explosion';
import { ItemCostService } from './item-cost.service';
import { ProductCatalogPriceService } from './product-catalog-price.service';

export interface BomCostSnapshot {
  amount: Prisma.Decimal | null;
  isComplete: boolean;
}

@Injectable()
export class BomCostSnapshotService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly itemCosts: ItemCostService,
    private readonly catalogPrice: ProductCatalogPriceService,
  ) {}

  async calculate(
    topItemId: string,
    pendingBomId?: string,
  ): Promise<BomCostSnapshot> {
    const rows = await this.prisma.bom.findMany({
      where: pendingBomId
        ? { OR: [{ status: BomStatus.RELEASED }, { id: pendingBomId }] }
        : { status: BomStatus.RELEASED },
      orderBy: { revisionNumber: 'desc' },
      select: {
        id: true,
        itemId: true,
        revisionNumber: true,
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
    for (const row of rows) {
      if (row.id !== pendingBomId && byItem.has(row.itemId)) continue;
      byItem.set(row.itemId, row);
    }
    const leaves = explodeProcurementBom(
      topItemId,
      (itemId) => byItem.get(itemId) ?? null,
    );
    let total = new Prisma.Decimal(0);
    let isComplete = true;
    for (const leaf of leaves) {
      const cost = await this.itemCosts.currentCost(leaf.itemId);
      if (cost.amount === null) {
        isComplete = false;
        continue;
      }
      total = total.plus(leaf.quantityPerTopUnit.times(cost.amount));
    }
    return {
      amount: isComplete
        ? total.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
        : null,
      isComplete,
    };
  }

  /** Cost changes are not design changes: refresh released revisions in place. */
  async refreshReleasedSnapshots(): Promise<void> {
    const released = await this.prisma.bom.findMany({
      where: { status: BomStatus.RELEASED },
      select: { id: true, itemId: true },
    });
    for (const bom of released) {
      const snapshot = await this.calculate(bom.itemId);
      await this.prisma.bom.update({
        where: { id: bom.id },
        data: {
          rolledUpCostSnapshot: snapshot.amount,
          isCostComplete: snapshot.isComplete,
          costSnapshotAt: new Date(),
        },
      });
      // A cost that moved after release (a late GRN, a re-awarded RFQ) moves the
      // auto-priced catalog price with it.
      await this.catalogPrice.syncFromReleasedCost(
        this.prisma,
        bom.itemId,
        snapshot,
      );
    }

    // Resource-plan benchmarks are also cost snapshots, not design state.
    // Refresh them in place so late GRN/manual costs become visible without
    // regenerating the plan or changing any negotiated values.
    const planLines = await this.prisma.projectResourcePlanLine.findMany({
      select: { id: true, itemId: true },
    });
    for (const line of planLines) {
      const cost = await this.itemCosts.currentCost(line.itemId);
      await this.prisma.projectResourcePlanLine.update({
        where: { id: line.id },
        data: {
          benchmarkCostPerUnit: cost.amount,
          isCostComplete: cost.amount !== null,
        },
      });
    }
  }
}
