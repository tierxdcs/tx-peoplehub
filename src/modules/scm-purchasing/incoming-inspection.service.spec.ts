import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { IncomingInspectionService } from './incoming-inspection.service';

/**
 * The grading rules for incoming inspection. What matters here: an answer can
 * only mean "conforming" if the template says so, a measurement is judged
 * against the template's own limits, and a failed check that demands evidence
 * cannot be filed as a bare FAIL. Anything that lets a non-conforming lot read
 * as a pass is the expensive failure — it puts bad material into stock with an
 * audit trail saying it was fine.
 */

function question(overrides: Record<string, unknown> = {}) {
  return {
    id: 'q-1',
    templateId: 'tpl-1',
    section: 'Receipt',
    sequence: 1,
    prompt: 'Packaging intact, no transit damage',
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

function template(questions = [question()], overrides: Record<string, unknown> = {}) {
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
    questions,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  } as never;
}

function setup(templateRows: unknown[] = [template()]) {
  const prisma = {
    qmsQuestionTemplate: {
      findMany: jest.fn().mockResolvedValue(templateRows),
    },
    financeSequence: {
      upsert: jest.fn().mockResolvedValue({ lastValue: 7 }),
    },
    qmsInspection: {
      create: jest
        .fn()
        .mockResolvedValue({ id: 'insp-1', inspectionNumber: 'QI-2026-00007' }),
    },
  };
  const service = new IncomingInspectionService(prisma as never);
  return { service, prisma };
}

describe('IncomingInspectionService.evaluate', () => {
  it('passes a fully conforming checklist', () => {
    const { service } = setup();
    const result = service.evaluate(
      template(),
      [{ questionKey: 'q-1', answer: 'YES' }],
      'CM-00010',
    );
    expect(result.result).toBe('PASS');
    expect(result.failedPrompts).toEqual([]);
    expect(result.responses[0]).toMatchObject({
      questionKey: 'q-1',
      answer: { value: 'YES' },
      result: 'PASS',
    });
  });

  it('fails the lot when a check is answered NO, and names the check', () => {
    const { service } = setup();
    const result = service.evaluate(
      template(),
      [{ questionKey: 'q-1', answer: 'NO', comments: 'Carton crushed on one corner' }],
      'CM-00010',
    );
    expect(result.result).toBe('FAIL');
    expect(result.failedPrompts).toEqual([
      'Packaging intact, no transit damage',
    ]);
    expect(result.responses[0].comments).toBe('Carton crushed on one corner');
  });

  it('refuses a bare FAIL when the template asks for evidence', () => {
    const { service } = setup();
    expect(() =>
      service.evaluate(template(), [{ questionKey: 'q-1', answer: 'NO' }], 'CM-00010'),
    ).toThrow(BadRequestException);
  });

  it('accepts a FAIL with no evidence when the template does not require it', () => {
    const { service } = setup();
    const tpl = template([question({ evidenceOnFailure: false })]);
    expect(
      service.evaluate(tpl, [{ questionKey: 'q-1', answer: 'NO' }], 'CM-00010')
        .result,
    ).toBe('FAIL');
  });

  it('treats NA as neither a pass nor a failure of the lot', () => {
    const { service } = setup();
    const result = service.evaluate(
      template(),
      [{ questionKey: 'q-1', answer: 'NA' }],
      'CM-00010',
    );
    expect(result.result).toBe('PASS');
    expect(result.responses[0].result).toBe('NOT_APPLICABLE');
  });

  it.each([
    ['PASS_FAIL_NA', 'PASS', 'FAIL'],
    ['OK_NOTOK_NA', 'OK', 'NOT OK'],
  ])('grades the %s vocabulary', (responseType, good, bad) => {
    const { service } = setup();
    const tpl = template([question({ responseType, evidenceOnFailure: false })]);
    expect(
      service.evaluate(tpl, [{ questionKey: 'q-1', answer: good }], 'X').result,
    ).toBe('PASS');
    expect(
      service.evaluate(tpl, [{ questionKey: 'q-1', answer: bad }], 'X').result,
    ).toBe('FAIL');
  });

  it('rejects an answer outside the question vocabulary rather than passing it', () => {
    // A typo must never be silently graded as conformance.
    const { service } = setup();
    expect(() =>
      service.evaluate(template(), [{ questionKey: 'q-1', answer: 'Yeah' }], 'X'),
    ).toThrow(/unrecognised answer/);
  });

  it('demands every required question, and records an optional blank', () => {
    const { service } = setup();
    expect(() => service.evaluate(template(), [], 'CM-00010')).toThrow(
      /is required and has not been answered/,
    );

    const optional = template([
      question({ id: 'q-2', required: false, responseType: 'TEXT' }),
    ]);
    const result = service.evaluate(optional, [], 'CM-00010');
    expect(result.result).toBe('PASS');
    expect(result.responses[0]).toMatchObject({
      answer: { value: '' },
      result: null,
    });
  });

  it('judges a measurement against the template limits', () => {
    const { service } = setup();
    const tpl = template([
      question({
        responseType: 'MEASUREMENT',
        prompt: 'Surface finish Ra',
        unit: 'µm',
        lowerLimit: new Prisma.Decimal('0.4'),
        upperLimit: new Prisma.Decimal('1.6'),
        evidenceOnFailure: false,
      }),
    ]);
    expect(
      service.evaluate(tpl, [{ questionKey: 'q-1', answer: '1.2' }], 'X').result,
    ).toBe('PASS');
    expect(
      service.evaluate(tpl, [{ questionKey: 'q-1', answer: '1.61' }], 'X').result,
    ).toBe('FAIL');
    expect(
      service.evaluate(tpl, [{ questionKey: 'q-1', answer: '0.39' }], 'X').result,
    ).toBe('FAIL');
    // The boundary is inclusive — a part exactly on the limit conforms.
    expect(
      service.evaluate(tpl, [{ questionKey: 'q-1', answer: '1.6' }], 'X').result,
    ).toBe('PASS');
  });

  it('records an unbounded number without grading it', () => {
    const { service } = setup();
    const tpl = template([
      question({ responseType: 'NUMBER', prompt: 'Lot size sampled' }),
    ]);
    const result = service.evaluate(tpl, [{ questionKey: 'q-1', answer: '5' }], 'X');
    expect(result.result).toBe('PASS');
    expect(result.responses[0].result).toBeNull();
  });

  it('rejects a non-numeric answer to a measurement', () => {
    const { service } = setup();
    const tpl = template([
      question({
        responseType: 'MEASUREMENT',
        upperLimit: new Prisma.Decimal('1.6'),
      }),
    ]);
    expect(() =>
      service.evaluate(tpl, [{ questionKey: 'q-1', answer: 'smooth' }], 'X'),
    ).toThrow(/expects a number/);
  });

  it('names the line in every message, since several items are inspected at once', () => {
    const { service } = setup();
    expect(() => service.evaluate(template(), [], 'CM-00007')).toThrow(
      /^CM-00007:/,
    );
  });

  it('rejects answers to questions that are not on the template', () => {
    const { service } = setup();
    expect(() =>
      service.evaluate(
        template(),
        [
          { questionKey: 'q-1', answer: 'YES' },
          { questionKey: 'ghost', answer: 'YES' },
        ],
        'X',
      ),
    ).toThrow(/not on template INC-GEN/);
  });

  it('rejects the same question answered twice', () => {
    const { service } = setup();
    expect(() =>
      service.evaluate(
        template(),
        [
          { questionKey: 'q-1', answer: 'YES' },
          { questionKey: 'q-1', answer: 'NO' },
        ],
        'X',
      ),
    ).toThrow(/answered twice/);
  });
});

describe('IncomingInspectionService.loadTemplates', () => {
  it('refuses a template that is not approved', async () => {
    const { service } = setup([template([question()], { status: 'DRAFT' })]);
    await expect(service.loadTemplates(['tpl-1'])).rejects.toThrow(
      /only an APPROVED template can be inspected against/,
    );
  });

  it('refuses a template written for another control point', async () => {
    const { service } = setup([
      template([question()], { templateType: 'PRE_DISPATCH' }),
    ]);
    await expect(service.loadTemplates(['tpl-1'])).rejects.toThrow(
      /must use an INCOMING template/,
    );
  });

  it('refuses an unknown template', async () => {
    const { service } = setup([]);
    await expect(service.loadTemplates(['tpl-9'])).rejects.toThrow(
      /Inspection template not found/,
    );
  });

  it('loads each distinct template once, however many lines share it', async () => {
    const { service, prisma } = setup();
    const byId = await service.loadTemplates(['tpl-1', 'tpl-1', 'tpl-1']);
    expect(byId.get('tpl-1')).toBeDefined();
    expect(prisma.qmsQuestionTemplate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ['tpl-1'] } } }),
    );
  });
});

