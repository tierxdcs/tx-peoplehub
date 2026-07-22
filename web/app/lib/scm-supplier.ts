'use client';

import { apiFetch } from './api';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';

/**
 * Supplier Qualification (SCM — raw materials) client. Mirrors lib/scm.ts
 * (Vendor Qualification) exactly in shape — authenticated calls via apiFetch,
 * PUBLIC supplier-form calls via a bare fetch returning a discriminated result
 * so the public page can render clean password/expired/revoked states. This is
 * a fully separate module from Vendors: different routes (/suppliers,
 * /public/supplier-questionnaire), different sections, different scoring
 * weights.
 */

// ── Types (mirror the backend entities) ──────────────────────────────
export type SupplierStatus =
  | 'PENDING_QUESTIONNAIRE'
  | 'QUESTIONNAIRE_SUBMITTED'
  | 'UNDER_AUDIT'
  | 'APPROVED_PREFERRED'
  | 'APPROVED'
  | 'CONDITIONALLY_APPROVED'
  | 'NOT_APPROVED';

export type QuestionnaireStatus = 'SENT' | 'SUBMITTED';
export type AuditType = 'PHYSICAL' | 'VIRTUAL';
/** How a questionnaire reached SUBMITTED. Null until submitted. */
export type FilledBy = 'EXTERNAL_SUPPLIER' | 'INTERNAL_STAFF';
export type SupplierClassification =
  | 'APPROVED_PREFERRED'
  | 'APPROVED'
  | 'CONDITIONALLY_APPROVED'
  | 'NOT_APPROVED';

