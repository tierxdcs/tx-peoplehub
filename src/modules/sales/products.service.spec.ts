import { ConflictException } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { ProductsService } from './products.service';

describe('ProductsService catalogue search', () => {
  const user = {
    id: 'admin-1',
    email: 'admin@example.com',
    role: Role.SUPER_ADMIN,
    verticalId: null,
  };

  it('searches SKU and name across the complete catalogue without excluding inactive products', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const count = jest.fn().mockResolvedValue(0);
    const prisma = {
      product: { findMany, count },
      $transaction: jest.fn((queries: Array<Promise<unknown>>) =>
        Promise.all(queries),
      ),
    };
    const service = new ProductsService(
      prisma as never,
      {} as never,
      {} as never,
    );

    await service.findAll(
      { page: 1, limit: 20, skip: 0, search: 'phtpost-2' } as never,
      user,
    );

    const expectedWhere = {
      OR: [
        { sku: { contains: 'phtpost-2', mode: 'insensitive' } },
        { name: { contains: 'phtpost-2', mode: 'insensitive' } },
      ],
    };
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expectedWhere }),
    );
    expect(count).toHaveBeenCalledWith({ where: expectedWhere });
    expect(findMany.mock.calls[0][0].where).not.toHaveProperty('isActive');
  });
});

describe('ProductsService SKU updates', () => {
  const user = {
    id: 'admin-1',
    email: 'admin@example.com',
    role: Role.SUPER_ADMIN,
    verticalId: null,
  };

  const existingProduct = {
    id: 'product-1',
    sku: 'OLD-SKU',
    name: 'Product',
    description: null,
    unitPrice: new Prisma.Decimal(100),
    unitOfMeasure: 'NOS',
    hsnCode: null,
    isActive: true,
    itemId: null,
    businessUnitId: 'bu-1',
    autoAssignedBusinessUnit: false,
    targetMarginPercent: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    businessUnit: { name: 'Infrastructure', colorHex: '#123456' },
    item: null,
  };

  function setup() {
    const prisma = {
      product: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };
    const service = new ProductsService(
      prisma as never,
      {} as never,
      {} as never,
    );
    return { prisma, service };
  }

  it('persists a changed, available SKU', async () => {
    const { prisma, service } = setup();
    const updatedProduct = { ...existingProduct, sku: 'NEW-SKU' };
    prisma.product.findUnique
      .mockResolvedValueOnce(existingProduct)
      .mockResolvedValueOnce(null);
    prisma.product.update.mockResolvedValue(updatedProduct);

    const result = await service.update(
      existingProduct.id,
      { sku: 'NEW-SKU' },
      user,
    );

    expect(prisma.product.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: existingProduct.id },
        data: expect.objectContaining({ sku: 'NEW-SKU' }),
      }),
    );
    expect(result.sku).toBe('NEW-SKU');
  });

  it('rejects a SKU already assigned to another product', async () => {
    const { prisma, service } = setup();
    prisma.product.findUnique
      .mockResolvedValueOnce(existingProduct)
      .mockResolvedValueOnce({ id: 'product-2' });

    await expect(
      service.update(existingProduct.id, { sku: 'TAKEN-SKU' }, user),
    ).rejects.toThrow(
      new ConflictException('A product with SKU TAKEN-SKU already exists'),
    );
    expect(prisma.product.update).not.toHaveBeenCalled();
  });
});

describe('ProductsService deletion', () => {
  const user = {
    id: 'admin-1',
    email: 'admin@example.com',
    role: Role.SUPER_ADMIN,
    verticalId: null,
  };

  const existingProduct = {
    id: 'product-1',
    sku: 'SKU-001',
    name: 'Unused product',
    description: null,
    unitPrice: new Prisma.Decimal(100),
    unitOfMeasure: 'NOS',
    hsnCode: null,
    isActive: true,
    itemId: null,
    businessUnitId: 'bu-1',
    autoAssignedBusinessUnit: false,
    targetMarginPercent: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    businessUnit: { name: 'Infrastructure', colorHex: '#123456' },
    item: null,
  };

  function setup(referenceCounts: Partial<Record<string, number>> = {}) {
    const count = (key: string) =>
      jest.fn().mockResolvedValue(referenceCounts[key] ?? 0);
    const tx = {
      bidLineItem: { count: count('bidLineItem') },
      orderLineItem: { count: count('orderLineItem') },
      salesInvoiceLine: { count: count('salesInvoiceLine') },
      customerBomIntake: { count: count('customerBomIntake') },
      designRequest: { count: count('designRequest') },
      designProject: { count: count('designProject') },
      kickoffBomSelection: { count: count('kickoffBomSelection') },
      qmsInspectionPlan: { count: count('qmsInspectionPlan') },
      qmsInspection: { count: count('qmsInspection') },
      qmsNonConformance: { count: count('qmsNonConformance') },
      qmsCustomerComplaint: { count: count('qmsCustomerComplaint') },
      product: { delete: jest.fn().mockResolvedValue(existingProduct) },
    };
    const prisma = {
      product: { findUnique: jest.fn().mockResolvedValue(existingProduct) },
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
        callback(tx),
      ),
    };
    const service = new ProductsService(
      prisma as never,
      {} as never,
      {} as never,
    );
    return { prisma, service, tx };
  }

  it('permanently deletes a product with no references', async () => {
    const { service, tx } = setup();

    await expect(service.remove(existingProduct.id, user)).resolves.toEqual({
      id: existingProduct.id,
      deleted: true,
    });
    expect(tx.product.delete).toHaveBeenCalledWith({
      where: { id: existingProduct.id },
    });
  });

  it('blocks deletion and identifies every discovered reference category', async () => {
    const { service, tx } = setup({
      orderLineItem: 2,
      qmsInspection: 1,
    });

    await expect(service.remove(existingProduct.id, user)).rejects.toThrow(
      'This product cannot be deleted because it is used by: order lines (2), quality inspections (1). Mark it inactive instead to preserve history.',
    );
    expect(tx.product.delete).not.toHaveBeenCalled();
  });
});

