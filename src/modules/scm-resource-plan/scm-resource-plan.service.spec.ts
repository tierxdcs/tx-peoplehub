import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { BomStatus, KickoffStatus, Prisma, Role } from '@prisma/client';
import { ScmResourcePlanService } from './scm-resource-plan.service';
import { ScmResourcePlanAccessService } from './scm-resource-plan-access.service';

/**
 * SCM Resource Planning Sheet — unit coverage for the parts that carry real
 * risk: the three-tier access gate, the explosion→aggregation→benchmark
 * snapshot on generate, regeneration preserving entered negotiated prices, and
 * the on-read variance math (never-stored, never-drift).
 */

const D = (v: number | string) => new Prisma.Decimal(v);
const asUser = (role: Role | null, verticalId: string | null = null): any => ({
  id: 'u1',
  email: 'u@x.io',
  role,
  verticalId,
});

// ── Access service ─────────────────────────────────────────────────────
describe('ScmResourcePlanAccessService — three-tier gate (§6)', () => {
  const make = (opts: { canViewCost?: boolean; verticalCode?: string | null }) => {
    const prisma: any = {
      vertical: {
        findUnique: jest.fn().mockResolvedValue(
          opts.verticalCode ? { code: opts.verticalCode } : null,
        ),
      },
    };
    const itemCost: any = {
      canViewCost: jest.fn().mockResolvedValue(opts.canViewCost ?? false),
    };
    return new ScmResourcePlanAccessService(prisma, itemCost);
  };

  it('view delegates to ItemCostService.canViewCost', async () => {
    const svc = make({ canViewCost: true });
    await expect(svc.assertCanView(asUser(Role.EMPLOYEE, 'x'))).resolves.toBeUndefined();
    const denied = make({ canViewCost: false, verticalCode: 'PRODUCTION' });
    await expect(
      denied.assertCanView(asUser(Role.EMPLOYEE, 'prod')),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('generate requires SCM Manager+ or SUPER_ADMIN', async () => {
    // SCM Manager → ok
    const scmMgr = make({ verticalCode: 'SCM' });
    await expect(
      scmMgr.assertCanGenerate(asUser(Role.MANAGER, 'scm')),
    ).resolves.toBeUndefined();
    // SUPER_ADMIN → ok regardless of vertical
    const sa = make({ verticalCode: null });
    await expect(
      sa.assertCanGenerate(asUser(Role.SUPER_ADMIN, null)),
    ).resolves.toBeUndefined();
    // SCM Employee → denied (not a manager)
    const scmEmp = make({ verticalCode: 'SCM' });
    await expect(
      scmEmp.assertCanGenerate(asUser(Role.EMPLOYEE, 'scm')),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('edit allows any SCM staff or SUPER_ADMIN but not other verticals', async () => {
    const scmEmp = make({ verticalCode: 'SCM' });
    await expect(
      scmEmp.assertCanEdit(asUser(Role.EMPLOYEE, 'scm')),
    ).resolves.toBeUndefined();
    const accounts = make({ verticalCode: 'ACCOUNTS' });
    await expect(
      accounts.assertCanEdit(asUser(Role.EMPLOYEE, 'acc')),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

// ── Service ────────────────────────────────────────────────────────────
describe('ScmResourcePlanService', () => {
  let prisma: any;
  let access: any;
  let itemCost: any;
  let service: ScmResourcePlanService;

  // A tiny two-line BOM: FG (item-fg) → 2× RAW-A (item-a), 1× RAW-B (item-b).
  const releasedBoms = [
    {
      id: 'bom-fg',
      itemId: 'item-fg',
      status: BomStatus.RELEASED,
      revisionNumber: 1,
      lines: [
        {
          itemId: 'item-a',
          quantityPerUnit: D(2),
          wastagePercent: D(0),
          unitOfMeasure: 'nos',
        },
        {
          itemId: 'item-b',
          quantityPerUnit: D(1),
          wastagePercent: D(0),
          unitOfMeasure: 'nos',
        },
      ],
    },
  ];

  const kickoffCompleted = {
    id: 'ko1',
    orderId: 'ord1',
    status: KickoffStatus.COMPLETED,
    order: {
      lineItems: [
        { id: 'oli1', quantity: D(10), product: { id: 'p1', itemId: 'item-fg' } },
      ],
    },
    resourcePlan: null,
  };

  beforeEach(() => {
    prisma = {
      projectKickoff: { findUnique: jest.fn(), findMany: jest.fn() },
      projectResourcePlan: {
        create: jest.fn(),
        update: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
      },
      projectResourcePlanLine: {
        create: jest.fn(),
        update: jest.fn(),
        deleteMany: jest.fn(),
        findUnique: jest.fn(),
      },
      bom: { findMany: jest.fn().mockResolvedValue(releasedBoms) },
      item: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'item-a', itemCode: 'RM-00001', name: 'Raw A' },
          { id: 'item-b', itemCode: 'RM-00002', name: 'Raw B' },
        ]),
      },
      $transaction: jest.fn().mockImplementation((cb: any) => cb(prisma)),
    };
    access = {
      assertCanGenerate: jest.fn().mockResolvedValue(undefined),
      assertCanView: jest.fn().mockResolvedValue(undefined),
      assertCanEdit: jest.fn().mockResolvedValue(undefined),
    };
    itemCost = {
      currentCost: jest.fn().mockImplementation((itemId: string) =>
        Promise.resolve({
          amount: itemId === 'item-a' ? D('50.00') : D('30.00'),
          source: 'MANUAL_STANDARD',
        }),
      ),
    };
    service = new ScmResourcePlanService(prisma, access, itemCost);
  });

  const stubReadReturns = (lines: any[]) => {
    prisma.projectResourcePlan.findUnique.mockResolvedValue({
      id: 'plan1',
      projectKickoffId: 'ko1',
      orderId: 'ord1',
      generatedAt: new Date('2026-08-09T00:00:00Z'),
      generatedById: 'u1',
      lines,
      projectKickoff: { projectName: 'Proj' },
      order: { orderNumber: 'ORD-1' },
      generatedBy: { firstName: 'Su', lastName: 'Perez' },
    });
  };

  it('rejects generation for a non-completed kickoff', async () => {
    prisma.projectKickoff.findUnique.mockResolvedValue({
      ...kickoffCompleted,
      status: KickoffStatus.DRAFT,
    });
    await expect(
      service.generate('ko1', asUser(Role.MANAGER, 'scm')),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('aggregates exploded leaves × order qty and snapshots benchmark cost per new line', async () => {
    prisma.projectKickoff.findUnique.mockResolvedValue(kickoffCompleted);
    prisma.projectResourcePlan.create.mockResolvedValue({ id: 'plan1' });
    stubReadReturns([]); // read-back content is asserted separately

    await service.generate('ko1', asUser(Role.MANAGER, 'scm'));

    const created = prisma.projectResourcePlanLine.create.mock.calls.map(
      (c: any[]) => c[0].data,
    );
    expect(created).toHaveLength(2);
    const a = created.find((d: any) => d.itemId === 'item-a');
    const b = created.find((d: any) => d.itemId === 'item-b');
    // qty: 2 per FG × 10 ordered = 20 ; 1 × 10 = 10
    expect(a.requiredQuantity.toString()).toBe('20');
    expect(b.requiredQuantity.toString()).toBe('10');
    // benchmark snapshot straight from currentCost
    expect(a.benchmarkCostPerUnit.toString()).toBe('50');
    expect(b.benchmarkCostPerUnit.toString()).toBe('30');
    expect(a.itemCode).toBe('RM-00001');
  });

  it('regeneration preserves entered negotiated prices + original benchmark, only refreshing qty', async () => {
    prisma.projectKickoff.findUnique.mockResolvedValue({
      ...kickoffCompleted,
      resourcePlan: {
        id: 'plan1',
        lines: [
          {
            id: 'line-a',
            itemId: 'item-a',
            negotiatedPricePerUnit: D('45.00'),
            benchmarkCostPerUnit: D('40.00'), // ORIGINAL snapshot, older than currentCost=50
            notes: 'agreed with vendor',
          },
          {
            id: 'line-old',
            itemId: 'item-gone', // no longer required → should be deleted
            negotiatedPricePerUnit: D('5.00'),
            benchmarkCostPerUnit: D('5.00'),
            notes: null,
          },
        ],
      },
    });
    prisma.projectResourcePlan.update.mockResolvedValue({ id: 'plan1' });
    stubReadReturns([]);

    await service.generate('ko1', asUser(Role.MANAGER, 'scm'));

    // item-a is an UPDATE (not create) that never touches benchmark/negotiated.
    const updates = prisma.projectResourcePlanLine.update.mock.calls.map(
      (c: any[]) => c[0],
    );
    const aUpdate = updates.find((u: any) => u.where.id === 'line-a');
    expect(aUpdate).toBeTruthy();
    expect(aUpdate.data.requiredQuantity.toString()).toBe('20');
    expect(aUpdate.data).not.toHaveProperty('benchmarkCostPerUnit');
    expect(aUpdate.data).not.toHaveProperty('negotiatedPricePerUnit');

    // item-b is newly required → created with fresh snapshot.
    const created = prisma.projectResourcePlanLine.create.mock.calls.map(
      (c: any[]) => c[0].data,
    );
    expect(created.map((d: any) => d.itemId)).toEqual(['item-b']);

    // stale item-gone line is deleted.
    expect(prisma.projectResourcePlanLine.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['line-old'] } },
    });
  });

  it('computes line + plan variance on read (positive = cost increase, negative = saving)', async () => {
    stubReadReturns([
      {
        id: 'line-a',
        itemId: 'item-a',
        itemCode: 'RM-00001',
        itemName: 'Raw A',
        requiredQuantity: D(20),
        unitOfMeasure: 'nos',
        benchmarkCostPerUnit: D('50.00'),
        negotiatedPricePerUnit: D('55.00'), // increase
        notes: null,
      },
      {
        id: 'line-b',
        itemId: 'item-b',
        itemCode: 'RM-00002',
        itemName: 'Raw B',
        requiredQuantity: D(10),
        unitOfMeasure: 'nos',
        benchmarkCostPerUnit: D('30.00'),
        negotiatedPricePerUnit: null, // unpriced → falls back to benchmark in totals
        notes: null,
      },
    ]);

    const plan = await service.read('ko1', asUser(Role.EMPLOYEE, 'scm'));
    const lineA = plan!.lines.find((l) => l.id === 'line-a')!;
    // 20×50=1000 benchmark, 20×55=1100 negotiated, +100 (+10%)
    expect(lineA.benchmarkLineTotal).toBe('1000');
    expect(lineA.negotiatedLineTotal).toBe('1100');
    expect(lineA.varianceAmount).toBe('100');
    expect(lineA.variancePercent).toBe('10');

    const lineB = plan!.lines.find((l) => l.id === 'line-b')!;
    expect(lineB.negotiatedLineTotal).toBeNull();
    expect(lineB.varianceAmount).toBeNull();

    // Plan totals: benchmark 1000+300=1300; negotiated 1100 + (fallback 300) =1400; +100 (+7.69%)
    expect(plan!.summary.totalBenchmarkCost).toBe('1300');
    expect(plan!.summary.totalNegotiatedCost).toBe('1400');
    expect(plan!.summary.varianceAmount).toBe('100');
    expect(plan!.summary.variancePercent).toBe('7.69');
    expect(plan!.summary.negotiatedLineCount).toBe(1);
    expect(plan!.summary.lineCount).toBe(2);
  });

  it('updateLine clears a negotiated price when passed null', async () => {
    prisma.projectResourcePlanLine.findUnique.mockResolvedValue({
      id: 'line-a',
      itemId: 'item-a',
    });
    prisma.projectResourcePlanLine.update.mockResolvedValue({
      id: 'line-a',
      itemId: 'item-a',
      itemCode: 'RM-00001',
      itemName: 'Raw A',
      requiredQuantity: D(20),
      unitOfMeasure: 'nos',
      benchmarkCostPerUnit: D('50.00'),
      negotiatedPricePerUnit: null,
      notes: null,
    });

    const res = await service.updateLine(
      'line-a',
      { negotiatedPricePerUnit: null },
      asUser(Role.EMPLOYEE, 'scm'),
    );
    expect(prisma.projectResourcePlanLine.update).toHaveBeenCalledWith({
      where: { id: 'line-a' },
      data: { negotiatedPricePerUnit: null },
    });
    expect(res.negotiatedPricePerUnit).toBeNull();
    expect(res.varianceAmount).toBeNull();
  });

  it('updateLine 404s a missing line before any write', async () => {
    prisma.projectResourcePlanLine.findUnique.mockResolvedValue(null);
    await expect(
      service.updateLine('nope', { notes: 'x' }, asUser(Role.EMPLOYEE, 'scm')),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.projectResourcePlanLine.update).not.toHaveBeenCalled();
  });
});
