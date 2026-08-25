import { BadRequestException } from '@nestjs/common';
import {
  CustomerBomIntakeService,
  deriveIntakeStatus,
  fuzzyItemScore,
} from './customer-bom-intake.service';

describe('deriveIntakeStatus — register lifecycle label', () => {
  it('follows the precedence RELEASED > PRICED > RFQ_FLOATED > PENDING_APPROVAL > DRAFT', () => {
    expect(deriveIntakeStatus('RELEASED' as any, ['AWARDED' as any])).toBe('RELEASED');
    expect(deriveIntakeStatus('DRAFT' as any, ['AWARDED' as any])).toBe('PRICED');
    expect(deriveIntakeStatus('DRAFT' as any, ['ISSUED' as any])).toBe('RFQ_FLOATED');
    expect(deriveIntakeStatus('DRAFT' as any, ['CLOSED' as any])).toBe('RFQ_FLOATED');
    expect(deriveIntakeStatus('PENDING_APPROVAL' as any, ['DRAFT' as any])).toBe('PENDING_APPROVAL');
    expect(deriveIntakeStatus('DRAFT' as any, [])).toBe('DRAFT');
    expect(deriveIntakeStatus(null, [])).toBe('DRAFT');
  });
});

describe('CustomerBomIntakeService.revise', () => {
  function setup(bomStatus: string) {
    const prisma: any = {
      customerBomIntake: { findUnique: jest.fn(), update: jest.fn() },
      customerBomIntakeLine: { deleteMany: jest.fn() },
      bom: { findFirst: jest.fn(), create: jest.fn() },
      bomEvent: { create: jest.fn() },
      item: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn() },
      rfq: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn((cb: any) => cb(prisma)),
    };
    const access: any = {
      assertSalesAccess: jest.fn(),
      assertCanAccessOwned: jest.fn(),
      visibleOwnerIds: jest.fn(),
    };
    const numbering: any = { nextContinuousNumber: jest.fn() };
    const pings: any = { create: jest.fn() };
    const service = new CustomerBomIntakeService(
      prisma,
      access,
      numbering,
      {} as any,
      pings,
    );
    // detail() re-reads everything with heavy includes — not under test here.
    jest.spyOn(service, 'detail').mockResolvedValue({ ok: true } as any);
    prisma.customerBomIntake.findUnique.mockResolvedValue({
      id: 'intake-1',
      productName: 'Signal Kiosk',
      finishedGoodItemId: 'fg-1',
      opportunity: { ownerId: 'owner-1' },
      bom: { id: 'bom-1', status: bomStatus, revisionNumber: 2 },
    });
    return { service, prisma, pings };
  }
  const user: any = { id: 'sales-1', role: 'EMPLOYEE' };
  const dto = {
    revisionNotes: 'Added missed busbar',
    lines: [
      {
        description: 'Copper busbar',
        quantity: 2,
        unitOfMeasure: 'NOS',
        existingItemId: 'item-a',
        confirmCreateNew: false,
      },
    ],
  } as any;

  beforeEach(() => jest.restoreAllMocks());

  it('creates the next Bom revision, repoints the intake, and preserves the prior row untouched', async () => {
    const { service, prisma } = setup('DRAFT');
    prisma.item.findFirst.mockResolvedValue({ id: 'item-a' });
    prisma.bom.findFirst.mockResolvedValue({ revisionNumber: 2 });
    prisma.bom.create.mockResolvedValue({ id: 'bom-2', revisionNumber: 3 });

    await service.revise('intake-1', dto, user);

    expect(prisma.bom.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          itemId: 'fg-1',
          revisionNumber: 3,
          status: 'DRAFT',
          revisionNotes: 'Added missed busbar',
        }),
      }),
    );
    expect(prisma.bomEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: 'REVISION_CREATED' }),
      }),
    );
    // Current pointer moves; the old Bom row is never updated or deleted.
    expect(prisma.customerBomIntake.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ bomId: 'bom-2' }),
      }),
    );
    expect(prisma.customerBomIntakeLine.deleteMany).toHaveBeenCalled();
  });

  it('refuses to self-revise once R&D has RELEASED the BOM', async () => {
    const { service, prisma } = setup('RELEASED');
    await expect(service.revise('intake-1', dto, user)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('refuses to revise while the BOM is pending R&D approval', async () => {
    const { service, prisma } = setup('PENDING_APPROVAL');
    await expect(service.revise('intake-1', dto, user)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('pings each live RFQ owner about the stale revision, skipping the revising user', async () => {
    const { service, prisma, pings } = setup('DRAFT');
    prisma.item.findFirst.mockResolvedValue({ id: 'item-a' });
    prisma.bom.findFirst.mockResolvedValue({ revisionNumber: 2 });
    prisma.bom.create.mockResolvedValue({ id: 'bom-2', revisionNumber: 3 });
    prisma.rfq.findMany.mockResolvedValue([
      { id: 'rfq-1', rfqNumber: 'RFQ-2026-0001', createdById: 'scm-1' },
      { id: 'rfq-2', rfqNumber: 'RFQ-2026-0002', createdById: 'sales-1' },
    ]);

    await service.revise('intake-1', dto, user);

    expect(pings.create).toHaveBeenCalledTimes(1);
    expect(pings.create).toHaveBeenCalledWith(
      user,
      expect.objectContaining({
        recipientIds: ['scm-1'],
        linkedRecordType: 'RFQ',
        linkedRecordId: 'rfq-1',
        message: expect.stringContaining('RFQ-2026-0001'),
      }),
    );
  });

  it('sends no pings when the intake has no live RFQs', async () => {
    const { service, prisma, pings } = setup('DRAFT');
    prisma.item.findFirst.mockResolvedValue({ id: 'item-a' });
    prisma.bom.findFirst.mockResolvedValue({ revisionNumber: 2 });
    prisma.bom.create.mockResolvedValue({ id: 'bom-2', revisionNumber: 3 });

    await service.revise('intake-1', dto, user);
    expect(pings.create).not.toHaveBeenCalled();
  });
});

describe('Customer BOM intake fuzzy matching', () => {
  it('matches reordered technical wording', () => {
    expect(
      fuzzyItemScore('stainless steel mounting bracket', 'Mounting bracket, stainless steel'),
    ).toBe(1);
  });

  it('does not present unrelated items as likely matches', () => {
    expect(fuzzyItemScore('copper busbar', 'powder coated enclosure')).toBe(0);
  });
});