describe('ProductsService automatic pricing hand-off', () => {
  const user = {
    id: 'admin-1',
    email: 'admin@example.com',
    role: Role.SUPER_ADMIN,
    verticalId: null,
  };

  const existingProduct = {
    id: 'product-1',
    sku: 'FG-00004',
    name: 'Liquid Cooling Complete Unit',
    description: null,
    unitPrice: new Prisma.Decimal(0),
    unitOfMeasure: 'NOS',
    hsnCode: null,
    isActive: true,
    itemId: 'item-1',
    businessUnitId: 'bu-1',
    autoAssignedBusinessUnit: false,
    autoPricedFromBomCost: true,
    targetMarginPercent: new Prisma.Decimal(20),
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    businessUnit: { name: 'Infrastructure', colorHex: '#123456' },
    item: null,
  };

  function setup() {
    const prisma = {
      product: {
        findUnique: jest.fn().mockResolvedValue(existingProduct),
        update: jest.fn().mockResolvedValue(existingProduct),
        create: jest.fn().mockResolvedValue(existingProduct),
      },
      item: { findUnique: jest.fn().mockResolvedValue({ id: 'item-1' }) },
      businessUnit: { findUnique: jest.fn().mockResolvedValue({ isActive: true }) },
    };
    const access = { assertSalesAccess: jest.fn(), isSalesStaff: jest.fn() };
    const service = new ProductsService(
      prisma as never,
      access as never,
      {} as never,
    );
    return { prisma, service };
  }

  /** The data payload of the single write the call made. */
  const written = (fn: jest.Mock) => fn.mock.calls[0][0].data;

  it('takes a product off automatic pricing once someone enters a price', async () => {
    // The point of the flag: this price may already have been quoted, so no
    // later BOM release is allowed to move it.
    const { prisma, service } = setup();
    await service.update('product-1', { unitPrice: 231621.43 } as never, user);
    expect(written(prisma.product.update)).toMatchObject({
      autoPricedFromBomCost: false,
    });
    expect(written(prisma.product.update).unitPrice.toString()).toBe(
      '231621.43',
    );
  });

  it('reads a price of zero as "not priced yet", not as a decision', async () => {
    const { prisma, service } = setup();
    await service.update('product-1', { unitPrice: 0 } as never, user);
    expect(written(prisma.product.update)).toMatchObject({
      autoPricedFromBomCost: true,
    });
  });

  it('leaves the pricing mode untouched when the payload has no price', async () => {
    const { prisma, service } = setup();
    await service.update('product-1', { name: 'Renamed' } as never, user);
    expect(written(prisma.product.update)).not.toHaveProperty(
      'autoPricedFromBomCost',
    );
    expect(written(prisma.product.update)).not.toHaveProperty('unitPrice');
  });

  it('lets a manually created product start on automatic pricing only if unpriced', async () => {
    const { prisma, service } = setup();
    prisma.product.findUnique.mockResolvedValue(null);
    await service.create(
      {
        sku: 'FG-00009',
        name: 'New product',
        unitPrice: 0,
        unitOfMeasure: 'NOS',
        businessUnitId: 'bu-1',
      } as never,
      user,
    );
    expect(written(prisma.product.create)).toMatchObject({
      autoPricedFromBomCost: true,
    });

    prisma.product.create.mockClear();
    await service.create(
      {
        sku: 'FG-00010',
        name: 'Priced product',
        unitPrice: 4500,
        unitOfMeasure: 'NOS',
        businessUnitId: 'bu-1',
      } as never,
      user,
    );
    expect(written(prisma.product.create)).toMatchObject({
      autoPricedFromBomCost: false,
    });
  });

  it('reports the pricing mode to anyone who can see the price, not just Finance', async () => {
    // A Sales user sees no cost fields but must still know whether the price is
    // theirs to own — so this one is deliberately outside the cost gate.
    const salesUser = { ...user, role: Role.MANAGER };
    const access = { assertSalesAccess: jest.fn(), isSalesStaff: jest.fn() };
    const financeAccess = {
      accessFor: jest.fn().mockResolvedValue({ isFinanceUser: false }),
    };
    const prisma = {
      product: { findUnique: jest.fn().mockResolvedValue(existingProduct) },
    };
    const salesService = new ProductsService(
      prisma as never,
      access as never,
      financeAccess as never,
    );
    const entity = await salesService.findOne('product-1', salesUser as never);
    expect(entity.autoPricedFromBomCost).toBe(true);
    expect(entity.targetMarginPercent).toBeUndefined();
  });
});
