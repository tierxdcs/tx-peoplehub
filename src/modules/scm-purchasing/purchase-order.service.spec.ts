import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { PurchaseOrderStatus, Role } from '@prisma/client';
import { PurchaseOrderService } from './purchase-order.service';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreatePurchaseOrderDto } from './dto/purchase-order.dto';

const ceo = {
  id: 'ceo-1',
  email: 'ceo@example.com',
  role: Role.SUPER_ADMIN,
  verticalId: null,
};

function poRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'po-1',
    poNumber: 'PO-2026-0001',
    status: PurchaseOrderStatus.PENDING_CEO_APPROVAL,
    supplierId: null,
    supplier: null,
    vendorId: null,
    vendor: null,
    adHocPartyName: 'One-off Fabricator',
    adHocContactInfo: 'contact@example.com',
    adHocPartyAddress: 'Bengaluru',
    ceoApprovedById: null,
    ceoApprovedAt: null,
    rejectedById: null,
    rejectedAt: null,
    rejectionComment: null,
    orderDate: new Date('2026-08-22'),
    expectedDeliveryDate: null,
    notes: null,
    createdById: 'scm-1',
    createdBy: { firstName: 'SCM', lastName: 'User' },
    issuedAt: null,
    cancelledAt: null,
    lines: [],
    createdAt: new Date('2026-08-22'),
    updatedAt: new Date('2026-08-22'),
    ...overrides,
  };
}

describe('PurchaseOrderService ad-hoc approval', () => {
  function setup(rows: ReturnType<typeof poRow>[] = [poRow(), poRow({
    status: PurchaseOrderStatus.DRAFT,
    ceoApprovedById: ceo.id,
    ceoApprovedAt: new Date('2026-08-22T12:00:00Z'),
  })]) {
    const prisma = {
      purchaseOrder: {
        findUnique: jest.fn().mockImplementation(() => Promise.resolve(rows.shift())),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const service = new PurchaseOrderService(
      prisma as never,
      { assertCanManagePurchaseOrders: jest.fn() } as never,
      {} as never,
    );
    return { service, prisma };
  }

  it('allows only CEO/SuperAdmin to approve the exception', async () => {
    const { service } = setup();
    await expect(
      service.approveAdHoc('po-1', { ...ceo, role: Role.MANAGER }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('approves a pending ad-hoc PO into the normal DRAFT path and stamps the actor', async () => {
    const { service, prisma } = setup();
    const result = await service.approveAdHoc('po-1', ceo);
    expect(prisma.purchaseOrder.update).toHaveBeenCalledWith({
      where: { id: 'po-1' },
      data: {
        status: PurchaseOrderStatus.DRAFT,
        ceoApprovedById: ceo.id,
        ceoApprovedAt: expect.any(Date),
      },
    });
    expect(result.status).toBe(PurchaseOrderStatus.DRAFT);
  });

  it('requires a non-blank comment when rejecting', async () => {
    const { service } = setup();
    await expect(
      service.rejectAdHoc('po-1', { comment: '   ' }, ceo),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a pending exception terminally with the reason and actor', async () => {
    const rejected = poRow({
      status: PurchaseOrderStatus.REJECTED,
      rejectedById: ceo.id,
      rejectedAt: new Date('2026-08-22T12:00:00Z'),
      rejectionComment: 'Use a qualified vendor',
    });
    const { service, prisma } = setup([poRow(), rejected]);
    const result = await service.rejectAdHoc(
      'po-1',
      { comment: ' Use a qualified vendor ' },
      ceo,
    );
    expect(prisma.purchaseOrder.update).toHaveBeenCalledWith({
      where: { id: 'po-1' },
      data: {
        status: PurchaseOrderStatus.REJECTED,
        rejectedById: ceo.id,
        rejectedAt: expect.any(Date),
        rejectionComment: 'Use a qualified vendor',
      },
    });
    expect(result.rejectionComment).toBe('Use a qualified vendor');
  });
});

describe('CreatePurchaseOrderDto ad-hoc contract', () => {
  it('accepts the ad-hoc party fields under whitelist validation', async () => {
    const dto = plainToInstance(CreatePurchaseOrderDto, {
      adHocPartyName: 'One-off Fabricator',
      adHocContactInfo: 'buyer@example.com',
      adHocPartyAddress: 'Bengaluru',
      lines: [{ itemId: 'item-1', orderedQuantity: 1, unitPrice: 100 }],
    });
    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    expect(errors).toEqual([]);
  });
});
