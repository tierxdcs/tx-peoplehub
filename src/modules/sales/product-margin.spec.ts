import { Prisma } from '@prisma/client';
import { actualMarginPercent, suggestedSellingPrice } from './product-margin';

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