describe('IncomingInspectionService.createForGrnLine', () => {
  const evaluation = {
    result: 'PASS' as const,
    failedPrompts: [] as string[],
    responses: [
      {
        questionKey: 'q-1',
        section: 'Receipt',
        sequence: 1,
        promptSnapshot: 'Packaging intact, no transit damage',
        responseType: 'YES_NO_NA' as never,
        required: true,
        answer: { value: 'YES' },
        result: 'PASS' as never,
        comments: null,
      },
    ],
  };

  function args(overrides: Record<string, unknown> = {}) {
    return {
      template: template(),
      evaluation,
      grnId: 'grn-1',
      grnLineId: 'grn-line-1',
      grnNumber: 'GRN-2026-0002',
      receivedQuantity: new Prisma.Decimal(10),
      acceptedQuantity: new Prisma.Decimal(10),
      rejectedQuantity: new Prisma.Decimal(0),
      inspectorId: 'qc-1',
      inspectedAt: new Date('2026-08-31T06:00:00Z'),
      ...overrides,
    } as never;
  }

  it('files a terminal PASSED inspection for a fully accepted lot', async () => {
    const { service, prisma } = setup();
    const created = await service.createForGrnLine(prisma as never, args());

    expect(created.inspectionNumber).toBe('QI-2026-00007');
    const data = prisma.qmsInspection.create.mock.calls[0][0].data;
    // Terminal, not PENDING_REVIEW: the QC inspector's decision IS the decision,
    // so nothing holds the received goods back waiting for a second person.
    expect(data.status).toBe('PASSED');
    expect(data.overallResult).toBe('PASS');
    expect(data.grnId).toBe('grn-1');
    expect(data.grnLineId).toBe('grn-line-1');
    expect(data.inspectedById).toBe('qc-1');
    expect(String(data.quantityOffered)).toBe('10');
    expect(String(data.quantityInspected)).toBe('10');
    expect(data.responses.create).toHaveLength(1);
  });

  it('freezes the template into the record so a later revision cannot rewrite history', async () => {
    const { service, prisma } = setup();
    await service.createForGrnLine(prisma as never, args());
    const snapshot = prisma.qmsInspection.create.mock.calls[0][0].data
      .templateSnapshot as Record<string, unknown>;
    expect(snapshot).toMatchObject({
      templateId: 'tpl-1',
      templateCode: 'INC-GEN',
      version: 1,
    });
    expect(snapshot.questions).toHaveLength(1);
  });

  it.each([
    [10, 0, 'PASSED', 'PASS'],
    [0, 10, 'FAILED', 'FAIL'],
    [8, 2, 'CONDITIONAL_PASS', 'CONDITIONAL_PASS'],
  ])(
    'describes the lot as %s accepted / %s rejected → %s',
    async (accepted, rejected, status, overall) => {
      const { service, prisma } = setup();
      await service.createForGrnLine(
        prisma as never,
        args({
          acceptedQuantity: new Prisma.Decimal(accepted),
          rejectedQuantity: new Prisma.Decimal(rejected),
        }),
      );
      const data = prisma.qmsInspection.create.mock.calls[0][0].data;
      expect(data.status).toBe(status);
      expect(data.overallResult).toBe(overall);
    },
  );

  it('records the failed checks and the inspector remarks in the record', async () => {
    const { service, prisma } = setup();
    await service.createForGrnLine(
      prisma as never,
      args({
        evaluation: {
          ...evaluation,
          result: 'FAIL',
          failedPrompts: ['Leak test @ 6 bar'],
        },
        acceptedQuantity: new Prisma.Decimal(0),
        rejectedQuantity: new Prisma.Decimal(10),
        remarks: 'Vendor informed by phone.',
      }),
    );
    const remarks = prisma.qmsInspection.create.mock.calls[0][0].data
      .remarks as string;
    expect(remarks).toContain('GRN-2026-0002');
    expect(remarks).toContain('Failed checks: Leak test @ 6 bar.');
    expect(remarks).toContain('Vendor informed by phone.');
  });

  it('numbers from the same counter the QMS screens use', async () => {
    const { service, prisma } = setup();
    await service.createForGrnLine(prisma as never, args());
    expect(prisma.financeSequence.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          entity_year: {
            entity: 'QMS_INSPECTION',
            year: new Date().getUTCFullYear(),
          },
        },
      }),
    );
  });
});
