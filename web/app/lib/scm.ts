'use client';

import { apiFetch } from './api';
import type { EmailSendResult } from './invite-email';

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
export type VendorCoreCompetency =
  | 'SHEET_METAL'
  | 'FABRICATION'
  | 'PDU_MANUFACTURER'
  | 'MODULAR_DATA_CENTER'
  | 'ELECTRICAL_PANELS'
  | 'PRECISION_MACHINING'
  | 'POWDER_COATING_SURFACE_FINISHING'
  | 'CABLE_HARNESS'
  | 'HVAC_COOLING'
  | 'SYSTEM_INTEGRATION'
  | 'OTHER';

export const VENDOR_CORE_COMPETENCY_LABEL: Record<VendorCoreCompetency, string> = {
  SHEET_METAL: 'Sheet Metal',
  FABRICATION: 'Fabrication',
  PDU_MANUFACTURER: 'PDU Manufacturer',
  MODULAR_DATA_CENTER: 'Modular Data Center (MDC)',
  ELECTRICAL_PANELS: 'Electrical Panels',
  PRECISION_MACHINING: 'Precision Machining',
  POWDER_COATING_SURFACE_FINISHING: 'Powder Coating / Surface Finishing',
  CABLE_HARNESS: 'Cable Harness',
  HVAC_COOLING: 'HVAC / Cooling',
  SYSTEM_INTEGRATION: 'System Integration',
  OTHER: 'Other',
};
export type VendorClassification =
  | 'APPROVED_PREFERRED'
  | 'APPROVED'
  | 'CONDITIONALLY_APPROVED'
  | 'NOT_APPROVED';

export interface Vendor {
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
  coreCompetency: VendorCoreCompetency | null;
  status: VendorStatus;
  /** True when `status` came from a SuperAdmin override, not the audit score. */
  statusOverridden: boolean;
  createdById: string;
  createdAt: string;
  updatedAt: string;
}

