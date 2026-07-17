'use client';

import { apiFetch } from './api';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';

/**
 * Vendor Qualification (SCM) client. Authenticated calls use apiFetch (adds
 * the bearer, unwraps the envelope, throws ApiError). The PUBLIC vendor-form
 * calls use a bare fetch (no auth) — apiFetch would attach the session token to
 * an anonymous route — returning a discriminated result rather than throwing,
 * so the public page can render clean password/expired/revoked states.
 */

// ── Types (mirror the backend entities) ──────────────────────────────
export type VendorStatus =
  | 'PENDING_QUESTIONNAIRE'
  | 'QUESTIONNAIRE_SUBMITTED'
  | 'UNDER_AUDIT'
  | 'APPROVED_PREFERRED'
  | 'APPROVED'
  | 'CONDITIONALLY_APPROVED'
  | 'NOT_APPROVED';

export type QuestionnaireStatus = 'SENT' | 'SUBMITTED';
export type AuditType = 'PHYSICAL' | 'VIRTUAL';
export type VendorClassification =
  | 'APPROVED_PREFERRED'
  | 'APPROVED'
  | 'CONDITIONALLY_APPROVED'
  | 'NOT_APPROVED';

export interface Vendor {
  id: string;
  companyName: string;
  registeredAddress: string;
  factoryAddress: string;
  yearEstablished: string;
  numberOfEmployees: string;
  annualTurnover: string;
  msmeUdyamCertificate: string | null;
  contactPersonName: string;
  contactPersonDesignation: string;
  contactEmail: string;
  contactPhone: string;
  website: string | null;
  status: VendorStatus;
  createdById: string;
  createdAt: string;
  updatedAt: string;
}

export interface CertificateFile {
  storageKey: string;
  name: string;
  sizeBytes: number | null;
  contentType: string | null;
}

/** The 18 VSAQ section keys — each an opaque JSON blob on the questionnaire. */
export const SECTION_KEYS = [
  'businessProfile',
  'manufacturingCapability',
  'equipmentDetails',
  'productionCapacity',
  'qualityManagement',
  'engineeringCapability',
  'supplyChain',
  'traceability',
  'logistics',
  'sustainability',
  'informationSecurity',
  'businessContinuity',
  'ehs',
  'financialInformation',
  'customerSupport',
  'compliance',
  'references',
  'declaration',
] as const;

export type SectionKey = (typeof SECTION_KEYS)[number];

export type VendorQuestionnaire = {
  id: string;
  vendorId: string;
  revisionNumber: number;
  status: QuestionnaireStatus;
  submittedAt: string | null;
  qualityCertificateFiles: CertificateFile[];
  createdAt: string;
  updatedAt: string;
} & Record<SectionKey, Record<string, unknown> | null>;

export interface VendorInvite {
  id: string;
  questionnaireId: string;
  token: string;
  expiresAt: string;
  revokedAt: string | null;
  hasPassword: boolean;
  createdById: string;
  createdAt: string;
}

