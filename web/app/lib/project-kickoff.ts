'use client';

import { apiFetch } from './api';

/**
 * Project Kickoff client: entity types (mirroring the backend entities) plus a
 * thin typed wrapper over each endpoint. apiFetch returns the unwrapped `data`.
 * Access is enforced server-side (ProjectKickoffAccessService) — these are
 * transport only.
 */

export type KickoffMeetingMode = 'IN_PERSON' | 'VIRTUAL' | 'HYBRID';
export type KickoffStatus = 'DRAFT' | 'COMPLETED';
export type MilestoneStatus =
  | 'PENDING'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'DELAYED';
export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH';
export type RiskStatus = 'OPEN' | 'MITIGATED' | 'CLOSED';
/** Computed from the linked Kanban card's list at read time. */
export type ActionItemStatus =
  | 'TODO'
  | 'IN_PROGRESS'
  | 'DONE'
  | 'ARCHIVED'
  | 'UNLINKED';

export interface KickoffAttendee {
  id: string;
  kickoffId: string;
  employeeId: string | null;
  name: string | null;
  externalOrganization: string | null;
  designation: string | null;
  department: string | null;
  isInternal: boolean;
}

export interface KickoffMilestone {
  id: string;
  kickoffId: string;
  name: string;
  targetDate: string;
  ownerId: string | null;
  ownerName: string | null;
  status: MilestoneStatus;
}

export interface KickoffActionItem {
  id: string;
  kickoffId: string;
  description: string;
  ownerId: string;
  ownerName: string | null;
  dueDate: string | null;
  kanbanCardId: string | null;
  currentListName: string | null;
  status: ActionItemStatus;
}

export interface KickoffRisk {
  id: string;
  kickoffId: string;
  description: string;
  likelihood: RiskLevel;
  impact: RiskLevel;
  mitigationPlan: string | null;
  ownerId: string | null;
  ownerName: string | null;
  status: RiskStatus;
}

export type DeliveryType = 'NPD' | 'IN_HOUSE' | 'VENDOR';

export interface KickoffDeliveryItem {
  id: string;
  productName: string;
  productSku: string;
  quantity: string;
  deliveryType: DeliveryType | null;
  vendorName: string | null;
  vendorContactInfo: string | null;
  vendorExpectedLeadTime: string | null;
}

export interface ProjectKickoff {
  id: string;
  orderId: string;
  projectName: string;
  meetingDate: string;
  meetingMode: KickoffMeetingMode;
  meetingLocation: string | null;
  overviewAndScope: string | null;
  minutesNotes: string | null;
  status: KickoffStatus;
  kanbanBoardId: string;
  createdById: string;
  createdAt: string;
  updatedAt: string;
  attendees?: KickoffAttendee[];
  milestones?: KickoffMilestone[];
  actionItems?: KickoffActionItem[];
  risks?: KickoffRisk[];
  deliveryItems?: KickoffDeliveryItem[];
}

/** An order a PM may start a kickoff for (executed sheet, no kickoff yet). */
export interface EligibleOrder {
  id: string;
  orderNumber: string;
  customerName: string;
}

/** The linked order's EXECUTED confirmation sheet, surfaced on the kickoff page. */
export interface KickoffConfirmationSheet {
  id: string;
  confirmationNumber: string;
  revisionNumber: number;
  executedAt: string | null;
  hasSignedCopy: boolean;
  /** Short-lived R2 presigned URL for the signed copy; null if none uploaded. */
  downloadUrl: string | null;
  expiresInSeconds: number | null;
}

// ── Kickoff ──────────────────────────────────────────────────────────
export function listKickoffs() {
  return apiFetch<ProjectKickoff[]>('/project-kickoffs');
}

/**
 * The linked order's current EXECUTED confirmation sheet (+ presigned signed-copy
 * URL), for in-meeting reference. Returns null if the order has no executed sheet.
 */
export function getKickoffConfirmationSheet(id: string) {
  return apiFetch<KickoffConfirmationSheet | null>(
    `/project-kickoffs/${id}/confirmation-sheet`,
  );
}

/** Orders eligible for a new kickoff — PM/SUPER_ADMIN only (403 otherwise). */
export function listEligibleOrders() {
  return apiFetch<EligibleOrder[]>('/project-kickoffs/eligible-orders');
}

export function getKickoff(id: string) {
  return apiFetch<ProjectKickoff>(`/project-kickoffs/${id}`);
}

export interface CreateKickoffInput {
  orderId: string;
  projectName?: string;
  meetingDate: string;
  meetingMode?: KickoffMeetingMode;
  meetingLocation?: string;
  overviewAndScope?: string;
  minutesNotes?: string;
}

