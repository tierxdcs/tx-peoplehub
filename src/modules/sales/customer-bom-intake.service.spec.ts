import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  CustomerBomIntakeService,
  approvedQuote,
  bomIntakeProductDescription,
  customerBomFileInput,
  deriveIntakeStatus,
  fuzzyItemScore,
} from './customer-bom-intake.service';

describe('bomIntakeProductDescription', () => {
  it('removes a redundant customer prefix and retains the requirement', () => {
    expect(
      bomIntakeProductDescription(
        "Yokogawa India Limited — Basic PDU's of IEC socket",
        'Yokogawa India Limited',
      ),
    ).toBe("Basic PDU's of IEC socket");
  });

  it('retains an opportunity name that is already only a description', () => {
    expect(
      bomIntakeProductDescription(
        'Vertical PDU with universal sockets',
        'Yokogawa India Limited',
      ),
    ).toBe('Vertical PDU with universal sockets');
  });
});

describe('customerBomFileInput', () => {
  it('allows a manually transcribed intake with no source file', () => {
    expect(customerBomFileInput({})).toBeNull();
  });

  it('retains complete optional upload provenance', () => {
    expect(
      customerBomFileInput({
        fileKey: 'customer-bom/file',
        fileName: 'bom.pdf',
      }),
    ).toEqual({ key: 'customer-bom/file', name: 'bom.pdf' });
  });

  it('rejects partial upload provenance', () => {
    expect(() =>
      customerBomFileInput({ fileKey: 'customer-bom/file' }),
    ).toThrow(BadRequestException);
    expect(() => customerBomFileInput({ fileName: 'bom.pdf' })).toThrow(
      BadRequestException,
    );
  });
});

describe('deriveIntakeStatus — register lifecycle label', () => {
  const derive = (bom: string | null, rfqs: string[] = []) =>
    deriveIntakeStatus('CREATED' as any, bom as any, rfqs as any);

  it('follows the precedence RELEASED > PRICED > RFQ_FLOATED > PENDING_APPROVAL > DRAFT', () => {
    expect(derive('RELEASED', ['AWARDED'])).toBe('RELEASED');
    expect(derive('DRAFT', ['AWARDED'])).toBe('PRICED');
    expect(derive('DRAFT', ['ISSUED'])).toBe('RFQ_FLOATED');
    expect(derive('DRAFT', ['CLOSED'])).toBe('RFQ_FLOATED');
    expect(derive('PENDING_APPROVAL', ['DRAFT'])).toBe('PENDING_APPROVAL');
    expect(derive('DRAFT')).toBe('DRAFT');
    expect(derive(null)).toBe('DRAFT');
  });

  /**
   * A design-required intake has no BOM and no RFQs, so nothing else can fire
   * for one — and if the stored status ever went stale, real downstream evidence
   * (a released BOM, an awarded quote) must still win over it.
   */
  it('reports design work in progress, but never over real downstream evidence', () => {
    expect(deriveIntakeStatus('DESIGN_PENDING' as any, null, [])).toBe(
      'DESIGN_IN_PROGRESS',
    );
    expect(
      deriveIntakeStatus('DESIGN_PENDING' as any, 'RELEASED' as any, []),
    ).toBe('RELEASED');
    expect(
      deriveIntakeStatus(
        'DESIGN_PENDING' as any,
        'DRAFT' as any,
        ['AWARDED'] as any,
      ),
    ).toBe('PRICED');
  });
});

/**
 * "Has the approved quote come in?" is a different question from the lifecycle
 * badge: once R&D releases the BOM the badge reads RELEASED and would otherwise
 * bury the fact that a supplier's price ever landed.
 */
describe('approvedQuote — the accepted supplier quote', () => {
  const rfq = (overrides: Record<string, unknown> = {}) =>
    ({
      id: 'rfq-1',
      rfqNumber: 'RFQ-2026-0004',
      status: 'AWARDED',
      awardDecisionAt: new Date('2026-09-05T06:30:00.000Z'),
      ...overrides,
    }) as never;

  it('reports the awarded RFQ and when the quote was accepted', () => {
    expect(approvedQuote([rfq()])).toEqual({
      rfqId: 'rfq-1',
      rfqNumber: 'RFQ-2026-0004',
      receivedAt: new Date('2026-09-05T06:30:00.000Z'),
    });
  });

  it('stays null while quotes are merely invited, out, or closed', () => {
    for (const status of ['DRAFT', 'ISSUED', 'CLOSED', 'CANCELLED'])
      expect(approvedQuote([rfq({ status })])).toBeNull();
    expect(approvedQuote([])).toBeNull();
  });

  it('picks the awarded one out of several RFQs floated from the intake', () => {
    expect(
      approvedQuote([
        rfq({ id: 'rfq-2', rfqNumber: 'RFQ-2026-0009', status: 'CANCELLED' }),
        rfq(),
      ])?.rfqNumber,
    ).toBe('RFQ-2026-0004');
  });
});

