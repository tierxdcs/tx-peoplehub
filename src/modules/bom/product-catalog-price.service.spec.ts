import { Prisma } from '@prisma/client';
import { ProductCatalogPriceService } from './product-catalog-price.service';

/**
 * The catalog price is the number a salesperson quotes from, and this service is
 * the only thing that writes it without a human involved. The failures that
 * matter: repricing a product someone priced by hand (a quote already went out
 * at that number), and pricing off a cost that isn't actually settled.
 */

const D = (value: number | string) => new Prisma.Decimal(value);

function product(overrides: Record<string, unknown> = {}) {
  return {
    id: 'prod-1',
    targetMarginPercent: D(20),
    unitPrice: D(0),
    ...overrides,
  };
}

function setup(products: Record<string, unknown>[] = [product()]) {
  const client = {
    product: {
      findMany: jest.fn().mockResolvedValue(products),
      update: jest.fn().mockResolvedValue({}),
    },
  };
  return { service: new ProductCatalogPriceService(), client };
}

/** The product.update payloads written, in call order. */
const writes = (client: { product: { update: jest.Mock } }) =>
  client.product.update.mock.calls.map((c) => c[0]);

const complete = (amount: number | string) => ({
  amount: D(amount),
  isComplete: true,
});

describe('ProductCatalogPriceService.syncFromReleasedCost', () => {
  it('prices the product from the released cost at its target margin', async () => {
    const { service, client } = setup();
    await service.syncFromReleasedCost(
      client as never,
      'fg-1',
      complete('226989.00'),
    );

    expect(writes(client)).toHaveLength(1);
    expect(writes(client)[0]).toMatchObject({ where: { id: 'prod-1' } });
    expect(writes(client)[0].data.unitPrice.toString()).toBe('283736.25');
  });

  it('only ever considers products flagged for automatic pricing', async () => {
    // The filter is the whole guarantee: a human-priced product is never even
    // loaded, so it cannot be repriced by accident.
    const { service, client } = setup();
    await service.syncFromReleasedCost(client as never, 'fg-1', complete(1000));

    expect(client.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { itemId: 'fg-1', autoPricedFromBomCost: true },
      }),
    );
  });

  it('fills in the default target margin for a product that has none', async () => {
    const { service, client } = setup([
      product({ targetMarginPercent: null }),
    ]);
    await service.syncFromReleasedCost(client as never, 'fg-1', complete(800));

    const data = writes(client)[0].data;
    expect(data.targetMarginPercent.toString()).toBe('20');
    expect(data.unitPrice.toString()).toBe('1000');
  });

  it('does not price off an incomplete cost roll-up', async () => {
    // "Cost data incomplete" must stay visible rather than become a price that
    // silently omits whatever leaf has no cost yet.
    const { service, client } = setup();
    await service.syncFromReleasedCost(client as never, 'fg-1', {
      amount: D(500),
      isComplete: false,
    });
    await service.syncFromReleasedCost(client as never, 'fg-1', {
      amount: null,
      isComplete: true,
    });

    expect(client.product.findMany).not.toHaveBeenCalled();
    expect(client.product.update).not.toHaveBeenCalled();
  });

  it('leaves the price alone when the cost has not moved', async () => {
    // Released BOMs are re-costed on every refresh; an unchanged cost must not
    // bump updatedAt and make the catalog look like it was edited.
    const { service, client } = setup([
      product({ unitPrice: D('1000') }),
    ]);
    await service.syncFromReleasedCost(client as never, 'fg-1', complete(800));

    expect(client.product.update).not.toHaveBeenCalled();
  });

  it('writes the new price when the cost does move', async () => {
    const { service, client } = setup([product({ unitPrice: D('1000') })]);
    await service.syncFromReleasedCost(client as never, 'fg-1', complete(900));

    expect(writes(client)[0].data.unitPrice.toString()).toBe('1125');
  });

  it('prices every product built from the same item', async () => {
    // itemId is not unique on Product — one manufactured item can be sold as
    // more than one SKU, each with its own target margin.
    const { service, client } = setup([
      product({ id: 'prod-1', targetMarginPercent: D(20) }),
      product({ id: 'prod-2', targetMarginPercent: D(40) }),
    ]);
    await service.syncFromReleasedCost(client as never, 'fg-1', complete(600));

    expect(writes(client).map((w) => w.data.unitPrice.toString())).toEqual([
      '750',
      '1000',
    ]);
  });

  it('skips a product whose target margin makes it unpriceable', async () => {
    const { service, client } = setup([
      product({ id: 'prod-1', targetMarginPercent: D(100) }),
      product({ id: 'prod-2', targetMarginPercent: D(20) }),
    ]);
    await service.syncFromReleasedCost(client as never, 'fg-1', complete(600));

    // The unpriceable one is skipped without stopping the rest.
    expect(writes(client)).toHaveLength(1);
    expect(writes(client)[0].where).toEqual({ id: 'prod-2' });
  });
});
