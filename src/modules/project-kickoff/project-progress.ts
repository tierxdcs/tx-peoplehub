export type ProjectStageState =
  'COMPLETE' | 'IN_PROGRESS' | 'ATTENTION' | 'UPCOMING';
export type ProjectHealth = 'ON_TRACK' | 'AT_RISK' | 'BLOCKED';

export interface ProjectProgressInput {
  kickoffId: string;
  projectName: string;
  kickoffStatus: string;
  meetingDate: Date;
  updatedAt: Date;
  order: {
    id: string;
    orderNumber: string;
    status: string;
    finalQcStatus: string;
    fulfilmentStatus: string;
  };
  designProject: { id: string; status: string } | null;
  rfqStatuses: string[];
  inspectionStatuses: string[];
  dispatchStatuses: string[];
  overdueMilestones: number;
  overdueActions: number;
  openHighRisks: number;
  overdueVendorUpdates: number;
  approachingVendorUpdates: number;
}

export interface ProjectProgressStage {
  key: string;
  label: string;
  state: ProjectStageState;
  detail: string;
  href: string;
}

export interface ProjectProgressView {
  kickoffId: string;
  projectName: string;
  orderId: string;
  orderNumber: string;
  health: ProjectHealth;
  healthReason: string;
  currentStage: string;
  updatedAt: string;
  stages: ProjectProgressStage[];
}

const ORDER_ADVANCED = new Set([
  'IN_PRODUCTION',
  'READY_TO_SHIP',
  'SHIPPED',
  'DELIVERED',
]);
const PRODUCTION_COMPLETE = new Set(['READY_TO_SHIP', 'SHIPPED', 'DELIVERED']);
const DESIGN_COMPLETE = new Set(['RELEASED_FOR_PRODUCTION', 'CLOSED']);
const INSPECTION_FAILED = new Set(['FAILED']);
const INSPECTION_COMPLETE = new Set(['PASSED', 'CONDITIONAL_PASS']);