export interface VendorAudit {
  id: string;
  vendorId: string;
  questionnaireId: string;
  auditType: AuditType;
  auditDate: string;
  auditorId: string;
  auditorName: string | null;
  manufacturingCapabilityScore: string;
  capacityScore: string;
  qualitySystemScore: string;
  engineeringScore: string;
  financialStabilityScore: string;
  supplyChainScore: string;
  exportReadinessScore: string;
  sustainabilityScore: string;
  ehsScore: string;
  customerReferencesScore: string;
  totalScore: number;
  classification: VendorClassification;
  classificationLabel: string;
  auditNotes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface VendorDetail extends Vendor {
  questionnaires: VendorQuestionnaire[];
  audits: VendorAudit[];
}

// ── Authenticated (SCM staff) calls ──────────────────────────────────
export interface CreateVendorInput {
  companyName: string;
  registeredAddress: string;
  factoryAddress: string;
  yearEstablished: string;
  numberOfEmployees: string;
  annualTurnover: string;
  msmeUdyamCertificate?: string;
  contactPersonName: string;
  contactPersonDesignation: string;
  contactEmail: string;
  contactPhone: string;
  website?: string;
}

export function listVendors() {
  return apiFetch<Vendor[]>('/vendors');
}

export function getVendor(id: string) {
  return apiFetch<VendorDetail>(`/vendors/${id}`);
}

export function createVendor(input: CreateVendorInput) {
  return apiFetch<Vendor>('/vendors', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function createQuestionnaireRevision(vendorId: string) {
  return apiFetch<VendorQuestionnaire>(
    `/vendors/${vendorId}/questionnaires`,
    { method: 'POST' },
  );
}

export function createInvite(
  questionnaireId: string,
  input: { expiresInHours?: number; password?: string },
) {
  return apiFetch<VendorInvite>(
    `/vendors/questionnaires/${questionnaireId}/invites`,
    { method: 'POST', body: JSON.stringify(input) },
  );
}

export function revokeInvite(inviteId: string) {
  return apiFetch<void>(`/vendors/invites/${inviteId}`, { method: 'DELETE' });
}

export interface CreateAuditInput {
  questionnaireId: string;
  auditType: AuditType;
  auditDate: string;
  manufacturingCapabilityScore: number;
  capacityScore: number;
  qualitySystemScore: number;
  engineeringScore: number;
  financialStabilityScore: number;
  supplyChainScore: number;
  exportReadinessScore: number;
  sustainabilityScore: number;
  ehsScore: number;
  customerReferencesScore: number;
  auditNotes?: string;
}

export function createAudit(vendorId: string, input: CreateAuditInput) {
  return apiFetch<VendorAudit>(`/vendors/${vendorId}/audits`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

// ── Scoring (mirrors backend vendor-scoring.ts) ────────────────────
export const AUDIT_CATEGORIES: {
  key: keyof CreateAuditInput;
  label: string;
  max: number;
}[] = [
  { key: 'manufacturingCapabilityScore', label: 'Manufacturing Capability', max: 20 },
  { key: 'capacityScore', label: 'Capacity', max: 10 },
  { key: 'qualitySystemScore', label: 'Quality System', max: 20 },
  { key: 'engineeringScore', label: 'Engineering', max: 10 },
  { key: 'financialStabilityScore', label: 'Financial Stability', max: 5 },
  { key: 'supplyChainScore', label: 'Supply Chain', max: 10 },
  { key: 'exportReadinessScore', label: 'Export Readiness', max: 10 },
  { key: 'sustainabilityScore', label: 'Sustainability', max: 5 },
  { key: 'ehsScore', label: 'EHS', max: 5 },
  { key: 'customerReferencesScore', label: 'Customer References', max: 5 },
];

/** Live classification preview — identical thresholds to the backend (90/80/70). */
export function classify(total: number): {
  classification: VendorClassification;
  label: string;
} {
  if (total >= 90)
    return { classification: 'APPROVED_PREFERRED', label: 'Approved (Preferred Vendor)' };
  if (total >= 80) return { classification: 'APPROVED', label: 'Approved' };
  if (total >= 70)
    return {
      classification: 'CONDITIONALLY_APPROVED',
      label: 'Conditionally Approved (Improvement Plan Required)',
    };
  return { classification: 'NOT_APPROVED', label: 'Not Approved' };
}

export const VENDOR_STATUS_LABEL: Record<VendorStatus, string> = {
  PENDING_QUESTIONNAIRE: 'Pending Questionnaire',
  QUESTIONNAIRE_SUBMITTED: 'Questionnaire Submitted',
  UNDER_AUDIT: 'Under Audit',
  APPROVED_PREFERRED: 'Approved (Preferred)',
  APPROVED: 'Approved',
  CONDITIONALLY_APPROVED: 'Conditionally Approved',
  NOT_APPROVED: 'Not Approved',
};

// ── Public (unauthenticated vendor form) calls ───────────────────────
/**
 * Discriminated result so the public page renders password / expired / revoked
 * states rather than throwing. `passwordRequired` is derived from a 403 whose
 * message mentions a password (matches the Vault public-share convention).
 */
export type PublicResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; message: string; passwordRequired: boolean };

async function publicPost<T>(
  path: string,
  body: Record<string, unknown>,
): Promise<PublicResult<T>> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, status: 0, message: 'Network error', passwordRequired: false };
  }
  let parsed: { success?: boolean; data?: T; message?: string } = {};
  try {
    parsed = await res.json();
  } catch {
    /* empty body */
  }
  if (res.ok && parsed.success) {
    return { ok: true, data: parsed.data as T };
  }
  const message = parsed.message ?? 'Request failed';
  return {
    ok: false,
    status: res.status,
    message,
    passwordRequired: res.status === 403 && /password/i.test(message),
  };
}

export function resolvePublicQuestionnaire(token: string, password?: string) {
  return publicPost<VendorQuestionnaire>(
    `/public/vendor-questionnaire/${encodeURIComponent(token)}/resolve`,
    { password },
  );
}

export function savePublicQuestionnaire(
  token: string,
  sections: Partial<Record<SectionKey, unknown>>,
  password?: string,
) {
  return publicPost<VendorQuestionnaire>(
    `/public/vendor-questionnaire/${encodeURIComponent(token)}/save`,
    { ...sections, password },
  );
}

export function submitPublicQuestionnaire(
  token: string,
  sections: Partial<Record<SectionKey, unknown>>,
  password?: string,
) {
  return publicPost<VendorQuestionnaire>(
    `/public/vendor-questionnaire/${encodeURIComponent(token)}/submit`,
    { ...sections, password },
  );
}

export function publicCertUploadUrl(
  token: string,
  input: { name: string; mimeType: string; sizeBytes: number },
  password?: string,
) {
  return publicPost<{ storageKey: string; uploadUrl: string; expiresInSeconds: number }>(
    `/public/vendor-questionnaire/${encodeURIComponent(token)}/certificate-upload-url`,
    { ...input, password },
  );
}

export function publicCertConfirm(
  token: string,
  input: { storageKey: string; name: string },
  password?: string,
) {
  return publicPost<CertificateFile>(
    `/public/vendor-questionnaire/${encodeURIComponent(token)}/certificate-confirm`,
    { ...input, password },
  );
}
