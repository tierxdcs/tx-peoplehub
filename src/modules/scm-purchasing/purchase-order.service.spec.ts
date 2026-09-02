import { BadRequestException, ForbiddenException } from '@nestjs/common';
import {
  PurchaseOrderApprovalLevel,
  PurchaseOrderApprovalStatus,
  PurchaseOrderStatus,
  Prisma,
  Role,
} from '@prisma/client';
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
    approvalAmount: null,
    approvals: [],
    lastEmailedAt: null,
    lastEmailedTo: null,
    lines: [],
    createdAt: new Date('2026-08-22'),
    updatedAt: new Date('2026-08-22'),
    ...overrides,
  };
}

describe('PurchaseOrderService value-based approval', () => {
  function setup(rows: ReturnType<typeof poRow>[] = []) {
    const tx = {
      purchaseOrder: {
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      purchaseOrderApproval: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const prisma = {
      purchaseOrder: {
        findUnique: jest
          .fn()
          .mockImplementation(() => Promise.resolve(rows.shift())),
        update: jest.fn().mockResolvedValue({}),
      },
      employee: {
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      $transaction: jest.fn().mockImplementation((fn) => fn(tx)),
    };
    const service = new PurchaseOrderService(
      prisma as never,
      { assertCanManagePurchaseOrders: jest.fn() } as never,
      {} as never,
      { approvalRequired: jest.fn() } as never,
    );
    return { service, prisma, tx };
  }

  it.each([
    [2_500_000, [PurchaseOrderApprovalLevel.CSCO]],
    [
      2_500_001,
      [PurchaseOrderApprovalLevel.CSCO, PurchaseOrderApprovalLevel.COO],
    ],
    [
      5_000_000,
      [PurchaseOrderApprovalLevel.CSCO, PurchaseOrderApprovalLevel.COO],
    ],
    [
      5_000_001,
      [
        PurchaseOrderApprovalLevel.CSCO,
        PurchaseOrderApprovalLevel.COO,
        PurchaseOrderApprovalLevel.CEO,
      ],
    ],
  ])('routes ₹%s through the correct ladder', async (amount, levels) => {
    const draft = poRow({
      status: PurchaseOrderStatus.DRAFT,
      supplierId: 'supplier-1',
      lines: [{ lineTotal: new Prisma.Decimal(amount) }],
    });
    const result = poRow({ status: PurchaseOrderStatus.PENDING_CSCO_APPROVAL });
    const { service, tx } = setup([draft, result]);

    await service.submitForApproval('po-1', {
      ...ceo,
      role: Role.MANAGER,
    });

    expect(tx.purchaseOrderApproval.createMany).toHaveBeenCalledWith({
      data: levels.map((level, index) =>
        expect.objectContaining({
          level,
          sequence: index + 1,
          status:
            index === 0
              ? PurchaseOrderApprovalStatus.PENDING
              : PurchaseOrderApprovalStatus.WAITING,
        }),
      ),
    });
  });

  it('always adds CEO approval for an ad-hoc party', async () => {
    const draft = poRow({
      status: PurchaseOrderStatus.DRAFT,
      lines: [{ lineTotal: new Prisma.Decimal(100) }],
    });
    const { service, tx } = setup([
      draft,
      poRow({ status: PurchaseOrderStatus.PENDING_CSCO_APPROVAL }),
    ]);

    await service.submitForApproval('po-1', { ...ceo, role: Role.MANAGER });

    expect(tx.purchaseOrderApproval.createMany.mock.calls[0][0].data).toEqual([
      expect.objectContaining({ level: PurchaseOrderApprovalLevel.CSCO }),
      expect.objectContaining({ level: PurchaseOrderApprovalLevel.CEO }),
    ]);
  });

  it('restricts COO approval to an active Production Head', async () => {
    const pending = poRow({
      status: PurchaseOrderStatus.PENDING_COO_APPROVAL,
      approvals: [
        {
          id: 'approval-2',
          level: PurchaseOrderApprovalLevel.COO,
          sequence: 2,
          status: PurchaseOrderApprovalStatus.PENDING,
        },
      ],
    });
    const { service, prisma } = setup([pending]);
    prisma.employee.findUnique.mockResolvedValue({
      status: 'ACTIVE',
      isScmHead: true,
      isProductionHead: false,
    });

    await expect(
      service.approve('po-1', { ...ceo, role: Role.MANAGER }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('advances CSCO approval to the waiting COO step', async () => {
    const pending = poRow({
      status: PurchaseOrderStatus.PENDING_CSCO_APPROVAL,
      approvals: [
        {
          id: 'approval-1',
          level: PurchaseOrderApprovalLevel.CSCO,
          sequence: 1,
          status: PurchaseOrderApprovalStatus.PENDING,
        },
        {
          id: 'approval-2',
          level: PurchaseOrderApprovalLevel.COO,
          sequence: 2,
          status: PurchaseOrderApprovalStatus.WAITING,
        },
      ],
    });
    const { service, prisma, tx } = setup([
      pending,
      poRow({ status: PurchaseOrderStatus.PENDING_COO_APPROVAL }),
    ]);
    prisma.employee.findUnique.mockResolvedValue({
      status: 'ACTIVE',
      isScmHead: true,
      isProductionHead: false,
    });

    await service.approve('po-1', { ...ceo, role: Role.MANAGER });

    expect(tx.purchaseOrderApproval.update).toHaveBeenCalledWith({
      where: { id: 'approval-2' },
      data: { status: PurchaseOrderApprovalStatus.PENDING },
    });
    expect(tx.purchaseOrder.update).toHaveBeenCalledWith({
      where: { id: 'po-1' },
      data: { status: PurchaseOrderStatus.PENDING_COO_APPROVAL },
    });
  });

  it('does not issue a PO before the entire approval ladder is complete', async () => {
    const { service } = setup([
      poRow({ status: PurchaseOrderStatus.PENDING_COO_APPROVAL }),
    ]);

    await expect(service.issue('po-1', ceo)).rejects.toThrow(
      'until every required approval is complete',
    );
  });

  it('requires a rejection reason', async () => {
    const { service } = setup();
    await expect(
      service.rejectApproval('po-1', { comment: '   ' }, ceo),
    ).rejects.toBeInstanceOf(BadRequestException);
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

  it('accepts a free-text line without an Item Master id', async () => {
    const dto = plainToInstance(CreatePurchaseOrderDto, {
      adHocPartyName: 'One-off Fabricator',
      lines: [
        {
          adHocItemName: 'Site installation service',
          adHocDescription: 'Installation and commissioning at customer site',
          unitOfMeasure: 'job',
          orderedQuantity: 1,
          unitPrice: 25000,
        },
      ],
    });
    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    expect(errors).toEqual([]);
  });
});