/** Pure status derivation: every lamp is calculated from operational records. */
export function deriveProjectProgress(
  input: ProjectProgressInput,
): ProjectProgressView {
  const cancelled = input.order.status === 'CANCELLED';
  const kickoffComplete =
    input.kickoffStatus === 'COMPLETED' ||
    ORDER_ADVANCED.has(input.order.status);
  const engineeringComplete =
    (input.designProject
      ? DESIGN_COMPLETE.has(input.designProject.status)
      : false) || ORDER_ADVANCED.has(input.order.status);
  const procurementComplete =
    (input.rfqStatuses.length > 0 &&
      input.rfqStatuses.every((s) => s === 'AWARDED')) ||
    ORDER_ADVANCED.has(input.order.status);
  const productionComplete = PRODUCTION_COMPLETE.has(input.order.status);
  const qualityFailed = input.inspectionStatuses.some((s) =>
    INSPECTION_FAILED.has(s),
  );
  const qualityComplete =
    input.order.finalQcStatus === 'CLEARED' ||
    (input.inspectionStatuses.length > 0 &&
      input.inspectionStatuses.every((s) => INSPECTION_COMPLETE.has(s)));
  const dispatchComplete =
    input.order.fulfilmentStatus === 'FULLY_DISPATCHED' ||
    ['SHIPPED', 'DELIVERED'].includes(input.order.status);
  const dispatchStarted =
    input.order.fulfilmentStatus === 'PARTIALLY_DISPATCHED' ||
    input.dispatchStatuses.some((s) =>
      ['DISPATCHED', 'IN_TRANSIT', 'DELIVERED'].includes(s),
    );

  // Monotonic clamp. Each *Complete flag above is derived independently from
  // its own operational record, so a downstream record can report "done" while
  // an upstream one hasn't (e.g. an order whose finalQcStatus is CLEARED while
  // it's still CONFIRMED and never entered production). Left unclamped, that
  // paints a later lamp green ahead of an earlier one and reads as broken.
  // Here a stage may only count as COMPLETE if every stage before it is also
  // COMPLETE. `complete` is the running prefix-AND used for all COMPLETE tests
  // and details below. Failure / in-progress states are intentionally NOT
  // clamped — they're computed from their own signals so a genuine problem
  // (e.g. a failed inspection) always surfaces regardless of upstream state.
  const STAGE_ORDER = [
    'order',
    'kickoff',
    'engineering',
    'procurement',
    'production',
    'quality',
    'dispatch',
  ] as const;
  const rawComplete: Record<(typeof STAGE_ORDER)[number], boolean> = {
    order: !cancelled,
    kickoff: kickoffComplete,
    engineering: engineeringComplete,
    procurement: procurementComplete,
    production: productionComplete,
    quality: qualityComplete,
    dispatch: dispatchComplete,
  };
  const complete = {} as Record<(typeof STAGE_ORDER)[number], boolean>;
  let priorAllComplete = true;
  for (const key of STAGE_ORDER) {
    complete[key] = priorAllComplete && rawComplete[key];
    priorAllComplete = complete[key];
  }

  const stages: ProjectProgressStage[] = [
    {
      key: 'order',
      label: 'Order',
      state: cancelled ? 'ATTENTION' : 'COMPLETE',
      detail: cancelled ? 'Order cancelled' : 'Order confirmed',
      href: `/sales/orders/${input.order.id}`,
    },
    {
      key: 'kickoff',
      label: 'Kickoff',
      state: cancelled
        ? 'UPCOMING'
        : complete.kickoff
          ? 'COMPLETE'
          : 'IN_PROGRESS',
      detail: complete.kickoff ? 'Kickoff completed' : 'Kickoff in progress',
      href: `/project-kickoff/${input.kickoffId}`,
    },
    {
      key: 'engineering',
      label: 'Engineering',
      state: complete.engineering
        ? 'COMPLETE'
        : complete.kickoff
          ? input.designProject?.status === 'ON_HOLD'
            ? 'ATTENTION'
            : 'IN_PROGRESS'
          : 'UPCOMING',
      detail: complete.engineering
        ? 'Released for production'
        : input.designProject
          ? input.designProject.status.replaceAll('_', ' ').toLowerCase()
          : 'Awaiting engineering release',
      href: input.designProject
        ? `/design/projects?projectId=${input.designProject.id}`
        : `/project-kickoff/${input.kickoffId}`,
    },
    {
      key: 'procurement',
      label: 'Procurement',
      state: complete.procurement
        ? 'COMPLETE'
        : complete.engineering
          ? input.rfqStatuses.some((s) => s === 'CANCELLED')
            ? 'ATTENTION'
            : 'IN_PROGRESS'
          : 'UPCOMING',
      detail: complete.procurement
        ? 'Material sourcing complete'
        : input.rfqStatuses.length
          ? `${input.rfqStatuses.length} RFQ(s) active`
          : 'Awaiting material sourcing',
      href: `/scm/rfqs?projectKickoffId=${input.kickoffId}`,
    },
    {
      key: 'production',
      label: 'Production',
      state: complete.production
        ? 'COMPLETE'
        : input.order.status === 'IN_PRODUCTION'
          ? 'IN_PROGRESS'
          : 'UPCOMING',
      detail: complete.production
        ? 'Ready to ship'
        : input.order.status === 'IN_PRODUCTION'
          ? 'In production'
          : 'Not started',
      href: `/sales/orders/${input.order.id}`,
    },
    {
      key: 'quality',
      label: 'Quality',
      state: qualityFailed
        ? 'ATTENTION'
        : complete.quality
          ? 'COMPLETE'
          : complete.production
            ? 'IN_PROGRESS'
            : 'UPCOMING',
      detail: qualityFailed
        ? 'Inspection failed'
        : complete.quality
          ? 'Final QC cleared'
          : 'Awaiting final QC',
      href: `/qms/inspections?orderId=${input.order.id}`,
    },
    {
      key: 'dispatch',
      label: 'Dispatch',
      state: complete.dispatch
        ? 'COMPLETE'
        : dispatchStarted
          ? 'IN_PROGRESS'
          : 'UPCOMING',
      detail: complete.dispatch
        ? 'Fully dispatched'
        : dispatchStarted
          ? 'Partially dispatched'
          : 'Awaiting dispatch',
      href: `/logistics/dispatch?orderId=${input.order.id}`,
    },
  ];

  let health: ProjectHealth = 'ON_TRACK';
  let healthReason = 'No active blockers';
  if (cancelled || qualityFailed || input.overdueVendorUpdates) {
    health = 'BLOCKED';
    healthReason = cancelled
      ? 'Order is cancelled'
      : qualityFailed
        ? 'A quality inspection has failed'
        : `${input.overdueVendorUpdates} vendor production update(s) overdue`;
  } else if (
    input.overdueMilestones ||
    input.overdueActions ||
    input.openHighRisks ||
    input.approachingVendorUpdates
  ) {
    health = 'AT_RISK';
    const reasons = [
      input.overdueMilestones
        ? `${input.overdueMilestones} overdue milestone(s)`
        : null,
      input.overdueActions
        ? `${input.overdueActions} overdue action item(s)`
        : null,
      input.openHighRisks
        ? `${input.openHighRisks} open high-impact risk(s)`
        : null,
      input.approachingVendorUpdates
        ? `${input.approachingVendorUpdates} vendor update(s) due soon`
        : null,
    ].filter(Boolean);
    healthReason = reasons.join(' · ');
  }

  const currentStage =
    stages.find((stage) => stage.state === 'ATTENTION')?.key ??
    stages.find((stage) => stage.state === 'IN_PROGRESS')?.key ??
    [...stages].reverse().find((stage) => stage.state === 'COMPLETE')?.key ??
    'order';

  return {
    kickoffId: input.kickoffId,
    projectName: input.projectName,
    orderId: input.order.id,
    orderNumber: input.order.orderNumber,
    health,
    healthReason,
    currentStage,
    updatedAt: input.updatedAt.toISOString(),
    stages,
  };
}
