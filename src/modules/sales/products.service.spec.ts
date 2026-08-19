import { ConflictException } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { ProductsService } from './products.service';

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
