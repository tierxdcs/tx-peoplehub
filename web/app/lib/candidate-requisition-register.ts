/**
 * Filtering and sorting for the Candidate Requisition register.
 *
 * Kept out of the page because the interesting rules are not about React: a
 * requisition's visible stage is a fold of two independent server enums (its
 * approval status and, once approved, HR's hiring stage), and "sort by stage"
 * must follow the lifecycle rather than the alphabet — REJECTED does not belong
 * between OFFER EXTENDED and PENDING.
 */

/** The shape the register needs; the page's fuller `Requisition` satisfies it. */
export interface RequisitionRegisterRow {
  requisitionNumber: string;
  positionTitle: string;
  status: string;
  hiringStage: string | null;
  budgetAnnualCtc: string | null;
  selectedCandidateName: string | null;
  requestedBy: { id: string; firstName: string; lastName: string };
  vertical: { name: string };
}

/**
 * Every stage a requisition can show, in the order it actually passes through
 * them. This doubles as the sort order for the Hiring status column and as the
 * order of the stage dropdown, so the two never disagree.
 */
export const REQUISITION_LIFECYCLE_STAGES = [
  'PENDING VERTICAL APPROVAL',
  'PENDING SUPERADMIN APPROVAL',
  'APPROVED',
  'JOB POSTED',
  'INTERVIEWING',
  'OFFER EXTENDED',
  'FULFILLED',
  'REJECTED',
  'CANCELLED',
] as const;

/**
 * The stages that need nothing further from anyone: the position is filled, or
 * it was refused, or it was withdrawn. Everything else is still live work,
 * which is what the "Open" group in the dropdown selects.
 */
const CLOSED_STAGES = new Set(['FULFILLED', 'REJECTED', 'CANCELLED']);

/**
 * The single stage shown in the register — the approval status until the
 * requisition is approved, HR's hiring stage after that. CANDIDATE_SELECTED is
 * shown as FULFILLED because by then the candidate has accepted and been
 * onboarded; selection alone does not reach this label.
 */
export function requisitionStage(row: RequisitionRegisterRow): string {
  if (row.status !== 'APPROVED') return row.status.replaceAll('_', ' ');
  if (row.hiringStage === 'CANDIDATE_SELECTED') return 'FULFILLED';
  return row.hiringStage?.replaceAll('_', ' ') ?? 'APPROVED';
}

export function requisitionRequesterName(row: RequisitionRegisterRow): string {
  return `${row.requestedBy.firstName} ${row.requestedBy.lastName}`.trim();
}

/** What the search box matches against. */
export function requisitionSearchText(row: RequisitionRegisterRow): string {
  return [
    row.requisitionNumber,
    row.positionTitle,
    requisitionStage(row),
    requisitionRequesterName(row),
    row.vertical.name,
    row.selectedCandidateName ?? '',
  ].join(' ');
}

export interface RequisitionFilters {
  /**
   * '' for everything, 'group:open' / 'group:closed' for the two groups, or an
   * exact stage label from REQUISITION_LIFECYCLE_STAGES.
   */
  stage: string;
  /** Vertical name, matching what the register column shows. */
  vertical: string;
  /** Requester employee id — names are not unique, ids are. */
  requesterId: string;
}

export const EMPTY_REQUISITION_FILTERS: RequisitionFilters = {
  stage: '',
  vertical: '',
  requesterId: '',
};

export function hasActiveRequisitionFilters(
  filters: RequisitionFilters,
): boolean {
  return !!(filters.stage || filters.vertical || filters.requesterId);
}

export function filterRequisitions<T extends RequisitionRegisterRow>(
  rows: T[],
  { stage, vertical, requesterId }: RequisitionFilters,
): T[] {
  return rows.filter((row) => {
    if (vertical && row.vertical.name !== vertical) return false;
    if (requesterId && row.requestedBy.id !== requesterId) return false;
    if (!stage) return true;
    const rowStage = requisitionStage(row);
    if (stage === 'group:open') return !CLOSED_STAGES.has(rowStage);
    if (stage === 'group:closed') return CLOSED_STAGES.has(rowStage);
    return rowStage === stage;
  });
}

export type RequisitionSortKey =
  | 'requisitionNumber'
  | 'positionTitle'
  | 'requester'
  | 'budgetAnnualCtc'
  | 'stage';

export type SortDirection = 'asc' | 'desc';

/** The direction each column opens in when it is first clicked. */
export const REQUISITION_SORT_DEFAULT_DIRECTION: Record<
  RequisitionSortKey,
  SortDirection
> = {
  // Newest requisition first, which is the order the register already arrives in.
  requisitionNumber: 'desc',
  positionTitle: 'asc',
  requester: 'asc',
  // The expensive positions are the ones worth looking at first.
  budgetAnnualCtc: 'desc',
  // Earliest stage first: what still needs work, before what is already done.
  stage: 'asc',
};

/**
 * Sort a copy of the rows. A missing budget always sorts last whichever way the
 * column is pointing — it is absent data, not a small number, so burying it
 * under the real figures is the honest placement. Ties fall back to the
 * requisition number so the order never wobbles between renders.
 */
export function sortRequisitions<T extends RequisitionRegisterRow>(
  rows: T[],
  key: RequisitionSortKey,
  direction: SortDirection,
): T[] {
  const sign = direction === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    let cmp = 0;
    if (key === 'budgetAnnualCtc') {
      const av = a.budgetAnnualCtc === null ? null : Number(a.budgetAnnualCtc);
      const bv = b.budgetAnnualCtc === null ? null : Number(b.budgetAnnualCtc);
      if (av === null || Number.isNaN(av)) return bv === null ? 0 : 1;
      if (bv === null || Number.isNaN(bv)) return -1;
      cmp = av - bv;
    } else if (key === 'stage') {
      cmp = stageRank(requisitionStage(a)) - stageRank(requisitionStage(b));
    } else {
      const av =
        key === 'requester' ? requisitionRequesterName(a) : String(a[key]);
      const bv =
        key === 'requester' ? requisitionRequesterName(b) : String(b[key]);
      cmp = av.localeCompare(bv);
    }
    if (cmp !== 0) return sign * cmp;
    return b.requisitionNumber.localeCompare(a.requisitionNumber);
  });
}

/** Unknown stages sort after every known one rather than at the top. */
function stageRank(stage: string): number {
  const index = (REQUISITION_LIFECYCLE_STAGES as readonly string[]).indexOf(
    stage,
  );
  return index === -1 ? REQUISITION_LIFECYCLE_STAGES.length : index;
}

/**
 * The dropdown contents, built from the rows actually on the register — an
 * option that would return nothing is worse than no option at all.
 */
export function requisitionFilterOptions(rows: RequisitionRegisterRow[]): {
  stages: string[];
  verticals: string[];
  requesters: { id: string; name: string }[];
} {
  const stages = new Set<string>();
  const verticals = new Set<string>();
  const requesters = new Map<string, string>();
  for (const row of rows) {
    stages.add(requisitionStage(row));
    verticals.add(row.vertical.name);
    requesters.set(row.requestedBy.id, requisitionRequesterName(row));
  }
  return {
    stages: [...stages].sort((a, b) => stageRank(a) - stageRank(b)),
    verticals: [...verticals].sort((a, b) => a.localeCompare(b)),
    requesters: [...requesters]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}
