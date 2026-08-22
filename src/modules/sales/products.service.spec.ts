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