export function createKickoff(input: CreateKickoffInput) {
  return apiFetch<ProjectKickoff>('/project-kickoffs', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export interface UpdateKickoffInput {
  projectName?: string;
  meetingDate?: string;
  meetingMode?: KickoffMeetingMode;
  meetingLocation?: string | null;
  overviewAndScope?: string | null;
  minutesNotes?: string | null;
  status?: KickoffStatus;
}

export function updateKickoff(id: string, input: UpdateKickoffInput) {
  return apiFetch<ProjectKickoff>(`/project-kickoffs/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

// ── Attendees ────────────────────────────────────────────────────────
export interface CreateAttendeeInput {
  employeeId?: string;
  externalName?: string;
  externalOrganization?: string;
  designation?: string;
  department?: string;
}

export function addAttendee(kickoffId: string, input: CreateAttendeeInput) {
  return apiFetch<KickoffAttendee>(`/project-kickoffs/${kickoffId}/attendees`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function removeAttendee(kickoffId: string, attendeeId: string) {
  return apiFetch<void>(
    `/project-kickoffs/${kickoffId}/attendees/${attendeeId}`,
    { method: 'DELETE' },
  );
}

// ── Milestones ───────────────────────────────────────────────────────
export interface CreateMilestoneInput {
  name: string;
  targetDate: string;
  ownerId?: string;
  status?: MilestoneStatus;
}

export function addMilestone(kickoffId: string, input: CreateMilestoneInput) {
  return apiFetch<KickoffMilestone>(
    `/project-kickoffs/${kickoffId}/milestones`,
    { method: 'POST', body: JSON.stringify(input) },
  );
}

export function updateMilestone(
  kickoffId: string,
  milestoneId: string,
  input: Partial<CreateMilestoneInput> & { ownerId?: string | null },
) {
  return apiFetch<KickoffMilestone>(
    `/project-kickoffs/${kickoffId}/milestones/${milestoneId}`,
    { method: 'PATCH', body: JSON.stringify(input) },
  );
}

export function removeMilestone(kickoffId: string, milestoneId: string) {
  return apiFetch<void>(
    `/project-kickoffs/${kickoffId}/milestones/${milestoneId}`,
    { method: 'DELETE' },
  );
}

// ── Action items ─────────────────────────────────────────────────────
export interface CreateActionItemInput {
  description: string;
  ownerId: string;
  dueDate?: string;
}

export function addActionItem(kickoffId: string, input: CreateActionItemInput) {
  return apiFetch<KickoffActionItem>(
    `/project-kickoffs/${kickoffId}/action-items`,
    { method: 'POST', body: JSON.stringify(input) },
  );
}

export function updateActionItem(
  kickoffId: string,
  actionItemId: string,
  input: { description?: string; dueDate?: string | null },
) {
  return apiFetch<KickoffActionItem>(
    `/project-kickoffs/${kickoffId}/action-items/${actionItemId}`,
    { method: 'PATCH', body: JSON.stringify(input) },
  );
}

export function removeActionItem(kickoffId: string, actionItemId: string) {
  return apiFetch<void>(
    `/project-kickoffs/${kickoffId}/action-items/${actionItemId}`,
    { method: 'DELETE' },
  );
}

// ── Risks ────────────────────────────────────────────────────────────
export interface CreateRiskInput {
  description: string;
  likelihood?: RiskLevel;
  impact?: RiskLevel;
  mitigationPlan?: string;
  ownerId?: string;
}

export function addRisk(kickoffId: string, input: CreateRiskInput) {
  return apiFetch<KickoffRisk>(`/project-kickoffs/${kickoffId}/risks`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateRisk(
  kickoffId: string,
  riskId: string,
  input: Partial<CreateRiskInput> & {
    ownerId?: string | null;
    status?: RiskStatus;
  },
) {
  return apiFetch<KickoffRisk>(
    `/project-kickoffs/${kickoffId}/risks/${riskId}`,
    { method: 'PATCH', body: JSON.stringify(input) },
  );
}

export function removeRisk(kickoffId: string, riskId: string) {
  return apiFetch<void>(`/project-kickoffs/${kickoffId}/risks/${riskId}`, {
    method: 'DELETE',
  });
}

// ── Delivery classification (per order line item) ────────────────────
export interface UpdateDeliveryItemInput {
  deliveryType?: DeliveryType;
  vendorName?: string | null;
  vendorContactInfo?: string | null;
  vendorExpectedLeadTime?: string | null;
}

export function updateDeliveryItem(
  kickoffId: string,
  lineItemId: string,
  input: UpdateDeliveryItemInput,
) {
  return apiFetch<KickoffDeliveryItem>(
    `/project-kickoffs/${kickoffId}/delivery-items/${lineItemId}`,
    { method: 'PATCH', body: JSON.stringify(input) },
  );
}

export const DELIVERY_TYPE_LABEL: Record<DeliveryType, string> = {
  NPD: 'NPD',
  IN_HOUSE: 'In-House',
  VENDOR: 'Vendor',
};

// ── UI label maps ────────────────────────────────────────────────────
export const MEETING_MODE_LABEL: Record<KickoffMeetingMode, string> = {
  IN_PERSON: 'In person',
  VIRTUAL: 'Virtual',
  HYBRID: 'Hybrid',
};

export const ACTION_ITEM_STATUS_LABEL: Record<ActionItemStatus, string> = {
  TODO: 'To Do',
  IN_PROGRESS: 'In Progress',
  DONE: 'Done',
  ARCHIVED: 'Archived',
  UNLINKED: 'Unlinked',
};
