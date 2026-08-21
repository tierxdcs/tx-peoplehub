import {
  deriveProjectProgress,
  type ProjectProgressInput,
} from './project-progress';

function input(
  overrides: Partial<ProjectProgressInput> = {},
): ProjectProgressInput {
  return {
    kickoffId: 'kickoff-1',
    projectName: 'Project Alpha',
    kickoffStatus: 'COMPLETED',
    meetingDate: new Date('2026-07-01'),
    updatedAt: new Date('2026-07-19'),
    order: {
      id: 'order-1',
      orderNumber: 'ORD-001',
      status: 'IN_PRODUCTION',
      finalQcStatus: 'PENDING',
      fulfilmentStatus: 'NOT_DISPATCHED',
    },
    designProject: null,
    rfqStatuses: [],
    inspectionStatuses: [],
    dispatchStatuses: [],
    plmStages: [],
    overdueMilestones: 0,
    overdueActions: 0,
    openHighRisks: 0,
    overdueVendorUpdates: 0,
    approachingVendorUpdates: 0,
    ...overrides,
  };
}

describe('deriveProjectProgress', () => {
  it('derives the current stage from operational order state', () => {
    const result = deriveProjectProgress(input());
    expect(result.currentStage).toBe('production');
    expect(
      result.stages.find((stage) => stage.key === 'production')?.state,
    ).toBe('IN_PROGRESS');
  });

  it('marks failed quality as a blocking red state', () => {
    const result = deriveProjectProgress(
      input({ inspectionStatuses: ['FAILED'] }),
    );
    expect(result.health).toBe('BLOCKED');
    expect(result.currentStage).toBe('quality');
  });

  it('surfaces overdue work and high risks as at risk', () => {
    const result = deriveProjectProgress(
      input({ overdueActions: 2, openHighRisks: 1 }),
    );
    expect(result.health).toBe('AT_RISK');
    expect(result.healthReason).toContain('2 overdue action item(s)');
  });

  it('marks an overdue vendor production update as blocking', () => {
    const result = deriveProjectProgress(input({ overdueVendorUpdates: 1 }));
    expect(result.health).toBe('BLOCKED');
    expect(result.healthReason).toContain('vendor production update');
  });

  it('marks an approaching vendor update deadline as at risk', () => {
    const result = deriveProjectProgress(
      input({ approachingVendorUpdates: 1 }),
    );
    expect(result.health).toBe('AT_RISK');
    expect(result.healthReason).toContain('due soon');
  });

  it('clamps a downstream stage that completed ahead of upstream ones', () => {
    // Real prod case (ORD-2026-0006): Final QC was cleared on an order still at
    // CONFIRMED that never entered production. Quality must NOT show green
    // ahead of Engineering / Procurement / Production.
    const result = deriveProjectProgress(
      input({
        order: {
          id: 'order-6',
          orderNumber: 'ORD-2026-0006',
          status: 'CONFIRMED',
          finalQcStatus: 'CLEARED',
          fulfilmentStatus: 'NOT_DISPATCHED',
        },
      }),
    );
    const byKey = Object.fromEntries(
      result.stages.map((stage) => [stage.key, stage]),
    );
    expect(byKey.quality.state).toBe('UPCOMING');
    expect(byKey.quality.detail).toBe('Awaiting final QC');
    expect(byKey.engineering.state).toBe('IN_PROGRESS');
    expect(byKey.procurement.state).toBe('UPCOMING');
    expect(byKey.production.state).toBe('UPCOMING');
    // Furthest genuinely-active stage is Engineering, not Quality.
    expect(result.currentStage).toBe('engineering');
  });

  it('uses PLM line progress when the order-level status has not caught up', () => {
    const result = deriveProjectProgress(
      input({
        order: {
          id: 'order-6',
          orderNumber: 'ORD-2026-0006',
          status: 'CONFIRMED',
          finalQcStatus: 'PENDING',
          fulfilmentStatus: 'NOT_DISPATCHED',
        },
        plmStages: ['DISPATCH'],
      }),
    );
    const byKey = Object.fromEntries(
      result.stages.map((stage) => [stage.key, stage]),
    );

    expect(byKey.engineering.state).toBe('COMPLETE');
    expect(byKey.procurement.state).toBe('COMPLETE');
    expect(byKey.production.state).toBe('COMPLETE');
    expect(byKey.quality.state).toBe('COMPLETE');
    expect(byKey.dispatch.state).toBe('IN_PROGRESS');
    expect(result.currentStage).toBe('dispatch');
  });

  it('uses the least advanced PLM line for aggregate project progress', () => {
    const result = deriveProjectProgress(
      input({
        order: {
          id: 'order-multi',
          orderNumber: 'ORD-2026-0100',
          status: 'CONFIRMED',
          finalQcStatus: 'PENDING',
          fulfilmentStatus: 'NOT_DISPATCHED',
        },
        plmStages: ['DISPATCH', 'PRODUCTION'],
      }),
    );
    const byKey = Object.fromEntries(
      result.stages.map((stage) => [stage.key, stage]),
    );

    expect(byKey.procurement.state).toBe('COMPLETE');
    expect(byKey.production.state).toBe('IN_PROGRESS');
    expect(byKey.quality.state).toBe('UPCOMING');
    expect(byKey.dispatch.state).toBe('UPCOMING');
  });

  it('still surfaces a failed inspection even when upstream stages are incomplete', () => {
    // The clamp applies to COMPLETE only — a genuine failure must never be hidden.
    const result = deriveProjectProgress(
      input({
        order: {
          id: 'order-x',
          orderNumber: 'ORD-2026-0099',
          status: 'CONFIRMED',
          finalQcStatus: 'PENDING',
          fulfilmentStatus: 'NOT_DISPATCHED',
        },
        inspectionStatuses: ['FAILED'],
      }),
    );
    expect(
      result.stages.find((stage) => stage.key === 'quality')?.state,
    ).toBe('ATTENTION');
    expect(result.currentStage).toBe('quality');
    expect(result.health).toBe('BLOCKED');
  });
});
