import { Prisma } from '@prisma/client';
import { GoodsReceiptNoteService } from './goods-receipt-note.service';
import { IncomingInspectionService } from './incoming-inspection.service';

/**
 * The QC gate — the only path in the system that turns received goods into
 * stock. These tests pin the rule the audit template exists to enforce: the
 * checklist and the accept/reject quantities must agree, and nothing moves
 * until they do. The real IncomingInspectionService is wired in (not a stub),
 * so the coupling is exercised end to end.
 */

function questionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'q-1',
    templateId: 'tpl-1',
    section: 'Receipt',
    sequence: 1,
    prompt: 'Visual inspection — no damage or corrosion',
    responseType: 'YES_NO_NA',
    required: true,
    weight: new Prisma.Decimal(1),
    unit: null,
    lowerLimit: null,
    upperLimit: null,
    options: null,
    acceptanceCriteria: null,
    evidenceOnFailure: true,
    ...overrides,
  };
}

function templateRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tpl-1',
    templateCode: 'INC-GEN',
    name: 'Incoming Material Inspection — General',
    description: null,
    templateType: 'INCOMING',
    version: 1,
    status: 'APPROVED',
    effectiveFrom: new Date('2026-01-01'),
    createdById: 'system',
    submittedById: null,
    submittedAt: null,
    approvedById: 'system',
    approvedAt: new Date('2026-01-01'),
    questions: [questionRow()],
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

function lineRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'grn-line-1',
    grnId: 'grn-1',
    purchaseOrderLineId: 'po-line-1',
    itemId: 'item-1',
    item: { itemCode: 'CM-00010', name: 'Liquid Manifold' },
    storeLocationId: 'loc-1',
    storeLocation: { name: 'Main Store' },
    purchaseOrderLine: {
      orderedQuantity: new Prisma.Decimal(10),
      unitOfMeasure: 'NOS',
    },
    receivedQuantity: new Prisma.Decimal(10),
    acceptedQuantity: null,
    rejectedQuantity: null,
    rejectionReason: null,
    sequence: 0,
    ...overrides,
  };
}

function grnRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'grn-1',
    grnNumber: 'GRN-2026-0002',
    status: 'PENDING_QC',
    purchaseOrderId: 'po-1',
    purchaseOrder: { poNumber: 'PO-2026-0007' },
    receivedById: 'store-1',
    receivedBy: { firstName: 'Store', lastName: 'Keeper' },
    receivedDate: new Date('2026-08-30T04:00:00Z'),
    inspectedById: null,
    inspectedBy: null,
    inspectedAt: null,
    vendorDeliveryChallanNumber: null,
    deliveryChallanDate: null,
    vehicleOrAwbNumber: null,
    driverOrCourier: null,
    totalPackagesReceived: null,
    packingCondition: null,
    supervisorSignOffId: null,
    supervisorSignOff: null,
    notes: null,
    lines: [lineRow()],
    ncrs: [],
    createdAt: new Date('2026-08-30T04:00:00Z'),
    updatedAt: new Date('2026-08-30T04:00:00Z'),
    ...overrides,
  };
}

function setup(
  opts: {
    grn?: Record<string, unknown>;
    templates?: Record<string, unknown>[];
  } = {},
) {
  const grn = opts.grn ?? grnRow();
  const prisma: Record<string, unknown> = {
    goodsReceiptNote: {
      findUnique: jest.fn().mockResolvedValue(grn),
      update: jest.fn().mockResolvedValue({}),
    },
    goodsReceiptNoteLine: {
      update: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([]),
    },
    qmsQuestionTemplate: {
      findMany: jest.fn().mockResolvedValue(opts.templates ?? [templateRow()]),
    },
    qmsInspection: {
      create: jest
        .fn()
        .mockResolvedValue({ id: 'insp-1', inspectionNumber: 'QI-2026-00007' }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    financeSequence: {
      upsert: jest.fn().mockResolvedValue({ lastValue: 7 }),
    },
    stockBalance: {
      upsert: jest
        .fn()
        .mockResolvedValue({ id: 'bal-1', onHandQuantity: new Prisma.Decimal(0) }),
      update: jest.fn().mockResolvedValue({}),
    },
    stockAdjustment: { create: jest.fn().mockResolvedValue({}) },
    nonConformanceReport: { create: jest.fn().mockResolvedValue({}) },
    purchaseOrder: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'po-1',
        status: 'ISSUED',
        lines: [
          {
            id: 'po-line-1',
            orderedQuantity: new Prisma.Decimal(10),
            item: { itemCode: 'CM-00010' },
          },
          {
            id: 'po-line-2',
            orderedQuantity: new Prisma.Decimal(4),
            item: { itemCode: 'CM-00007' },
          },
        ],
      }),
      update: jest.fn().mockResolvedValue({}),
    },
  };
  prisma.$transaction = jest.fn(
    async (cb: (tx: unknown) => Promise<unknown>) => cb(prisma),
  );

  const access = { assertCanInspect: jest.fn(), assertCanReceiveGoods: jest.fn() };
  const numbering = { nextNumber: jest.fn().mockResolvedValue('NCR-2026-0001') };
  const service = new GoodsReceiptNoteService(
    prisma as never,
    access as never,
    numbering as never,
    new IncomingInspectionService(prisma as never),
  );
  return { service, prisma, access, numbering };
}

