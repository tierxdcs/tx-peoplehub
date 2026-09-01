'use client';

import { apiFetch } from './api';
import { dateOnlyStr, todayDateStr } from './date';

export interface CustomerBomCandidate {
  id: string;
  itemCode: string;
  name: string;
  score: number;
}

export interface CustomerBomIntake {
  id: string;
  productName: string;
  rawFileName: string | null;
  status: string;
  product: { id: string; sku: string; name: string } | null;
  bom: { id: string; status: string; revisionNumber: number } | null;
  suggestedUnitPrice: string | null;
  lines: Array<{
    id: string;
    description: string;
    quantity: string;
    unitOfMeasure: string;
    targetMarginPercent?: number;
    createdNewItem: boolean;
    resolvedItem: { itemCode: string; name: string };
  }>;
}

export const listCustomerBomIntakes = (opportunityId: string) =>
  apiFetch<CustomerBomIntake[]>(
    `/opportunities/${opportunityId}/customer-bom-intakes`,
  );

export const findCustomerBomMatches = (
  opportunityId: string,
  description: string,
) =>
  apiFetch<CustomerBomCandidate[]>(
    `/opportunities/${opportunityId}/customer-bom-intakes/matches`,
    { method: 'POST', body: JSON.stringify({ description }) },
  );

export const customerBomUploadUrl = (
  opportunityId: string,
  input: { fileName: string; mimeType: string; fileSize: number },
) =>
  apiFetch<{ fileKey: string; uploadUrl: string; expiresInSeconds: number }>(
    `/opportunities/${opportunityId}/customer-bom-intakes/upload-url`,
    { method: 'POST', body: JSON.stringify(input) },
  );

export const createCustomerBomIntake = (
  opportunityId: string,
  input: {
    businessUnitId: string;
    productName: string;
    unitOfMeasure: string;
    /** ISO date Sales promised the customer a price. */
    expectedBy?: string;
    fileKey?: string;
    fileName?: string;
    /**
     * The customer stated a requirement, not a parts list: the design team
     * designs the product and authors the BOM. Sent with no lines; the intake
     * parks in DESIGN_PENDING until the designed BOM is handed over.
     */
    requiresDesign?: boolean;
    /**
     * Required with `requiresDesign` — the design request goes out with the
     * intake, so the brief has to be in hand now. `targetDate` falls back to
     * `expectedBy` server-side.
     */
    design?: {
      title?: string;
      description: string;
      priority?: string;
      targetDate?: string;
    };
    lines: Array<{
      description: string;
      customerPartReference?: string;
      quantity: number;
      unitOfMeasure: string;
      existingItemId?: string;
      confirmCreateNew: boolean;
    }>;
  },
) =>
  apiFetch<CustomerBomIntake>(
    `/opportunities/${opportunityId}/customer-bom-intakes`,
    { method: 'POST', body: JSON.stringify(input) },
  );

// ── Open BOM Intake register / detail / revision ─────────────────────────────

export type IntakeDerivedStatus =
  | 'DESIGN_IN_PROGRESS'
  | 'DRAFT'
  | 'PENDING_APPROVAL'
  | 'RFQ_FLOATED'
  | 'PRICED'
  | 'RELEASED';

/**
 * Set once a supplier's quote has been accepted on one of the intake's RFQs —
 * the price Sales was waiting for is in.
 */
export interface IntakeApprovedQuote {
  rfqId: string;
  rfqNumber: string;
  receivedAt: string | null;
}

/**
 * The design work behind an intake whose parts list had to be designed, when one
 * has been raised. Only the newest request is carried: an older one exists only
 * because it was rejected or closed and the brief re-raised.
 */
export interface IntakeDesignRequest {
  id: string;
  requestNumber: string;
  status: 'OPEN' | 'ACCEPTED' | 'REJECTED' | 'CONVERTED' | 'CLOSED';
  title: string;
  priority: string;
  targetDate: string;
  project: {
    id: string;
    projectNumber: string;
    name: string;
    status: string;
  } | null;
}

