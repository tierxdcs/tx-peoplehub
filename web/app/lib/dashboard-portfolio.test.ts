import type { PlmDashboardItem } from './plm';
import type { ProjectProgress } from './project-kickoff';
import {
  portfolioBlockers,
  portfolioHealth,
  priorityProjects,
  urgentLifecycleWork,
} from './dashboard-portfolio';

function project(
  id: string,
  health: ProjectProgress['health'],
  nextDueDate: string | null,
): ProjectProgress {
  return {
    kickoffId: id,
    projectName: id,
    orderId: `order-${id}`,
    orderNumber: `ORD-${id}`,
    health,
    healthReason: '',
    currentStage: 'production',
    updatedAt: '2026-08-01T00:00:00.000Z',
    nextDueDate,
    stages: [],
  };
}

function line(
  id: string,
  health: PlmDashboardItem['health'],
  daysUntilDue: number | null,
  blocker: string | null = null,
): PlmDashboardItem {
  return {
    trackerId: id,
    orderId: `order-${id}`,
    orderNumber: `ORD-${id}`,
    customerName: null,
    productName: id,
    productSku: id,
    flowType: 'VENDOR',
    currentStage: 'PRODUCTION',
    ownerName: 'Owner',
    ageDays: 1,
    promisedDeliveryDate: null,
    daysUntilDue,
    blocker,
    health,
    production: { done: 0, total: 1 },
    hasPendingPing: false,
    updatedAt: '2026-08-01T00:00:00.000Z',
  };
}

describe('dashboard portfolio previews', () => {
  it('caps projects by health first and due date second', () => {
    const result = priorityProjects(
      [
        project('calm', 'ON_TRACK', '2026-08-02'),
        project('risk-later', 'AT_RISK', '2026-08-10'),
        project('blocked', 'BLOCKED', null),
        project('risk-sooner', 'AT_RISK', '2026-08-05'),
      ],
      3,
    );
    expect(result.map((item) => item.kickoffId)).toEqual([
      'blocked',
      'risk-sooner',
      'risk-later',
    ]);
  });

  it('caps lifecycle lines by health and delivery urgency', () => {
    const result = urgentLifecycleWork(
      [
        line('calm', 'ON_TRACK', -2),
        line('blocked-later', 'BLOCKED', 5),
        line('risk', 'AT_RISK', 1),
        line('blocked-sooner', 'BLOCKED', 2),
      ],
      3,
    );
    expect(result.map((item) => item.trackerId)).toEqual([
      'blocked-sooner',
      'blocked-later',
      'risk',
    ]);
  });

  it('derives charts from complete portfolio data and canonical blockers', () => {
    expect(
      portfolioHealth([
        project('a', 'ON_TRACK', null),
        project('b', 'AT_RISK', null),
        project('c', 'BLOCKED', null),
      ]),
    ).toEqual({ onTrack: 1, atRisk: 1, blocked: 1 });
    expect(
      portfolioBlockers([
        line('a', 'BLOCKED', null, 'QC required'),
        line('b', 'BLOCKED', null, 'QC required'),
        line('c', 'BLOCKED', null, 'Challan required'),
      ]),
    ).toEqual([
      { reason: 'QC required', count: 2 },
      { reason: 'Challan required', count: 1 },
    ]);
  });
});
