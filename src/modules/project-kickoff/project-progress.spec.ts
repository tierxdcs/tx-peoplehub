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
    overdueMilestones: 0,
    overdueActions: 0,
    openHighRisks: 0,
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
});