export const DESIGN_REQUEST_STATUS_LABEL: Record<
  IntakeDesignRequest['status'],
  string
> = {
  OPEN: 'Awaiting design triage',
  ACCEPTED: 'Design accepted',
  REJECTED: 'Design rejected',
  CONVERTED: 'Design project running',
  CLOSED: 'Design closed',
};

export interface BomIntakeRegisterRow {
  id: string;
  productName: string;
  createdAt: string;
  /** The stored lifecycle state; DESIGN_PENDING means no BOM exists yet. */
  status: string;
  designRequest: IntakeDesignRequest | null;
  /** The date Sales promised the customer a price; null when none is agreed. */
  expectedBy: string | null;
  approvedQuote: IntakeApprovedQuote | null;
  derivedStatus: IntakeDerivedStatus;
  opportunity: { id: string; name: string; customer: { name: string } | null };
  businessUnit: { name: string };
  product: { sku: string; name: string } | null;
  bom: { id: string; status: string; revisionNumber: number } | null;
  createdBy: { firstName: string; lastName: string };
}

export const listBomIntakeRegister = () =>
  apiFetch<BomIntakeRegisterRow[]>('/customer-bom-intakes');

export interface BomIntakeDetail {
  id: string;
  productName: string;
  unitOfMeasure: string;
  rawFileName: string | null;
  createdAt: string;
  /** The stored lifecycle state; DESIGN_PENDING means no BOM exists yet. */
  status: string;
  designRequest: IntakeDesignRequest | null;
  expectedBy: string | null;
  approvedQuote: IntakeApprovedQuote | null;
  derivedStatus: IntakeDerivedStatus;
  opportunity: { id: string; name: string; customer: { name: string } | null };
  businessUnit: { name: string };
  product: { id: string; sku: string; name: string } | null;
  bom: {
    id: string;
    status: string;
    revisionNumber: number;
    /** Set when R&D rejected this revision — what Sales has to fix before resubmitting. */
    rejectionComment: string | null;
    lines: Array<{
      id: string;
      quantityPerUnit: string;
      unitOfMeasure: string;
      notes: string | null;
      item: { id: string; itemCode: string; name: string };
    }>;
  } | null;
  revisions: Array<{
    id: string;
    revisionNumber: number;
    status: string;
    revisionNotes: string | null;
    createdAt: string;
    createdBy: { firstName: string; lastName: string };
  }>;
  rfqs: Array<{
    id: string;
    rfqNumber: string;
    title: string;
    status: string;
    /** When the quote on this RFQ was accepted, if it was. */
    awardDecisionAt: string | null;
    createdAt: string;
    createdBy: { firstName: string; lastName: string };
  }>;
  suggestedUnitPrice: string | null;
  createdBy: { firstName: string; lastName: string };
}

export const getBomIntake = (id: string) =>
  apiFetch<BomIntakeDetail>(`/customer-bom-intakes/${id}`);

export interface IntakeFileLink {
  url: string;
  fileName: string | null;
  expiresInSeconds: number;
}

/**
 * The customer's uploaded source document. Presigned per click and short-lived,
 * so fetch it on the click and open the returned URL — never render it into an
 * href on page load.
 */
export const getBomIntakeFileUrl = (id: string) =>
  apiFetch<IntakeFileLink>(`/customer-bom-intakes/${id}/file`);