const USER = { id: 'qc-1' } as never;

/** The inspection rows the finalize wrote, as passed to prisma. */
function inspectionData(prisma: Record<string, unknown>) {
  const create = (prisma.qmsInspection as { create: jest.Mock }).create;
  return create.mock.calls.map(
    (c) => (c[0] as { data: Record<string, unknown> }).data,
  );
}

describe('GoodsReceiptNoteService.finalizeQc — incoming inspection', () => {
  it('records a terminal inspection per line and moves the accepted stock', async () => {
    const { service, prisma } = setup();
    await service.finalizeQc(
      'grn-1',
      {
        lines: [
          {
            grnLineId: 'grn-line-1',
            templateId: 'tpl-1',
            responses: [{ questionKey: 'q-1', answer: 'YES' }],
            acceptedQuantity: 10,
            rejectedQuantity: 0,
          },
        ],
      } as never,
      USER,
    );

    const inspections = inspectionData(prisma);
    expect(inspections).toHaveLength(1);
    expect(inspections[0]).toMatchObject({
      grnId: 'grn-1',
      grnLineId: 'grn-line-1',
      status: 'PASSED',
      overallResult: 'PASS',
      inspectedById: 'qc-1',
    });
    expect(
      (prisma.stockAdjustment as { create: jest.Mock }).create,
    ).toHaveBeenCalledTimes(1);
    expect(
      (prisma.nonConformanceReport as { create: jest.Mock }).create,
    ).not.toHaveBeenCalled();
    expect(
      (prisma.goodsReceiptNote as { update: jest.Mock }).update,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'QC_PASSED' }),
      }),
    );
  });

  it('refuses to accept the whole lot when the checklist failed', async () => {
    const { service, prisma } = setup();
    await expect(
      service.finalizeQc(
        'grn-1',
        {
          lines: [
            {
              grnLineId: 'grn-line-1',
              templateId: 'tpl-1',
              responses: [
                { questionKey: 'q-1', answer: 'NO', comments: 'Corrosion on 3 units' },
              ],
              acceptedQuantity: 10,
              rejectedQuantity: 0,
            },
          ],
        } as never,
        USER,
      ),
    ).rejects.toThrow(/the whole quantity cannot be accepted/);
    // Nothing moved: the gate rejects before the transaction opens.
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('refuses to reject any quantity when the checklist passed', async () => {
    const { service, prisma } = setup();
    await expect(
      service.finalizeQc(
        'grn-1',
        {
          lines: [
            {
              grnLineId: 'grn-line-1',
              templateId: 'tpl-1',
              responses: [{ questionKey: 'q-1', answer: 'YES' }],
              acceptedQuantity: 7,
              rejectedQuantity: 3,
              rejectionReason: 'Short supply',
            },
          ],
        } as never,
        USER,
      ),
    ).rejects.toThrow(/the inspection passed, so no quantity can be rejected/);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('salvages the conforming part of a failed lot as a CONDITIONAL_PASS + NCR', async () => {
    const { service, prisma } = setup();
    await service.finalizeQc(
      'grn-1',
      {
        lines: [
          {
            grnLineId: 'grn-line-1',
            templateId: 'tpl-1',
            responses: [
              { questionKey: 'q-1', answer: 'NO', comments: 'Corrosion on 3 units' },
            ],
            acceptedQuantity: 7,
            rejectedQuantity: 3,
            rejectionReason: 'Surface corrosion',
          },
        ],
      } as never,
      USER,
    );

    expect(inspectionData(prisma)[0]).toMatchObject({
      status: 'CONDITIONAL_PASS',
      overallResult: 'CONDITIONAL_PASS',
    });
    expect(
      (prisma.nonConformanceReport as { create: jest.Mock }).create,
    ).toHaveBeenCalledTimes(1);
    expect(
      (prisma.goodsReceiptNote as { update: jest.Mock }).update,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'QC_PARTIAL' }),
      }),
    );
  });

  it('is mandatory — an unanswered required question stops the finalize', async () => {
    const { service, prisma } = setup();
    await expect(
      service.finalizeQc(
        'grn-1',
        {
          lines: [
            {
              grnLineId: 'grn-line-1',
              templateId: 'tpl-1',
              responses: [],
              acceptedQuantity: 10,
              rejectedQuantity: 0,
            },
          ],
        } as never,
        USER,
      ),
    ).rejects.toThrow(/CM-00010: .*is required and has not been answered/);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects an unapproved template before validating any quantity', async () => {
    const { service, prisma } = setup({
      templates: [templateRow({ status: 'DRAFT' })],
    });
    await expect(
      service.finalizeQc(
        'grn-1',
        {
          lines: [
            {
              grnLineId: 'grn-line-1',
              templateId: 'tpl-1',
              responses: [{ questionKey: 'q-1', answer: 'YES' }],
              acceptedQuantity: 10,
              rejectedQuantity: 0,
            },
          ],
        } as never,
        USER,
      ),
    ).rejects.toThrow(/only an APPROVED template can be inspected against/);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('inspects each line against its own template', async () => {
    // Three different items on one GRN are three different inspections — the
    // reason the checklist is per line rather than per consignment.
    const secondLine = lineRow({
      id: 'grn-line-2',
      purchaseOrderLineId: 'po-line-2',
      itemId: 'item-2',
      item: { itemCode: 'CM-00007', name: 'Liquid Cooling 2' },
      receivedQuantity: new Prisma.Decimal(4),
      sequence: 1,
    });
    const pressureTemplate = templateRow({
      id: 'tpl-2',
      templateCode: 'INC-COOL',
      name: 'Incoming — Cooling Assemblies',
      questions: [
        questionRow({
          id: 'q-2',
          templateId: 'tpl-2',
          prompt: 'Leak test pressure held',
          responseType: 'MEASUREMENT',
          unit: 'bar',
          lowerLimit: new Prisma.Decimal('6'),
          upperLimit: null,
        }),
      ],
    });
    const { service, prisma } = setup({
      grn: grnRow({ lines: [lineRow(), secondLine] }),
      templates: [templateRow(), pressureTemplate],
    });

    await service.finalizeQc(
      'grn-1',
      {
        lines: [
          {
            grnLineId: 'grn-line-1',
            templateId: 'tpl-1',
            responses: [{ questionKey: 'q-1', answer: 'YES' }],
            acceptedQuantity: 10,
            rejectedQuantity: 0,
          },
          {
            grnLineId: 'grn-line-2',
            templateId: 'tpl-2',
            responses: [{ questionKey: 'q-2', answer: '6.5' }],
            acceptedQuantity: 4,
            rejectedQuantity: 0,
          },
        ],
      } as never,
      USER,
    );

    const inspections = inspectionData(prisma);
    expect(inspections).toHaveLength(2);
    expect(inspections.map((i) => i.grnLineId)).toEqual([
      'grn-line-1',
      'grn-line-2',
    ]);
    expect(
      inspections.map(
        (i) => (i.templateSnapshot as { templateCode: string }).templateCode,
      ),
    ).toEqual(['INC-GEN', 'INC-COOL']);
  });

  it('grades a measurement against the template limit, not the inspector opinion', async () => {
    const outOfSpec = templateRow({
      questions: [
        questionRow({
          prompt: 'Leak test pressure held',
          responseType: 'MEASUREMENT',
          unit: 'bar',
          lowerLimit: new Prisma.Decimal('6'),
          upperLimit: null,
          evidenceOnFailure: false,
        }),
      ],
    });
    const { service } = setup({ templates: [outOfSpec] });
    await expect(
      service.finalizeQc(
        'grn-1',
        {
          lines: [
            {
              grnLineId: 'grn-line-1',
              templateId: 'tpl-1',
              responses: [{ questionKey: 'q-1', answer: '5.2' }],
              acceptedQuantity: 10,
              rejectedQuantity: 0,
            },
          ],
        } as never,
        USER,
      ),
    ).rejects.toThrow(/Leak test pressure held/);
  });
});
