import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { catalogPriceFromCost } from '../sales/product-margin';
import { BomCostSnapshot } from './bom-cost-snapshot.service';

/**
 * Keeps the sellable catalog price of a product in step with the cost its
 * released BOM rolls up to.
 *
 * The cost is not typed by anyone: it arrives from awarded RFQ quotes, flows
 * through ItemCostService into the BOM's rolled-up snapshot, and lands here. So
 * a product created by the customer-BOM-intake / RFQ flow would otherwise sit in
 * the catalog at ₹0.00 with a real cost beside it. This writes the cost-plus
 * price at the product's target margin (defaulting to
 * DEFAULT_TARGET_MARGIN_PERCENT) every time that cost moves.
 *
 * The one invariant: it only ever touches products flagged
 * autoPricedFromBomCost. A price a person typed is theirs, and is never
 * silently repriced.
 *
 * Lives in the bom module rather than sales because both callers (BOM release
 * and the released-snapshot refresh) are here, and importing sales services into
 * bom would close a module cycle.
 */
@Injectable()
export class ProductCatalogPriceService {
  /**
   * Reprice every auto-priced product built from `itemId` against a freshly
   * calculated cost snapshot. Takes the client so it can join the BOM-release
   * transaction: the price and the cost it derives from land together or not at
   * all. Safe to call with an incomplete or absent cost — it does nothing,
   * leaving the "Cost data incomplete" state visible rather than pricing off a
   * partial roll-up.
   */
  async syncFromReleasedCost(
    client: Prisma.TransactionClient,
    itemId: string,
    snapshot: BomCostSnapshot,
  ): Promise<void> {
    if (!snapshot.isComplete || snapshot.amount === null) return;
    // itemId is not unique on Product, so more than one sellable product can be
    // built from the same manufactured item.
    const products = await client.product.findMany({
      where: { itemId, autoPricedFromBomCost: true },
      select: { id: true, targetMarginPercent: true, unitPrice: true },
    });
    for (const product of products) {
      const priced = catalogPriceFromCost(
        snapshot.amount,
        product.targetMarginPercent,
      );
      if (!priced) continue;
      // Skip the write when nothing actually moved, so an unchanged cost does
      // not bump updatedAt on every BOM release.
      if (
        product.unitPrice.equals(priced.unitPrice) &&
        product.targetMarginPercent !== null
      ) {
        continue;
      }
      await client.product.update({
        where: { id: product.id },
        data: {
          unitPrice: priced.unitPrice,
          targetMarginPercent: priced.targetMarginPercent,
        },
      });
    }
  }
}
