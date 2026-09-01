import { Prisma } from '@prisma/client';
import {
  DEFAULT_TARGET_MARGIN_PERCENT,
  actualMarginPercent,
  catalogPriceFromCost,
  suggestedSellingPrice,
} from './product-margin';

const D = (value: number | string) => new Prisma.Decimal(value);

describe('product margin calculations', () => {
  it('suggests selling price from cost and target margin', () => {
    expect(
      suggestedSellingPrice(
        new Prisma.Decimal(800),
        new Prisma.Decimal(20),
      )?.toString(),
    ).toBe('1000');
  });

  it('reports actual margin after a manual price override', () => {
    expect(
      actualMarginPercent(
        new Prisma.Decimal(800),
        new Prisma.Decimal(1200),
      )?.toString(),
    ).toBe('33.33');
  });
});

describe('catalogPriceFromCost', () => {
  it('prices at the default margin when the product has no target of its own', () => {
    // Margin on selling price, not markup on cost: 226989 / 0.8, NOT × 1.2.
    // Getting that backwards would under-price every RFQ-derived product.
    const priced = catalogPriceFromCost(D('226989.00'), null);
    expect(priced?.unitPrice.toString()).toBe('283736.25');
    expect(priced?.targetMarginPercent.toString()).toBe(
      String(DEFAULT_TARGET_MARGIN_PERCENT),
    );
  });

  it("honours a product's own target over the default", () => {
    const priced = catalogPriceFromCost(D(800), D(35));
    expect(priced?.unitPrice.toString()).toBe('1230.77');
    expect(priced?.targetMarginPercent.toString()).toBe('35');
  });

  it('refuses to price without a real cost', () => {
    // Pricing off a zero or absent cost would put a ₹0.00 product in front of a
    // salesperson as though it had been priced.
    expect(catalogPriceFromCost(null, D(20))).toBeNull();
    expect(catalogPriceFromCost(D(0), D(20))).toBeNull();
    expect(catalogPriceFromCost(D(-5), D(20))).toBeNull();
  });

  it('refuses a margin no finite price can reach', () => {
    expect(catalogPriceFromCost(D(800), D(100))).toBeNull();
    expect(catalogPriceFromCost(D(800), D(140))).toBeNull();
  });

  it('rounds to the paise the price column stores', () => {
    expect(catalogPriceFromCost(D(1000), D(20))?.unitPrice.toString()).toBe(
      '1250',
    );
    expect(catalogPriceFromCost(D('333.33'), D(20))?.unitPrice.toString()).toBe(
      '416.66',
    );
  });
});