export interface CertificateFile {
  storageKey: string;
  name: string;
  sizeBytes: number | null;
  contentType: string | null;
  /** Certification this document evidences, e.g. "ISO 9001"; null = general. */
  label?: string | null;
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

/**
 * The Vendor master fields surfaced on the public form's "Company
 * Information" section. companyName/contactEmail are staff-set and shown
 * read-only there; everything else is editable via PublicCompanyInfo.
 */
export interface VendorCompanyInfo {
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

/** Editable subset of VendorCompanyInfo — what the public form may write back. */
export type PublicCompanyInfo = Partial<
  Omit<VendorCompanyInfo, 'companyName' | 'contactEmail'>
>;

export type VendorQuestionnaire = {
  id: string;
  vendorId: string;
  revisionNumber: number;
  status: QuestionnaireStatus;
  submittedAt: string | null;
  companyInfo: VendorCompanyInfo;
  qualityCertificateFiles: CertificateFile[];
  ndaRequired: boolean;
  signedNdaUploaded: boolean;
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
  coreCompetency: VendorCoreCompetency | null;
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
  /** SuperAdmin-forced classification, null = none (use computed). */
  overrideClassification: VendorClassification | null;
  overrideClassificationLabel: string | null;
  overrideReason: string | null;
  overriddenById: string | null;
  overriddenByName: string | null;
  overriddenAt: string | null;
  /** override ?? computed — the classification actually in effect. */
  effectiveClassification: VendorClassification;
  effectiveClassificationLabel: string;
  isOverridden: boolean;
  auditNotes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface VendorDetail extends Vendor {
  questionnaires: VendorQuestionnaire[];
  audits: VendorAudit[];
}

// ── Authenticated (SCM staff) calls ──────────────────────────────────
/**
 * Only companyName + contactEmail are required at creation — everything else
 * is optional and can arrive later via the vendor's own questionnaire.
 */
export interface CreateVendorInput {
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

export function listVendors() {
  return apiFetch<Vendor[]>('/vendors');
}

export function getVendor(id: string) {
  return apiFetch<VendorDetail>(`/vendors/${id}`);
}

export function deleteVendor(id: string) {
  return apiFetch<{ id: string; deleted: true }>(`/vendors/${id}`, {
    method: 'DELETE',
  });
}

export function createVendor(input: CreateVendorInput) {
  return apiFetch<Vendor>('/vendors', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/**
 * Set/correct the vendor master's core competency, independently of an audit.
 * SCM Manager+/SA (backend enforces). Returns the updated vendor.
 */
export function updateVendorCoreCompetency(
  vendorId: string,
  coreCompetency: VendorCoreCompetency,
) {
  return apiFetch<Vendor>(`/vendors/${vendorId}/core-competency`, {
    method: 'PATCH',
    body: JSON.stringify({ coreCompetency }),
  });
}

export function createQuestionnaireRevision(vendorId: string) {
  return apiFetch<VendorQuestionnaire>(
    `/vendors/${vendorId}/questionnaires`,
    { method: 'POST' },
  );
}

export function createNdaTemplateUploadUrl(file: File) {
  return apiFetch<{
    fileId: string;
    uploadUrl: string;
    expiresInSeconds: number;
  }>('/admin/company-documents/nda-template/upload-url', {
    method: 'POST',
    body: JSON.stringify({
      name: file.name,
      mimeType: file.type || 'application/octet-stream',
      sizeBytes: file.size,
    }),
  });
}

export function confirmNdaTemplateUpload(fileId: string) {
  return apiFetch<{ fileId: string }>(
    '/admin/company-documents/nda-template/confirm',
    { method: 'POST', body: JSON.stringify({ fileId }) },
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

/** Email an existing invite link. Recipient defaults to the vendor's contactEmail. */
export function sendInviteEmail(
  inviteId: string,
  input: { to?: string; note?: string } = {},
) {
  return apiFetch<EmailSendResult>(`/vendors/invites/${inviteId}/email`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export interface CreateAuditInput {
  questionnaireId: string;
  auditType: AuditType;
  auditDate: string;
  coreCompetency: VendorCoreCompetency;
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

// ── Classification override (SUPER_ADMIN) ────────────────────────────
export interface OverrideClassificationInput {
  overrideClassification: VendorClassification;
  reason: string;
}

/** Force an audit's classification, regardless of the computed score. */
export function overrideAuditClassification(
  vendorId: string,
  auditId: string,
  input: OverrideClassificationInput,
) {
  return apiFetch<VendorAudit>(
    `/vendors/${vendorId}/audits/${auditId}/classification-override`,
    { method: 'PATCH', body: JSON.stringify(input) },
  );
}

/** Clear an override, reverting to the computed classification. */
export function clearAuditClassificationOverride(
  vendorId: string,
  auditId: string,
) {
  return apiFetch<VendorAudit>(
    `/vendors/${vendorId}/audits/${auditId}/classification-override`,
    { method: 'DELETE' },
  );
}

// ── Scoring (mirrors backend vendor-scoring.ts) ────────────────────
export const AUDIT_CATEGORIES: {
  key: keyof CreateAuditInput;
  label: string;
  max: number;
  /** Plain-language explanation shown behind the category's info button. */
  description: string;
}[] = [
  {
    key: 'manufacturingCapabilityScore',
    label: 'Manufacturing Capability',
    max: 20,
    description:
      'Machinery, tooling, processes and technical know-how to make the required parts to spec — and the maturity of those manufacturing processes.',
  },
  {
    key: 'capacityScore',
    label: 'Capacity',
    max: 10,
    description:
      'Available production volume and headroom to meet our order quantities and lead times without straining other commitments.',
  },
  {
    key: 'qualitySystemScore',
    label: 'Quality System',
    max: 20,
    description:
      'Maturity of the quality management system — certifications (e.g. ISO 9001), inspection, traceability, non-conformance handling and continuous improvement.',
  },
  {
    key: 'engineeringScore',
    label: 'Engineering',
    max: 10,
    description:
      'Design, R&D and technical problem-solving strength — ability to support drawings, prototyping, DFM feedback and engineering changes.',
  },
  {
    key: 'financialStabilityScore',
    label: 'Financial Stability',
    max: 5,
    description:
      'Financial health and solvency — turnover, profitability and creditworthiness that signal the vendor can sustain supply over the long term.',
  },
  {
    key: 'supplyChainScore',
    label: 'Supply Chain',
    max: 10,
    description:
      'Robustness of the vendor’s own sourcing and logistics — sub-supplier management, raw-material availability and on-time delivery reliability.',
  },
  {
    key: 'exportReadinessScore',
    label: 'Export Readiness',
    max: 10,
    description:
      'Ability to handle international trade — export documentation, compliance, packaging for transit and experience shipping to our regions.',
  },
  {
    key: 'sustainabilityScore',
    label: 'Sustainability',
    max: 5,
    description:
      'Environmental and social responsibility — energy/waste practices, responsible sourcing and progress toward ESG commitments.',
  },
  {
    key: 'ehsScore',
    label: 'EHS',
    max: 5,
    description:
      'Environment, Health & Safety — workplace safety record, EHS policies, statutory compliance and incident management on the shop floor.',
  },
  {
    key: 'customerReferencesScore',
    label: 'Customer References',
    max: 5,
    description:
      'Track record with other customers — verifiable references, reputation and demonstrated performance on comparable supply relationships.',
  },
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
  companyInfo?: PublicCompanyInfo,
) {
  return publicPost<VendorQuestionnaire>(
    `/public/vendor-questionnaire/${encodeURIComponent(token)}/save`,
    { ...sections, password, companyInfo },
  );
}

export function submitPublicQuestionnaire(
  token: string,
  sections: Partial<Record<SectionKey, unknown>>,
  password?: string,
  companyInfo?: PublicCompanyInfo,
) {
  return publicPost<VendorQuestionnaire>(
    `/public/vendor-questionnaire/${encodeURIComponent(token)}/submit`,
    { ...sections, password, companyInfo },
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
  input: { storageKey: string; name: string; label?: string },
  password?: string,
) {
  return publicPost<CertificateFile>(
    `/public/vendor-questionnaire/${encodeURIComponent(token)}/certificate-confirm`,
    { ...input, password },
  );
}

export function publicNdaTemplateDownload(token: string, password?: string) {
  return publicPost<{ downloadUrl: string; expiresInSeconds: number }>(
    `/public/vendor-questionnaire/${encodeURIComponent(token)}/nda-template-download`,
    { password },
  );
}

export function publicSignedNdaUploadUrl(
  token: string,
  input: { name: string; mimeType: string; sizeBytes: number },
  password?: string,
) {
  return publicPost<{
    fileId: string;
    storageKey: string;
    uploadUrl: string;
    expiresInSeconds: number;
  }>(
    `/public/vendor-questionnaire/${encodeURIComponent(token)}/signed-nda-upload-url`,
    { ...input, password },
  );
}

export function publicSignedNdaConfirm(
  token: string,
  fileId: string,
  password?: string,
) {
  return publicPost<{ fileId: string; uploaded: boolean }>(
    `/public/vendor-questionnaire/${encodeURIComponent(token)}/signed-nda-confirm`,
    { fileId, password },
  );
}