describe('CustomerBomIntakeService — the promised turnaround date', () => {
  function setup(intake: Record<string, unknown> | null) {
    const prisma: any = {
      customerBomIntake: {
        findUnique: jest.fn().mockResolvedValue(intake),
        update: jest.fn(),
      },
    };
    const access: any = {
      assertSalesAccess: jest.fn(),
      assertCanAccessOwned: jest.fn(),
    };
    const service = new CustomerBomIntakeService(
      prisma,
      access,
      {} as any,
      {} as any,
      {} as any,
      { get: jest.fn() } as any,
      {} as any,
      {} as any,
    );
    // detail() re-reads with heavy includes and live pricing — not under test.
    jest.spyOn(service, 'detail').mockResolvedValue({} as never);
    return { service, prisma, access };
  }

  const owned = { id: 'intake-1', opportunity: { ownerId: 'sales-1' } };
  const user: any = { id: 'sales-1', role: 'EMPLOYEE' };

  it('stores the promised date as an instant', async () => {
    const { service, prisma } = setup(owned);
    await service.setExpectedBy(
      'intake-1',
      { expectedBy: '2026-09-15T00:00:00.000Z' },
      user,
    );

    expect(prisma.customerBomIntake.update).toHaveBeenCalledWith({
      where: { id: 'intake-1' },
      data: { expectedBy: new Date('2026-09-15T00:00:00.000Z') },
    });
  });

  it('clears the date when the promise is withdrawn', async () => {
    const { service, prisma } = setup(owned);
    await service.setExpectedBy('intake-1', { expectedBy: null }, user);

    expect(
      prisma.customerBomIntake.update.mock.calls[0][0].data.expectedBy,
    ).toBeNull();
  });

  it('refuses another owner before writing anything', async () => {
    const { service, prisma, access } = setup({
      id: 'intake-1',
      opportunity: { ownerId: 'someone-else' },
    });
    access.assertCanAccessOwned.mockRejectedValue(new Error('forbidden'));

    await expect(
      service.setExpectedBy('intake-1', { expectedBy: null }, user),
    ).rejects.toThrow('forbidden');
    expect(prisma.customerBomIntake.update).not.toHaveBeenCalled();
  });

  it('404s on an unknown intake', async () => {
    const { service } = setup(null);
    await expect(
      service.setExpectedBy('nope', { expectedBy: null }, user),
    ).rejects.toBeInstanceOf(NotFoundException);
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
      {
        get: jest.fn().mockReturnValue({ submitTransition: jest.fn() }),
      } as any,
      {} as any,
      {} as any,
    );
    service.onModuleInit();
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

describe('CustomerBomIntakeService.submitForApproval', () => {
  function setup(bom: { id: string; status: string } | null) {
    const prisma: any = {
      customerBomIntake: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    const access: any = {
      assertSalesAccess: jest.fn(),
      assertCanAccessOwned: jest.fn(),
    };
    const boms: any = { submitTransition: jest.fn() };
    const service = new CustomerBomIntakeService(
      prisma,
      access,
      { nextContinuousNumber: jest.fn() } as any,
      {} as any,
      { create: jest.fn() } as any,
      // BomService is resolved from the container at init, not injected.
      { get: jest.fn().mockReturnValue(boms) } as any,
      {} as any,
      {} as any,
    );
    service.onModuleInit();
    // detail() re-reads with heavy includes — the return shape is not under test.
    jest.spyOn(service, 'detail').mockResolvedValue({ ok: true } as any);
    prisma.customerBomIntake.findUnique.mockResolvedValue({
      id: 'intake-1',
      opportunity: { ownerId: 'owner-1' },
      bom,
    });
    return { service, prisma, access, boms };
  }
  const user: any = { id: 'sales-1', role: 'EMPLOYEE' };

  beforeEach(() => jest.restoreAllMocks());

  it('delegates a DRAFT intake BOM to the one shared submit transition', async () => {
    const { service, boms, access } = setup({ id: 'bom-1', status: 'DRAFT' });

    await service.submitForApproval('intake-1', user);

    // Authorised as Sales-owner, NOT as an R&D author — and the transition is
    // reused rather than reimplemented, so R&D is notified exactly as usual.
    expect(access.assertSalesAccess).toHaveBeenCalledWith(user);
    expect(access.assertCanAccessOwned).toHaveBeenCalledWith(user, 'owner-1');
    expect(boms.submitTransition).toHaveBeenCalledWith('bom-1', user);
  });

  it('lets Sales resubmit a BOM R&D rejected', async () => {
    const { service, boms } = setup({ id: 'bom-1', status: 'REJECTED' });
    await service.submitForApproval('intake-1', user);
    expect(boms.submitTransition).toHaveBeenCalledWith('bom-1', user);
  });

  it('refuses to submit twice while R&D still holds it', async () => {
    const { service, boms } = setup({
      id: 'bom-1',
      status: 'PENDING_APPROVAL',
    });
    await expect(
      service.submitForApproval('intake-1', user),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(boms.submitTransition).not.toHaveBeenCalled();
  });

  it('refuses to submit an already-released BOM', async () => {
    const { service, boms } = setup({ id: 'bom-1', status: 'RELEASED' });
    await expect(
      service.submitForApproval('intake-1', user),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(boms.submitTransition).not.toHaveBeenCalled();
  });

  it('refuses when the intake has no BOM at all', async () => {
    const { service, boms } = setup(null);
    await expect(
      service.submitForApproval('intake-1', user),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(boms.submitTransition).not.toHaveBeenCalled();
  });

  it('refuses a non-owner before touching the BOM', async () => {
    const { service, access, boms } = setup({ id: 'bom-1', status: 'DRAFT' });
    access.assertCanAccessOwned.mockRejectedValue(new Error('forbidden'));
    await expect(service.submitForApproval('intake-1', user)).rejects.toThrow(
      'forbidden',
    );
    expect(boms.submitTransition).not.toHaveBeenCalled();
  });

  it('404s on an unknown intake', async () => {
    const { service, prisma } = setup({ id: 'bom-1', status: 'DRAFT' });
    prisma.customerBomIntake.findUnique.mockResolvedValue(null);
    await expect(
      service.submitForApproval('nope', user),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('Customer BOM intake fuzzy matching', () => {
  it('matches reordered technical wording', () => {
    expect(
      fuzzyItemScore(
        'stainless steel mounting bracket',
        'Mounting bracket, stainless steel',
      ),
    ).toBe(1);
  });

  it('does not present unrelated items as likely matches', () => {
    expect(fuzzyItemScore('copper busbar', 'powder coated enclosure')).toBe(0);
  });
});

/**
 * A product born here has no price and no cost: the cost arrives later from the
 * awarded RFQ quotes. So it must leave the intake carrying a target margin and
 * the flag that lets the BOM release turn that cost into a sellable price —
 * otherwise it sits in the catalog at ₹0.00 forever.
 */
describe('CustomerBomIntakeService.create — catalog pricing defaults', () => {
  function setup() {
    const prisma: any = {
      opportunity: {
        findUnique: jest
          .fn()
          .mockResolvedValue({
            id: 'opp-1',
            name: 'Hyperscale',
            ownerId: 'sales-1',
          }),
      },
      businessUnit: { findFirst: jest.fn().mockResolvedValue({ id: 'bu-1' }) },
      item: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue({ id: 'cm-1', isActive: true }),
        create: jest.fn().mockResolvedValue({ id: 'fg-1' }),
      },
      bom: { create: jest.fn().mockResolvedValue({ id: 'bom-1' }) },
      product: { create: jest.fn().mockResolvedValue({ id: 'prod-1' }) },
      customerBomIntake: {
        create: jest
          .fn()
          .mockResolvedValue({ id: 'intake-1', productName: 'Liquid Cooling' }),
      },
      // Design-head recipients for the "raised for design" ping; none, so the
      // notification short-circuits instead of reaching the Pings service.
      employee: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn((cb: any) => cb(prisma)),
    };
    const access: any = {
      assertSalesAccess: jest.fn(),
      assertCanAccessOwned: jest.fn(),
    };
    const numbering: any = {
      nextContinuousNumber: jest.fn().mockResolvedValue('FG-00005'),
    };
    const design: any = {
      raiseRequestForBomIntake: jest
        .fn()
        .mockResolvedValue({ id: 'dr-1', requestNumber: 'DR-2026-00001' }),
    };
    const service = new CustomerBomIntakeService(
      prisma,
      access,
      numbering,
      {} as any,
      { create: jest.fn() } as any,
      {
        get: jest.fn().mockReturnValue({ submitTransition: jest.fn() }),
      } as any,
      design,
      {} as any,
    );
    service.onModuleInit();
    // list() re-reads with heavy includes and live pricing — not under test.
    jest.spyOn(service, 'list').mockResolvedValue([{ id: 'intake-1' }] as any);
    return { service, prisma, design };
  }

  const user: any = { id: 'sales-1', role: 'EMPLOYEE' };
  const dto = (overrides: Record<string, unknown> = {}) =>
    ({
      productName: 'Liquid Cooling Complete Unit',
      unitOfMeasure: 'NOS',
      businessUnitId: 'bu-1',
      lines: [
        {
          description: 'Copper manifold',
          quantity: 2,
          unitOfMeasure: 'NOS',
          existingItemId: 'cm-1',
          confirmCreateNew: false,
        },
      ],
      ...overrides,
    }) as never;

  it('defaults the target margin to 20% and leaves the price to the BOM cost', async () => {
    const { service, prisma } = setup();
    await service.create('opp-1', dto(), user);

    const data = prisma.product.create.mock.calls[0][0].data;
    expect(data.targetMarginPercent.toString()).toBe('20');
    expect(data.autoPricedFromBomCost).toBe(true);
    expect(data.unitPrice.toString()).toBe('0');
  });

  it('keeps a target margin the intake specified', async () => {
    const { service, prisma } = setup();
    await service.create('opp-1', dto({ targetMarginPercent: 32.5 }), user);

    expect(
      prisma.product.create.mock.calls[0][0].data.targetMarginPercent.toString(),
    ).toBe('32.5');
  });

  /**
   * The design route: the customer stated a requirement, not a parts list. The
   * commercial scaffolding (finished good, Product, promised date) still has to
   * exist — that is what the quote hangs off — but there is nothing to build a
   * BOM from yet, and the intake must stay invisible to SCM until there is.
   */
  const designDto = (overrides: Record<string, unknown> = {}) =>
    dto({
      requiresDesign: true,
      lines: [],
      design: {
        description:
          'Platform-mounted emergency kiosk, outdoor, IP65, 24 V supply.',
        priority: 'HIGH',
        targetDate: '2026-10-01T00:00:00.000Z',
      },
      ...overrides,
    });

  it('creates the finished good and Product but no BOM when design is required', async () => {
    const { service, prisma } = setup();
    await service.create('opp-1', designDto(), user);

    expect(prisma.item.create).toHaveBeenCalled();
    expect(prisma.product.create).toHaveBeenCalled();
    expect(prisma.bom.create).not.toHaveBeenCalled();

    const data = prisma.customerBomIntake.create.mock.calls[0][0].data;
    // DESIGN_PENDING is precisely what keeps SCM's RFQ picker (CREATED +
    // bomId) from offering an intake nobody has designed yet.
    expect(data.status).toBe('DESIGN_PENDING');
    expect(data.bomId).toBeNull();
    expect(data.lines.create).toEqual([]);
  });

  /**
   * The design request goes out with the intake, in the same transaction: an
   * intake that is waiting on design but carries no request is invisible to the
   * design team (their queue lists only intakes a request exists for), and
   * nothing announces the gap.
   */
  it('raises the design request in the same transaction as the intake', async () => {
    const { service, prisma, design } = setup();
    await service.create('opp-1', designDto(), user);

    expect(design.raiseRequestForBomIntake).toHaveBeenCalledTimes(1);
    const [input, tx] = design.raiseRequestForBomIntake.mock.calls[0];
    expect(input).toMatchObject({
      customerBomIntakeId: 'intake-1',
      description:
        'Platform-mounted emergency kiosk, outdoor, IP65, 24 V supply.',
      priority: 'HIGH',
      productId: 'prod-1',
      requestedById: 'sales-1',
      targetDate: new Date('2026-10-01T00:00:00.000Z'),
    });
    // Title is derived so Sales does not have to invent one.
    expect(input.title).toBe('Design & BOM: Liquid Cooling Complete Unit');
    // Enrolled in the caller's transaction, not opening its own.
    expect(tx).toBe(prisma);
  });

  it('falls back to the promised price date when no design date is given', async () => {
    const { service, design } = setup();
    await service.create(
      'opp-1',
      designDto({
        expectedBy: '2026-11-20T00:00:00.000Z',
        design: { description: 'A'.repeat(30) },
      }),
      user,
    );

    expect(design.raiseRequestForBomIntake.mock.calls[0][0].targetDate).toEqual(
      new Date('2026-11-20T00:00:00.000Z'),
    );
  });

  it('refuses design work with no deadline at all', async () => {
    const { service, prisma } = setup();
    await expect(
      service.create(
        'opp-1',
        designDto({ design: { description: 'A'.repeat(30) } }),
        user,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.item.create).not.toHaveBeenCalled();
  });

  it('raises no design request for a transcribed intake', async () => {
    const { service, design } = setup();
    await service.create('opp-1', dto(), user);
    expect(design.raiseRequestForBomIntake).not.toHaveBeenCalled();
  });

  it('refuses the two contradictory halves of the design flag', async () => {
    const withBoth = setup();
    await expect(
      withBoth.service.create('opp-1', dto({ requiresDesign: true }), user),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(withBoth.prisma.item.create).not.toHaveBeenCalled();

    const withNeither = setup();
    await expect(
      withNeither.service.create('opp-1', dto({ lines: [] }), user),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(withNeither.prisma.item.create).not.toHaveBeenCalled();
  });

  it('records the promised date when one is agreed up front, null otherwise', async () => {
    const { service, prisma } = setup();
    await service.create(
      'opp-1',
      dto({ expectedBy: '2026-09-15T00:00:00.000Z' }),
      user,
    );
    expect(
      prisma.customerBomIntake.create.mock.calls[0][0].data.expectedBy,
    ).toEqual(new Date('2026-09-15T00:00:00.000Z'));

    const fresh = setup();
    await fresh.service.create('opp-1', dto(), user);
    expect(
      fresh.prisma.customerBomIntake.create.mock.calls[0][0].data.expectedBy,
    ).toBeNull();
  });
});

describe('CustomerBomIntakeService.register — what the register row carries', () => {
  function setup(row: Record<string, unknown>) {
    const prisma: any = {
      customerBomIntake: {
        findMany: jest.fn().mockResolvedValue([{ designRequests: [], ...row }]),
      },
    };
    const access: any = {
      assertSalesAccess: jest.fn(),
      visibleOwnerIds: jest.fn().mockResolvedValue(null),
    };
    const service = new CustomerBomIntakeService(
      prisma,
      access,
      {} as any,
      {} as any,
      {} as any,
      { get: jest.fn() } as any,
      {} as any,
      {} as any,
    );
    return { service };
  }

  const user: any = { id: 'sales-1', role: 'EMPLOYEE' };

  it('surfaces the accepted quote alongside the released lifecycle badge', async () => {
    const { service } = setup({
      id: 'intake-1',
      expectedBy: new Date('2026-09-15T00:00:00.000Z'),
      bom: { status: 'RELEASED' },
      rfqs: [
        {
          id: 'rfq-1',
          rfqNumber: 'RFQ-2026-0004',
          status: 'AWARDED',
          awardDecisionAt: new Date('2026-09-05T06:30:00.000Z'),
        },
      ],
    });

    const [result] = await service.register(user);
    // RELEASED would otherwise be the only thing the row said about the quote.
    expect(result.derivedStatus).toBe('RELEASED');
    expect(result.approvedQuote).toEqual({
      rfqId: 'rfq-1',
      rfqNumber: 'RFQ-2026-0004',
      receivedAt: new Date('2026-09-05T06:30:00.000Z'),
    });
    expect(result.expectedBy).toEqual(new Date('2026-09-15T00:00:00.000Z'));
  });

  it('leaves the quote unset while the RFQ is still out', async () => {
    const { service } = setup({
      id: 'intake-2',
      expectedBy: null,
      bom: { status: 'DRAFT' },
      rfqs: [
        {
          id: 'rfq-2',
          rfqNumber: 'RFQ-2026-0011',
          status: 'ISSUED',
          awardDecisionAt: null,
        },
      ],
    });

    const [result] = await service.register(user);
    expect(result.derivedStatus).toBe('RFQ_FLOATED');
    expect(result.approvedQuote).toBeNull();
  });
});

/**
 * Handing a design-required intake to the design team. The brief is the only
 * thing Sales can supply that the design team cannot derive, and the request is
 * what makes the work visible in the design module's own queue.
 */
describe('CustomerBomIntakeService.sendToDesign', () => {
  function setup(intake: Record<string, unknown> | null) {
    const prisma: any = {
      customerBomIntake: { findUnique: jest.fn().mockResolvedValue(intake) },
      employee: { findMany: jest.fn().mockResolvedValue([{ id: 'head-1' }]) },
    };
    const access: any = {
      assertSalesAccess: jest.fn(),
      assertCanAccessOwned: jest.fn(),
    };
    const pings: any = { create: jest.fn() };
    const design: any = {
      raiseRequestForBomIntake: jest
        .fn()
        .mockResolvedValue({ id: 'dr-1', requestNumber: 'DR-2026-00007' }),
    };
    const service = new CustomerBomIntakeService(
      prisma,
      access,
      {} as any,
      {} as any,
      pings,
      { get: jest.fn() } as any,
      design,
      {} as any,
    );
    jest.spyOn(service, 'detail').mockResolvedValue({ ok: true } as any);
    return { service, prisma, access, pings, design };
  }

  const pending = (overrides: Record<string, unknown> = {}) => ({
    id: 'intake-1',
    status: 'DESIGN_PENDING',
    productName: 'Platform Emergency Kiosk',
    productId: 'prod-1',
    expectedBy: new Date('2026-10-20T00:00:00.000Z'),
    opportunity: {
      name: 'Metro Phase 3',
      ownerId: 'sales-1',
      customerId: 'cust-1',
    },
    designRequests: [],
    ...overrides,
  });
  const user: any = { id: 'sales-1', role: 'EMPLOYEE' };
  const dto: any = {
    description: 'Customer needs a platform kiosk rated for outdoor IP65 use.',
  };

  beforeEach(() => jest.restoreAllMocks());

  it('raises the request against the intake, carrying the commercial links', async () => {
    const { service, design, access } = setup(pending());

    await service.sendToDesign('intake-1', dto, user);

    expect(access.assertCanAccessOwned).toHaveBeenCalledWith(user, 'sales-1');
    expect(design.raiseRequestForBomIntake).toHaveBeenCalledWith({
      customerBomIntakeId: 'intake-1',
      title: 'Design & BOM: Platform Emergency Kiosk',
      description: dto.description,
      priority: undefined,
      productId: 'prod-1',
      customerId: 'cust-1',
      // The promised date is the real deadline the design sits inside.
      targetDate: new Date('2026-10-20T00:00:00.000Z'),
      requestedById: 'sales-1',
    });
  });

  it('prefers an explicit target date over the promised date', async () => {
    const { service, design } = setup(pending());
    await service.sendToDesign(
      'intake-1',
      { ...dto, targetDate: '2026-10-05T00:00:00.000Z' },
      user,
    );
    expect(design.raiseRequestForBomIntake.mock.calls[0][0].targetDate).toEqual(
      new Date('2026-10-05T00:00:00.000Z'),
    );
  });

  it('refuses when neither a target date nor a promised date exists', async () => {
    const { service, design } = setup(pending({ expectedBy: null }));
    await expect(
      service.sendToDesign('intake-1', dto, user),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(design.raiseRequestForBomIntake).not.toHaveBeenCalled();
  });

  it('refuses an intake that already carries its transcribed BOM', async () => {
    const { service, design } = setup(pending({ status: 'CREATED' }));
    await expect(
      service.sendToDesign('intake-1', dto, user),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(design.raiseRequestForBomIntake).not.toHaveBeenCalled();
  });

  it('refuses to raise a second request while the design team holds one', async () => {
    const { service, design } = setup(
      pending({
        designRequests: [
          { id: 'dr-0', requestNumber: 'DR-2026-00003', status: 'ACCEPTED' },
        ],
      }),
    );
    await expect(
      service.sendToDesign('intake-1', dto, user),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(design.raiseRequestForBomIntake).not.toHaveBeenCalled();
  });

  it('lets Sales re-raise after the design team rejected the last brief', async () => {
    const { service, design } = setup(
      pending({
        designRequests: [
          { id: 'dr-0', requestNumber: 'DR-2026-00003', status: 'REJECTED' },
        ],
      }),
    );
    await service.sendToDesign('intake-1', dto, user);
    expect(design.raiseRequestForBomIntake).toHaveBeenCalled();
  });

  it('notifies the design heads, and survives a notification failure', async () => {
    const { service, pings } = setup(pending());
    await service.sendToDesign('intake-1', dto, user);
    expect(pings.create.mock.calls[0][1]).toMatchObject({
      recipientIds: ['head-1'],
      linkedRecordType: 'DESIGN_BOM_INTAKE',
      linkedRecordId: 'intake-1',
    });

    const failing = setup(pending());
    failing.pings.create.mockRejectedValue(new Error('smtp down'));
    // The request is already committed; a ping must never undo it.
    await expect(
      failing.service.sendToDesign('intake-1', dto, user),
    ).resolves.toEqual({ ok: true });
  });

  it('404s on an unknown intake', async () => {
    const { service } = setup(null);
    await expect(
      service.sendToDesign('nope', dto, user),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

/**
 * The design team's handover. This is the moment the intake becomes RFQ-able —
 * deliberately NOT BOM approval or release: release prices the product from the
 * BOM's cost, and that cost only exists once SCM has awarded the RFQ, so gating
 * sourcing on release would deadlock. A DRAFT BOM being RFQ-able is exactly the
 * existing Sales-transcribed model.
 */
describe('CustomerBomIntakeService.handoverDesignBom', () => {
  function setup(intake: Record<string, unknown> | null) {
    const prisma: any = {
      customerBomIntake: {
        findUnique: jest.fn().mockResolvedValue(intake),
        update: jest.fn(),
      },
      customerBomIntakeLine: { deleteMany: jest.fn() },
      bom: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'bom-9', revisionNumber: 1 }),
      },
      bomEvent: { create: jest.fn() },
      item: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue({ id: 'cm-1', isActive: true }),
      },
      $transaction: jest.fn((cb: any) => cb(prisma)),
    };
    const pings: any = { create: jest.fn() };
    const designAccess: any = { assertUser: jest.fn() };
    const service = new CustomerBomIntakeService(
      prisma,
      { assertSalesAccess: jest.fn() } as any,
      {} as any,
      {} as any,
      pings,
      { get: jest.fn() } as any,
      {} as any,
      designAccess,
    );
    jest.spyOn(service, 'designIntake').mockResolvedValue({ ok: true } as any);
    return { service, prisma, pings, designAccess };
  }

  const queued = (overrides: Record<string, unknown> = {}) => ({
    id: 'intake-1',
    status: 'DESIGN_PENDING',
    productName: 'Platform Emergency Kiosk',
    finishedGoodItemId: 'fg-1',
    createdById: 'sales-1',
    opportunity: { id: 'opp-1', name: 'Metro Phase 3', ownerId: 'sales-2' },
    designRequests: [
      { id: 'dr-1', requestNumber: 'DR-2026-00007', status: 'ACCEPTED' },
    ],
    ...overrides,
  });
  const designer: any = { id: 'des-1', role: 'EMPLOYEE' };
  const dto: any = {
    notes: 'Rev 1 as designed',
    lines: [
      {
        description: 'Copper manifold',
        quantity: 2,
        unitOfMeasure: 'NOS',
        existingItemId: 'cm-1',
        confirmCreateNew: false,
      },
    ],
  };

  beforeEach(() => jest.restoreAllMocks());

  it('authorises by design membership, not the Sales owner rule', async () => {
    const { service, designAccess } = setup(queued());
    await service.handoverDesignBom('intake-1', dto, designer);
    expect(designAccess.assertUser).toHaveBeenCalledWith(designer);
  });

  it('writes revision 1 on the intake finished good and releases it to SCM', async () => {
    const { service, prisma } = setup(queued());

    await service.handoverDesignBom('intake-1', dto, designer);

    const bom = prisma.bom.create.mock.calls[0][0].data;
    expect(bom).toMatchObject({
      itemId: 'fg-1',
      revisionNumber: 1,
      status: 'DRAFT',
      revisionNotes: 'Rev 1 as designed',
      createdById: 'des-1',
    });
    expect(bom.lines.create[0]).toMatchObject({
      itemId: 'cm-1',
      unitOfMeasure: 'NOS',
      makeBuy: 'BUY',
    });
    expect(prisma.bomEvent.create.mock.calls[0][0].data).toMatchObject({
      bomId: 'bom-9',
      type: 'CREATED',
      actorId: 'des-1',
    });
    // The flip to CREATED is the whole point: SCM's picker looks for exactly
    // CREATED + a bomId, so no special case is needed anywhere downstream.
    const update = prisma.customerBomIntake.update.mock.calls[0][0].data;
    expect(update.status).toBe('CREATED');
    expect(update.bomId).toBe('bom-9');
    expect(update.lines.create[0]).toMatchObject({
      description: 'Copper manifold',
      resolvedItemId: 'cm-1',
    });
  });

  it('names the design request when the designer left no revision note', async () => {
    const { service, prisma } = setup(queued());
    await service.handoverDesignBom('intake-1', { lines: dto.lines }, designer);
    expect(prisma.bom.create.mock.calls[0][0].data.revisionNotes).toContain(
      'DR-2026-00007',
    );
  });

  it('tells the opportunity owner and the intake author the BOM has landed', async () => {
    const { service, pings } = setup(queued());
    await service.handoverDesignBom('intake-1', dto, designer);
    expect(pings.create.mock.calls[0][1]).toMatchObject({
      recipientIds: ['sales-2', 'sales-1'],
      linkedRecordType: 'CUSTOMER_BOM_INTAKE',
      linkedRecordId: 'intake-1',
    });
  });

  it('refuses an intake that is not waiting on design', async () => {
    const { service, prisma } = setup(queued({ status: 'CREATED' }));
    await expect(
      service.handoverDesignBom('intake-1', dto, designer),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.bom.create).not.toHaveBeenCalled();
  });

  it('404s on an intake the design team was never asked about', async () => {
    const { service, prisma } = setup(queued({ designRequests: [] }));
    await expect(
      service.handoverDesignBom('intake-1', dto, designer),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.bom.create).not.toHaveBeenCalled();
  });
});

/**
 * The customer's source document, read through either door. The key is that each
 * door applies its own gate — Sales ownership, or design membership — and only
 * then presigns; the presign itself carries no authorisation of its own.
 */
describe('CustomerBomIntakeService raw file access', () => {
  function setup(intake: Record<string, unknown> | null) {
    const prisma: any = {
      customerBomIntake: { findUnique: jest.fn().mockResolvedValue(intake) },
    };
    const access: any = {
      assertSalesAccess: jest.fn(),
      assertCanAccessOwned: jest.fn(),
    };
    const designAccess: any = { assertUser: jest.fn() };
    const storage: any = {
      createDownloadUrl: jest
        .fn()
        .mockResolvedValue({ url: 'https://s3/signed', expiresInSeconds: 900 }),
    };
    const service = new CustomerBomIntakeService(
      prisma,
      access,
      {} as any,
      storage,
      {} as any,
      { get: jest.fn() } as any,
      {} as any,
      designAccess,
    );
    return { service, prisma, access, designAccess, storage };
  }

  const salesUser: any = { id: 'sales-1', role: 'EMPLOYEE' };
  const designer: any = { id: 'des-1', role: 'EMPLOYEE' };

  it('presigns the stored key for the opportunity owner', async () => {
    const { service, access, storage } = setup({
      rawFileKey: 'customer-bom-intake/sales-1/abc',
      rawFileName: 'Rack requirement.pdf',
      opportunity: { ownerId: 'sales-2' },
    });

    await expect(service.fileUrl('intake-1', salesUser)).resolves.toEqual({
      url: 'https://s3/signed',
      fileName: 'Rack requirement.pdf',
      expiresInSeconds: 900,
    });
    expect(access.assertCanAccessOwned).toHaveBeenCalledWith(
      salesUser,
      'sales-2',
    );
    expect(storage.createDownloadUrl).toHaveBeenCalledWith(
      'customer-bom-intake/sales-1/abc',
    );
  });

  it('presigns the same key for a designer, on design membership', async () => {
    const { service, designAccess, storage } = setup({
      rawFileKey: 'customer-bom-intake/sales-1/abc',
      rawFileName: 'Rack requirement.pdf',
      designRequests: [{ id: 'dr-1' }],
    });

    await expect(service.designFileUrl('intake-1', designer)).resolves.toEqual({
      url: 'https://s3/signed',
      fileName: 'Rack requirement.pdf',
      expiresInSeconds: 900,
    });
    expect(designAccess.assertUser).toHaveBeenCalledWith(designer);
    expect(storage.createDownloadUrl).toHaveBeenCalledWith(
      'customer-bom-intake/sales-1/abc',
    );
  });

  it('404s for the design team on an intake it was never asked about', async () => {
    const { service, storage } = setup({
      rawFileKey: 'customer-bom-intake/sales-1/abc',
      rawFileName: 'Rack requirement.pdf',
      designRequests: [],
    });
    await expect(
      service.designFileUrl('intake-1', designer),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(storage.createDownloadUrl).not.toHaveBeenCalled();
  });

  it('404s on a manually entered intake, through either door', async () => {
    const sales = setup({
      rawFileKey: null,
      rawFileName: null,
      opportunity: { ownerId: 'sales-1' },
    });
    await expect(
      sales.service.fileUrl('intake-1', salesUser),
    ).rejects.toBeInstanceOf(NotFoundException);

    const design = setup({
      rawFileKey: null,
      rawFileName: null,
      designRequests: [{ id: 'dr-1' }],
    });
    await expect(
      design.service.designFileUrl('intake-1', designer),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('404s on an unknown intake before touching storage', async () => {
    const { service, storage } = setup(null);
    await expect(service.fileUrl('nope', salesUser)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(
      service.designFileUrl('nope', designer),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(storage.createDownloadUrl).not.toHaveBeenCalled();
  });
});