export interface Supplier {
  id: string;
  companyName: string;
  registeredAddress: string | null;
  factoryAddress: string | null;
  yearEstablished: string | null;
  numberOfEmployees: string | null;
  annualTurnover: string | null;
  msmeUdyamCertificate: string | null;
  contactPersonName: string | null;
  contactPersonDesignation: string | null;
  contactEmail: string;
  contactPhone: string | null;
  website: string | null;
  status: SupplierStatus;
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

/**
 * The 9 supplier questionnaire section keys — each an opaque JSON blob on the
 * questionnaire. `packagingAndDelivery` is OPTIONAL (may be left blank).
 */
export const SECTION_KEYS = [
  'materialRange',
  'materialCertifications',
  'compliance',
  'qualityCertifications',
  'commercialTerms',
  'packagingAndDelivery',
  'logistics',
  'references',
  'declaration',
] as const;

export type SectionKey = (typeof SECTION_KEYS)[number];

/** Sections that are optional to submit (rendered as such on the form + view). */
export const OPTIONAL_SECTION_KEYS: SectionKey[] = ['packagingAndDelivery'];

/**
 * The Supplier master fields surfaced on the public form's "Company
 * Information" section. companyName/contactEmail are staff-set and shown
 * read-only there; everything else is editable via PublicCompanyInfo.
 */
export interface SupplierCompanyInfo {
  companyName: string;
  contactEmail: string;
  registeredAddress: string | null;
  factoryAddress: string | null;
  yearEstablished: string | null;
  numberOfEmployees: string | null;
  annualTurnover: string | null;
  msmeUdyamCertificate: string | null;
  contactPersonName: string | null;
  contactPersonDesignation: string | null;
  contactPhone: string | null;
  website: string | null;
}

/** Editable subset of SupplierCompanyInfo — what the public/internal-fill form may write back. */
export type PublicCompanyInfo = Partial<
  Omit<SupplierCompanyInfo, 'companyName' | 'contactEmail'>
>;

export type SupplierQuestionnaire = {
  id: string;
  supplierId: string;
  revisionNumber: number;
  status: QuestionnaireStatus;
  submittedAt: string | null;
  filledBy: FilledBy | null;
  companyInfo: SupplierCompanyInfo;
  certificateFiles: CertificateFile[];
  createdAt: string;
  updatedAt: string;
} & Record<SectionKey, Record<string, unknown> | null>;

/** Human label for the fill path, shown wherever a questionnaire appears. */
export const FILLED_BY_LABEL: Record<FilledBy, string> = {
  EXTERNAL_SUPPLIER: 'Supplier-submitted',
  INTERNAL_STAFF: 'Filled internally',
};

export interface SupplierInvite {
  id: string;
  questionnaireId: string;
  token: string;
  expiresAt: string;
  revokedAt: string | null;
  hasPassword: boolean;
  createdById: string;
  createdAt: string;
}

export interface SupplierAudit {
  id: string;
  supplierId: string;
  questionnaireId: string;
  auditType: AuditType;
  auditDate: string;
  auditorId: string;
  auditorName: string | null;
  materialCertificationsQualityScore: string;
  complianceScore: string;
  commercialTermsScore: string;
  logisticsDeliveryScore: string;
  financialStabilityScore: string;
  referencesScore: string;
  totalScore: number;
  classification: SupplierClassification;
  classificationLabel: string;
  auditNotes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SupplierDetail extends Supplier {
  questionnaires: SupplierQuestionnaire[];
  audits: SupplierAudit[];
}

// ── Authenticated (SCM staff) calls ──────────────────────────────────
/**
 * Only companyName + contactEmail are required at creation — everything else
 * is optional and can arrive later via the supplier's own questionnaire.
 */
export interface CreateSupplierInput {
  companyName: string;
  contactEmail: string;
  registeredAddress?: string;
  factoryAddress?: string;
  yearEstablished?: string;
  numberOfEmployees?: string;
  annualTurnover?: string;
  msmeUdyamCertificate?: string;
  contactPersonName?: string;
  contactPersonDesignation?: string;
  contactPhone?: string;
  website?: string;
}

export function listSuppliers() {
  return apiFetch<Supplier[]>('/suppliers');
}

export function getSupplier(id: string) {
  return apiFetch<SupplierDetail>(`/suppliers/${id}`);
}

export function createSupplier(input: CreateSupplierInput) {
  return apiFetch<Supplier>('/suppliers', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function createQuestionnaireRevision(supplierId: string) {
  return apiFetch<SupplierQuestionnaire>(
    `/suppliers/${supplierId}/questionnaires`,
    { method: 'POST' },
  );
}

export function createInvite(
  questionnaireId: string,
  input: { expiresInHours?: number; password?: string },
) {
  return apiFetch<SupplierInvite>(
    `/suppliers/questionnaires/${questionnaireId}/invites`,
    { method: 'POST', body: JSON.stringify(input) },
  );
}

export function revokeInvite(inviteId: string) {
  return apiFetch<void>(`/suppliers/invites/${inviteId}`, { method: 'DELETE' });
}

// ── Internal fill (authenticated SCM staff — second path to SUBMITTED) ──
// Same section payloads as the public form, but every field is optional and
// there is no token/password. Access is SCM Manager+/SA (backend-enforced).
export function saveInternal(
  questionnaireId: string,
  sections: Partial<Record<SectionKey, unknown>>,
  companyInfo?: PublicCompanyInfo,
) {
  return apiFetch<SupplierQuestionnaire>(
    `/suppliers/questionnaires/${questionnaireId}/internal-fill/save`,
    { method: 'POST', body: JSON.stringify({ ...sections, companyInfo }) },
  );
}

export function submitInternal(
  questionnaireId: string,
  sections: Partial<Record<SectionKey, unknown>>,
  companyInfo?: PublicCompanyInfo,
) {
  return apiFetch<SupplierQuestionnaire>(
    `/suppliers/questionnaires/${questionnaireId}/internal-fill/submit`,
    { method: 'POST', body: JSON.stringify({ ...sections, companyInfo }) },
  );
}

export function internalCertUploadUrl(
  questionnaireId: string,
  input: { name: string; mimeType: string; sizeBytes: number },
) {
  return apiFetch<{ storageKey: string; uploadUrl: string; expiresInSeconds: number }>(
    `/suppliers/questionnaires/${questionnaireId}/internal-fill/certificate-upload-url`,
    { method: 'POST', body: JSON.stringify(input) },
  );
}

export function internalCertConfirm(
  questionnaireId: string,
  input: { storageKey: string; name: string },
) {
  return apiFetch<CertificateFile>(
    `/suppliers/questionnaires/${questionnaireId}/internal-fill/certificate-confirm`,
    { method: 'POST', body: JSON.stringify(input) },
  );
}

export interface CreateAuditInput {
  questionnaireId: string;
  auditType: AuditType;
  auditDate: string;
  materialCertificationsQualityScore: number;
  complianceScore: number;
  commercialTermsScore: number;
  logisticsDeliveryScore: number;
  financialStabilityScore: number;
  referencesScore: number;
  auditNotes?: string;
}

export function createAudit(supplierId: string, input: CreateAuditInput) {
  return apiFetch<SupplierAudit>(`/suppliers/${supplierId}/audits`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

// ── Scoring (mirrors backend supplier-scoring.ts — 6 weights = 100) ──
export const AUDIT_CATEGORIES: {
  key: keyof CreateAuditInput;
  label: string;
  max: number;
}[] = [
  { key: 'materialCertificationsQualityScore', label: 'Material Certifications & Quality', max: 30 },
  { key: 'complianceScore', label: 'Compliance', max: 15 },
  { key: 'commercialTermsScore', label: 'Commercial Terms', max: 20 },
  { key: 'logisticsDeliveryScore', label: 'Logistics & Delivery', max: 15 },
  { key: 'financialStabilityScore', label: 'Financial Stability', max: 10 },
  { key: 'referencesScore', label: 'References', max: 10 },
];

/** Live classification preview — identical thresholds to the backend (90/80/70). */
export function classify(total: number): {
  classification: SupplierClassification;
  label: string;
} {
  if (total >= 90)
    return { classification: 'APPROVED_PREFERRED', label: 'Approved (Preferred Supplier)' };
  if (total >= 80) return { classification: 'APPROVED', label: 'Approved' };
  if (total >= 70)
    return {
      classification: 'CONDITIONALLY_APPROVED',
      label: 'Conditionally Approved (Improvement Plan Required)',
    };
  return { classification: 'NOT_APPROVED', label: 'Not Approved' };
}

export const SUPPLIER_STATUS_LABEL: Record<SupplierStatus, string> = {
  PENDING_QUESTIONNAIRE: 'Pending Questionnaire',
  QUESTIONNAIRE_SUBMITTED: 'Questionnaire Submitted',
  UNDER_AUDIT: 'Under Audit',
  APPROVED_PREFERRED: 'Approved (Preferred)',
  APPROVED: 'Approved',
  CONDITIONALLY_APPROVED: 'Conditionally Approved',
  NOT_APPROVED: 'Not Approved',
};

// ── Public (unauthenticated supplier form) calls ─────────────────────
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
  return publicPost<SupplierQuestionnaire>(
    `/public/supplier-questionnaire/${encodeURIComponent(token)}/resolve`,
    { password },
  );
}

export function savePublicQuestionnaire(
  token: string,
  sections: Partial<Record<SectionKey, unknown>>,
  password?: string,
  companyInfo?: PublicCompanyInfo,
) {
  return publicPost<SupplierQuestionnaire>(
    `/public/supplier-questionnaire/${encodeURIComponent(token)}/save`,
    { ...sections, password, companyInfo },
  );
}

export function submitPublicQuestionnaire(
  token: string,
  sections: Partial<Record<SectionKey, unknown>>,
  password?: string,
  companyInfo?: PublicCompanyInfo,
) {
  return publicPost<SupplierQuestionnaire>(
    `/public/supplier-questionnaire/${encodeURIComponent(token)}/submit`,
    { ...sections, password, companyInfo },
  );
}

export function publicCertUploadUrl(
  token: string,
  input: { name: string; mimeType: string; sizeBytes: number },
  password?: string,
) {
  return publicPost<{ storageKey: string; uploadUrl: string; expiresInSeconds: number }>(
    `/public/supplier-questionnaire/${encodeURIComponent(token)}/certificate-upload-url`,
    { ...input, password },
  );
}

export function publicCertConfirm(
  token: string,
  input: { storageKey: string; name: string },
  password?: string,
) {
  return publicPost<CertificateFile>(
    `/public/supplier-questionnaire/${encodeURIComponent(token)}/certificate-confirm`,
    { ...input, password },
  );
}