/** Set (or clear, with null) the date Sales promised the customer a price. */
export const setBomIntakeExpectedBy = (id: string, expectedBy: string | null) =>
  apiFetch<BomIntakeDetail>(`/customer-bom-intakes/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ expectedBy }),
  });

export const reviseBomIntake = (
  id: string,
  input: {
    revisionNotes: string;
    lines: Array<{
      description: string;
      customerPartReference?: string;
      quantity: number;
      unitOfMeasure: string;
      existingItemId?: string;
      confirmCreateNew: boolean;
    }>;
  },
) =>
  apiFetch<BomIntakeDetail>(`/customer-bom-intakes/${id}/revise`, {
    method: 'POST',
    body: JSON.stringify(input),
  });

/**
 * Ask the design team to design the product and author its BOM. Only valid for a
 * DESIGN_PENDING intake; the brief is what the design team works from.
 */
export const sendBomIntakeToDesign = (
  id: string,
  input: {
    title?: string;
    description: string;
    priority?: string;
    /** Defaults server-side to the date Sales promised the customer a price. */
    targetDate?: string;
  },
) =>
  apiFetch<BomIntakeDetail>(`/customer-bom-intakes/${id}/send-to-design`, {
    method: 'POST',
    body: JSON.stringify(input),
  });

/**
 * Hand the finished transcription to R&D for release approval. Sales-owner
 * scoped — deliberately not the R&D-vertical `POST /bom/:id/submit`.
 */
export const submitBomIntakeForApproval = (id: string) =>
  apiFetch<BomIntakeDetail>(`/customer-bom-intakes/${id}/submit`, {
    method: 'POST',
  });

export const INTAKE_STATUS_LABEL: Record<IntakeDerivedStatus, string> = {
  DESIGN_IN_PROGRESS: 'With design team',
  DRAFT: 'Draft',
  PENDING_APPROVAL: 'Pending R&D approval',
  RFQ_FLOATED: 'RFQ Floated',
  PRICED: 'Priced',
  RELEASED: 'Released',
};

/**
 * Badge text for a register row or the detail header. DESIGN_IN_PROGRESS covers
 * two states that read very differently to Sales — nobody has been asked yet
 * versus the design team is on it — so the presence of a request decides.
 */
export function intakeStatusLabel(row: {
  derivedStatus: IntakeDerivedStatus;
  designRequest: IntakeDesignRequest | null;
}): string {
  return row.derivedStatus === 'DESIGN_IN_PROGRESS' && !row.designRequest
    ? 'Design brief owed'
    : INTAKE_STATUS_LABEL[row.derivedStatus];
}

/** Matching tone: an unsent brief is an action Sales still owes. */
export function intakeStatusTone(row: {
  derivedStatus: IntakeDerivedStatus;
  designRequest: IntakeDesignRequest | null;
}) {
  return row.derivedStatus === 'DESIGN_IN_PROGRESS' && !row.designRequest
    ? ('warning' as const)
    : INTAKE_STATUS_TONE[row.derivedStatus];
}

export interface IntakeProgress {
  /** How much of the promised window has elapsed, 0–100 (clamped). */
  percent: number;
  /** Whole calendar days remaining; 0 on the day itself, negative once past. */
  daysLeft: number;
  overdue: boolean;
  /** Short label beside the bar, e.g. "6 days left" / "overdue by 3 days". */
  label: string;
}

/** Midnight UTC of a "YYYY-MM-DD" day — the repo's date-only convention. */
const dayStart = (dateStr: string) =>
  new Date(`${dateStr}T00:00:00.000Z`).getTime();

const DAY_MS = 86_400_000;

/**
 * Turn "raised on X, promised for Y" into a bar. Null when no date is promised —
 * the register then shows nothing rather than a bar at an invented position.
 * Deliberately calendar-day based (and on date-only strings, so no timezone can
 * shift it): a promise made for the 15th is not half a day late at noon on it.
 */
export function intakeProgress(
  createdAt: string,
  expectedBy: string | null,
  todayStr: string = todayDateStr(),
): IntakeProgress | null {
  if (!expectedBy) return null;
  const start = dayStart(dateOnlyStr(createdAt));
  const end = dayStart(dateOnlyStr(expectedBy));
  const today = dayStart(todayStr);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  const daysLeft = Math.round((end - today) / DAY_MS);
  const span = end - start;
  // A same-day (or backdated) promise has no window left to run down.
  const percent =
    span <= 0
      ? 100
      : Math.min(100, Math.max(0, ((today - start) / span) * 100));
  const overdue = daysLeft < 0;
  const label =
    daysLeft === 0
      ? 'due today'
      : overdue
        ? `overdue by ${-daysLeft} ${-daysLeft === 1 ? 'day' : 'days'}`
        : `${daysLeft} ${daysLeft === 1 ? 'day' : 'days'} left`;
  return { percent, daysLeft, overdue, label };
}

/** Signal ToneChip tone per derived status. */
export const INTAKE_STATUS_TONE: Record<
  IntakeDerivedStatus,
  'neutral' | 'info' | 'success' | 'warning' | 'danger'
> = {
  DESIGN_IN_PROGRESS: 'info',
  DRAFT: 'neutral',
  PENDING_APPROVAL: 'warning',
  RFQ_FLOATED: 'info',
  PRICED: 'success',
  RELEASED: 'success',
};

// ── The design team's side: quote-stage intakes it has to design ──────────────

/**
 * A row of the design team's queue. Deliberately carries no pricing: the
 * quote-stage cost estimate and suggested price are Sales' commercial
 * information and the backend never sends them here.
 */
export interface DesignBomIntakeRow {
  id: string;
  productName: string;
  unitOfMeasure: string;
  /** DESIGN_PENDING while the BOM is still owed; CREATED once handed over. */
  status: string;
  expectedBy: string | null;
  createdAt: string;
  opportunity: { id: string; name: string; customer: { name: string } | null };
  businessUnit: { name: string };
  bom: { id: string; status: string; revisionNumber: number } | null;
  designRequest: IntakeDesignRequest | null;
}

export interface DesignBomIntakeDetail extends Omit<
  DesignBomIntakeRow,
  'bom' | 'designRequest'
> {
  rawFileName: string | null;
  finishedGoodItemId: string | null;
  createdBy: { firstName: string; lastName: string };
  bom: {
    id: string;
    status: string;
    revisionNumber: number;
    revisionNotes: string | null;
    lines: Array<{
      id: string;
      quantityPerUnit: string;
      unitOfMeasure: string;
      notes: string | null;
      item: { id: string; itemCode: string; name: string };
    }>;
  } | null;
  /** Non-null here — an intake with no design request 404s on this route. The
   * brief (`description`) is design-detail-only; register rows omit it. */
  designRequest: IntakeDesignRequest & { description: string };
}

export const listDesignBomIntakes = () =>
  apiFetch<DesignBomIntakeRow[]>('/design/bom-intakes');

export const getDesignBomIntake = (id: string) =>
  apiFetch<DesignBomIntakeDetail>(`/design/bom-intakes/${id}`);

/** Same document as `getBomIntakeFileUrl`, behind the design gate. */
export const getDesignBomIntakeFileUrl = (id: string) =>
  apiFetch<IntakeFileLink>(`/design/bom-intakes/${id}/file`);

export const findDesignBomMatches = (id: string, description: string) =>
  apiFetch<CustomerBomCandidate[]>(`/design/bom-intakes/${id}/matches`, {
    method: 'POST',
    body: JSON.stringify({ description }),
  });

/**
 * Hand the designed parts list over. This is the moment the intake becomes
 * visible to SCM for RFQ — not BOM approval or release, which cannot come first
 * because release prices the product from a cost that only the awarded RFQ
 * produces.
 */
export const handoverDesignBom = (
  id: string,
  input: {
    notes?: string;
    lines: Array<{
      description: string;
      customerPartReference?: string;
      quantity: number;
      unitOfMeasure: string;
      existingItemId?: string;
      confirmCreateNew: boolean;
    }>;
  },
) =>
  apiFetch<DesignBomIntakeDetail>(`/design/bom-intakes/${id}/bom`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
