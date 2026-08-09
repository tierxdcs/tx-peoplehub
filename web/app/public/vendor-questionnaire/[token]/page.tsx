'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { COMPANY } from '../../../lib/theme';
import { uploadToPresignedUrl } from '../../../lib/vault-api';
import {
  publicCertConfirm,
  publicCertUploadUrl,
  publicNdaTemplateDownload,
  publicSignedNdaConfirm,
  publicSignedNdaUploadUrl,
  resolvePublicQuestionnaire,
  savePublicQuestionnaire,
  submitPublicQuestionnaire,
  type CertificateFile,
  type PublicCompanyInfo,
  type SectionKey,
  type VendorQuestionnaire,
} from '../../../lib/scm';

/**
 * Public vendor self-assessment questionnaire (VSAQ) — outside the app shell,
 * unauthenticated, resolved by token. Save/resume, certificate upload (guarded
 * server-side by Vault's rules), and a final submit that locks the form. All
 * section data is sent as JSON blobs the backend stores opaquely.
 *
 * Styling is a clean standalone document look (not the internal shadcn shell),
 * branded via COMPANY — this is the one page a vendor sees.
 */

const ACCENT = '#f97316';
const INK = '#1e2340';

type SectionState = Record<string, unknown>;
type FormState = Partial<Record<SectionKey, SectionState>>;

// ── Field definitions ────────────────────────────────────────────────
// Single source of truth for every questionnaire field, shared by the render
// and the submit-time validator so the two can never drift. Every field listed
// here is mandatory; the vendor cannot submit until all are complete.
const COMPANY_FIELDS: [keyof PublicCompanyInfo, string][] = [
  ['registeredAddress', 'Registered Address'],
  ['factoryAddress', 'Factory Address'],
  ['yearEstablished', 'Year Established'],
  ['numberOfEmployees', 'Number of Employees'],
  ['annualTurnover', 'Annual Turnover'],
  ['msmeUdyamCertificate', 'MSME / UDYAM Certificate'],
  ['contactPersonName', 'Contact Person Name'],
  ['contactPersonDesignation', 'Contact Person Designation'],
  ['contactPhone', 'Contact Phone'],
  ['website', 'Website'],
];
const EXPORT_FIELDS: [string, string][] = [
  ['exportCountries', 'Countries Served'],
  ['exportPercent', 'Annual Export %'],
  ['exportYears', 'Years of Export Experience'],
];
const MFG_CAPABILITY_ROWS = [
  'Laser Cutting', 'CNC Punching', 'CNC Bending', 'Robotic Welding', 'TIG Welding',
  'MIG Welding', 'Spot Welding', 'Powder Coating', 'Assembly Line', 'FAT Area',
];
const EQUIPMENT_COLUMNS = ['Machine Name', 'Manufacturer', 'Model', 'Capacity', 'Year Installed'];
const PRODUCTION_FIELDS: [string, string][] = [
  ['maxMonthly', 'Maximum Monthly Production'],
  ['utilization', 'Current Utilization'],
  ['additionalCapacity', 'Additional Capacity Available'],
  ['leadTime', 'Lead Time'],
];
const ENGINEERING_FIELDS: [string, string][] = [['teamSize', 'Engineering Team Size']];
const SUPPLY_CHAIN_FIELDS: [string, string][] = [
  ['rawMaterialSuppliers', 'Raw Material Suppliers'],
  ['approvedVendorList', 'Approved Vendor List'],
  ['safetyStock', 'Safety Stock'],
  ['erpUsed', 'ERP Used'],
  ['inventoryControl', 'Inventory Control Method'],
];
const LOGISTICS_FIELDS: [string, string][] = [
  ['packagingMethod', 'Packaging Method'],
  ['exportPackaging', 'Export Packaging'],
  ['ispm15', 'ISPM-15'],
  ['shippingPorts', 'Shipping Ports'],
  ['freightExperience', 'International Freight Experience'],
];
const SUSTAINABILITY_FIELDS: [string, string][] = [
  ['iso14001', 'ISO 14001'],
  ['wasteDisposal', 'Waste Disposal'],
  ['energyManagement', 'Energy Management'],
  ['waterRecycling', 'Water Recycling'],
  ['rohs', 'RoHS Compliance'],
  ['reach', 'REACH Compliance'],
];
const INFOSEC_FIELDS: [string, string][] = [
  ['iso27001', 'ISO 27001'],
  ['ndaPolicy', 'NDA Policy'],
  ['drawingControl', 'Drawing Control'],
  ['cyberSecurity', 'Cyber Security'],
  ['visitorControl', 'Visitor Control'],
];
const CONTINUITY_FIELDS: [string, string][] = [
  ['disasterRecovery', 'Disaster Recovery Plan'],
  ['alternateLocation', 'Alternate Manufacturing Location'],
  ['generatorBackup', 'Generator Backup'],
  ['fireProtection', 'Fire Protection'],
  ['insurance', 'Insurance Coverage'],
];
const EHS_FIELDS: [string, string][] = [
  ['ppe', 'PPE Compliance'],
  ['incidentReporting', 'Incident Reporting'],
  ['firstAid', 'First Aid'],
  ['emergencyResponse', 'Emergency Response'],
  ['hazmat', 'Hazardous Material Handling'],
];
const FINANCIAL_FIELDS: [string, string][] = [
  ['annualRevenue', 'Annual Revenue'],
  ['netWorth', 'Net Worth'],
  ['banker', 'Banker'],
  ['creditRating', 'Credit Rating'],
  ['yearsInBusiness', 'Years in Business'],
];
const SUPPORT_FIELDS: [string, string][] = [
  ['accountManager', 'Dedicated Account Manager'],
  ['responseTime', 'Response Time'],
  ['complaintHandling', 'Complaint Handling'],
  ['correctiveAction', 'Corrective Action Process'],
  ['eightD', '8D Methodology'],
];
const COMPLIANCE_FIELDS: [string, string][] = [
  ['conflictMinerals', 'Conflict Minerals'],
  ['antiBribery', 'Anti-Bribery Policy'],
  ['labourLaw', 'Labour Law Compliance'],
  ['childLabour', 'Child Labour Declaration'],
  ['humanRights', 'Human Rights Policy'],
  ['modernSlavery', 'Modern Slavery Policy'],
];
const REFERENCE_FIELDS: [string, string][] = [
  ['company', 'Company Name'],
  ['contact', 'Contact Person'],
  ['phoneEmail', 'Phone / Email'],
  ['relationship', 'Relationship / Products Supplied'],
];
const DECLARATION_FIELDS: [string, string][] = [
  ['signatoryName', 'Authorized Signatory Name'],
  ['designation', 'Designation'],
  ['date', 'Date'],
];

/** A missing required field: a human message plus the section anchor to jump to. */
type FieldError = { anchor: string; message: string };

/**
 * Validates that EVERY questionnaire field is filled. Pure (reads only its
 * arguments) so it can't drift from render-time state. Returns one entry per
 * missing field, in document order — the first entry is what we scroll to.
 */
function collectQuestionnaireErrors(
  form: FormState,
  companyInfo: PublicCompanyInfo,
  signedNdaUploaded: boolean,
  ndaRequired: boolean,
): FieldError[] {
  const errors: FieldError[] = [];
  const add = (anchor: string, message: string) => errors.push({ anchor, message });
  const t = (v: unknown) => typeof v === 'string' && v.trim().length > 0;
  const sec = (s: SectionKey) => (form[s] ?? {}) as SectionState;
  const arr = (v: unknown) => (Array.isArray(v) ? (v as unknown[]) : []);
  const fields = (anchor: string, prefix: string, state: SectionState, defs: [string, string][]) =>
    defs.forEach(([k, label]) => { if (!t(state[k])) add(anchor, `${prefix} — ${label}`); });

  if (ndaRequired && !signedNdaUploaded) add('sec-nda', 'Non-Disclosure Agreement — upload the signed NDA');

  COMPANY_FIELDS.forEach(([k, label]) => { if (!t(companyInfo[k])) add('sec-1', `Company Information — ${label}`); });

  const bp = sec('businessProfile');
  if (arr(bp.companyType).length === 0) add('sec-2', 'Business Profile — Company Type');
  if (arr(bp.manufacturingArea).length === 0) add('sec-2', 'Business Profile — Manufacturing Area');
  if (!arr(bp.majorCustomers).some(t)) add('sec-2', 'Business Profile — Major Customers');
  fields('sec-2', 'Business Profile', bp, EXPORT_FIELDS);

  const caps = (sec('manufacturingCapability').capabilities as CapabilityValue) ?? {};
  MFG_CAPABILITY_ROWS.forEach((row) => {
    const raw = caps[row];
    const cell: CapabilityCell = typeof raw === 'string' ? { available: raw } : (raw ?? {});
    if (cell.available !== 'yes' && cell.available !== 'no') add('sec-3', `Manufacturing Capability — ${row} (Yes/No)`);
    else if (cell.available === 'yes' && !t(cell.count)) add('sec-3', `Manufacturing Capability — ${row} quantity`);
  });

  const machines = arr(sec('equipmentDetails').machines) as string[][];
  const hasCompleteRow = machines.some((r) => EQUIPMENT_COLUMNS.every((_, i) => t(r?.[i])));
  if (!hasCompleteRow) add('sec-4', 'Equipment Details — complete at least one machine row');

  fields('sec-5', 'Production Capacity', sec('productionCapacity'), PRODUCTION_FIELDS);

  const qm = sec('qualityManagement');
  if (arr(qm.certifications).length === 0) add('sec-6', 'Quality Management — Certifications');
  if (arr(qm.inspectionEquipment).length === 0) add('sec-6', 'Quality Management — Inspection Equipment');

  const eng = sec('engineeringCapability');
  if (arr(eng.designSoftware).length === 0) add('sec-7', 'Engineering Capability — Design Software');
  fields('sec-7', 'Engineering Capability', eng, ENGINEERING_FIELDS);

  fields('sec-8', 'Supply Chain', sec('supplyChain'), SUPPLY_CHAIN_FIELDS);

  if (arr(sec('traceability').traceable).length === 0) add('sec-9', 'Traceability — select at least one');

  fields('sec-10', 'Logistics', sec('logistics'), LOGISTICS_FIELDS);
  fields('sec-11', 'Sustainability', sec('sustainability'), SUSTAINABILITY_FIELDS);
  fields('sec-12', 'Information Security', sec('informationSecurity'), INFOSEC_FIELDS);
  fields('sec-13', 'Business Continuity', sec('businessContinuity'), CONTINUITY_FIELDS);
  fields('sec-14', 'EHS', sec('ehs'), EHS_FIELDS);
  fields('sec-15', 'Financial Information', sec('financialInformation'), FINANCIAL_FIELDS);
  fields('sec-16', 'Customer Support', sec('customerSupport'), SUPPORT_FIELDS);
  fields('sec-17', 'Compliance', sec('compliance'), COMPLIANCE_FIELDS);

  const refs = sec('references') as Record<string, Record<string, string>>;
  [0, 1, 2].forEach((i) => {
    const ref = refs[`ref${i}`] ?? {};
    REFERENCE_FIELDS.forEach(([k, label]) => { if (!t(ref[k])) add('sec-18', `Reference ${i + 1} — ${label}`); });
  });

  const decl = sec('declaration');
  if (!decl.certified) add('sec-19', 'Declaration — tick the certification checkbox');
  fields('sec-19', 'Declaration', decl, DECLARATION_FIELDS);

  return errors;
}

export default function PublicVsaqPage() {
  const { token } = useParams<{ token: string }>();

  const [loading, setLoading] = useState(true);
  const [needsPassword, setNeedsPassword] = useState(false);
  const [password, setPassword] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [questionnaire, setQuestionnaire] = useState<VendorQuestionnaire | null>(null);
  const [form, setForm] = useState<FormState>({});
  const [companyInfo, setCompanyInfo] = useState<PublicCompanyInfo>({});
  const [certs, setCerts] = useState<CertificateFile[]>([]);
  const [saving, setSaving] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [signedNdaUploaded, setSignedNdaUploaded] = useState(false);
  const [ndaUploading, setNdaUploading] = useState(false);

  // Password is kept in a ref so save/submit calls always use the resolved one.
  const pwRef = useRef<string | undefined>(undefined);

  const applyResolved = useCallback((q: VendorQuestionnaire) => {
    setQuestionnaire(q);
    setSubmitted(q.status === 'SUBMITTED');
    setCerts(q.qualityCertificateFiles ?? []);
    setSignedNdaUploaded(q.signedNdaUploaded);
    setCompanyInfo({
      registeredAddress: q.companyInfo.registeredAddress ?? '',
      factoryAddress: q.companyInfo.factoryAddress ?? '',
      yearEstablished: q.companyInfo.yearEstablished ?? '',
      numberOfEmployees: q.companyInfo.numberOfEmployees ?? '',
      annualTurnover: q.companyInfo.annualTurnover ?? '',
      msmeUdyamCertificate: q.companyInfo.msmeUdyamCertificate ?? '',
      contactPersonName: q.companyInfo.contactPersonName ?? '',
      contactPersonDesignation: q.companyInfo.contactPersonDesignation ?? '',
      contactPhone: q.companyInfo.contactPhone ?? '',
      website: q.companyInfo.website ?? '',
    });
    // Seed the form from any previously-saved section data (resume).
    const seeded: FormState = {};
    (Object.keys(q) as (keyof VendorQuestionnaire)[]).forEach((k) => {
      const v = q[k];
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        // Only the section keys are plain objects; skip files array etc.
        seeded[k as SectionKey] = v as SectionState;
      }
    });
    setForm(seeded);
  }, []);

  function setCompanyInfoField(key: keyof PublicCompanyInfo, value: string) {
    setCompanyInfo((c) => ({ ...c, [key]: value }));
  }

  const resolve = useCallback(
    async (pwd?: string) => {
      const res = await resolvePublicQuestionnaire(token, pwd);
      if (res.ok) {
        pwRef.current = pwd;
        setNeedsPassword(false);
        setErrorMsg(null);
        applyResolved(res.data);
      } else if (res.passwordRequired) {
        setNeedsPassword(true);
      } else {
        setErrorMsg(res.message);
      }
    },
    [token, applyResolved],
  );

  useEffect(() => {
    resolve().finally(() => setLoading(false));
  }, [resolve]);

  function setField(section: SectionKey, key: string, value: unknown) {
    setForm((f) => ({ ...f, [section]: { ...(f[section] ?? {}), [key]: value } }));
  }

  async function save() {
    setSaving(true);
    setBanner(null);
    const res = await savePublicQuestionnaire(token, form, pwRef.current, companyInfo);
    setSaving(false);
    if (res.ok) setBanner('Progress saved. You can close this and resume later via the same link.');
    else setBanner(res.message);
  }

  async function submit() {
    // Every field is mandatory — block submission until the whole questionnaire
    // is complete, then point the vendor at exactly what is still missing.
    const missing = collectQuestionnaireErrors(
      form,
      companyInfo,
      signedNdaUploaded,
      !!questionnaire?.ndaRequired,
    );
    if (missing.length > 0) {
      const shown = missing.slice(0, 8).map((e) => `• ${e.message}`);
      const extra = missing.length - shown.length;
      setBanner(
        `Please complete all required fields before submitting — ${missing.length} still need attention:\n` +
          shown.join('\n') +
          (extra > 0 ? `\n• …and ${extra} more` : ''),
      );
      // Jump to the first section that needs attention.
      if (typeof document !== 'undefined') {
        document
          .getElementById(missing[0].anchor)
          ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      return;
    }
    setSaving(true);
    setBanner(null);
    const res = await submitPublicQuestionnaire(token, form, pwRef.current, companyInfo);
    setSaving(false);
    if (res.ok) {
      setSubmitted(true);
      setQuestionnaire(res.data);
    } else {
      setBanner(res.message);
    }
  }

  // `label` ties the document to a specific certification (e.g. "ISO 9001");
  // omit it for the general "other documents" bucket.
  async function uploadCert(file: File, label?: string) {
    setBanner(null);
    const presign = await publicCertUploadUrl(
      token,
      { name: file.name, mimeType: file.type || 'application/octet-stream', sizeBytes: file.size },
      pwRef.current,
    );
    if (!presign.ok) {
      // Surfaces Vault's actual guardrail message (blocked extension / too big).
      setBanner(presign.message);
      return;
    }
    try {
      await uploadToPresignedUrl(presign.data.uploadUrl, file);
    } catch {
      setBanner('Upload failed. Please try again.');
      return;
    }
    const confirmed = await publicCertConfirm(
      token,
      { storageKey: presign.data.storageKey, name: file.name, label },
      pwRef.current,
    );
    if (confirmed.ok) setCerts((c) => [...c, confirmed.data]);
    else setBanner(confirmed.message);
  }

  async function downloadNdaTemplate() {
    const result = await publicNdaTemplateDownload(token, pwRef.current);
    if (result.ok) {
      window.location.assign(result.data.downloadUrl);
    } else {
      setBanner(result.message);
    }
  }

  async function uploadSignedNda(file: File) {
    setNdaUploading(true);
    setBanner(null);
    const presign = await publicSignedNdaUploadUrl(
      token,
      {
        name: file.name,
        mimeType: file.type || 'application/octet-stream',
        sizeBytes: file.size,
      },
      pwRef.current,
    );
    if (!presign.ok) {
      setBanner(presign.message);
      setNdaUploading(false);
      return;
    }
    try {
      await uploadToPresignedUrl(presign.data.uploadUrl, file);
      const confirmed = await publicSignedNdaConfirm(
        token,
        presign.data.fileId,
        pwRef.current,
      );
      if (!confirmed.ok) throw new Error(confirmed.message);
      setSignedNdaUploaded(true);
      setBanner('Signed NDA uploaded successfully.');
    } catch (error) {
      setBanner(
        error instanceof Error ? error.message : 'Signed NDA upload failed.',
      );
    } finally {
      setNdaUploading(false);
    }
  }

  // ── Render states ──────────────────────────────────────────────────
  if (loading) {
    return <Shell><p style={{ color: '#6b7280' }}>Loading…</p></Shell>;
  }
  if (errorMsg) {
    return (
      <Shell>
        <div style={{ padding: 24, textAlign: 'center' }}>
          <h2 style={{ color: INK }}>This link isn’t available</h2>
          <p style={{ color: '#6b7280' }}>{errorMsg}</p>
          <p style={{ color: '#6b7280', fontSize: 13 }}>
            If you believe this is an error, please contact your Phaze Dynamics
            representative for a new link.
          </p>
        </div>
      </Shell>
    );
  }
  if (needsPassword) {
    return (
      <Shell>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void resolve(password);
          }}
          style={{ padding: 24, maxWidth: 360, margin: '0 auto' }}
        >
          <h2 style={{ color: INK }}>Password required</h2>
          <p style={{ color: '#6b7280', fontSize: 14 }}>
            This questionnaire link is password-protected.
          </p>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter password"
            style={inputStyle}
          />
          <button type="submit" style={{ ...btnPrimary, marginTop: 12 }}>
            Continue
          </button>
        </form>
      </Shell>
    );
  }
  if (submitted) {
    return (
      <Shell>
        <div style={{ padding: 24, textAlign: 'center' }}>
          <h2 style={{ color: INK }}>Thank you — your submission has been received.</h2>
          <p style={{ color: '#6b7280' }}>
            Your vendor self-assessment questionnaire has been submitted to Phaze
            Dynamics and is now locked. No further changes are needed.
          </p>
        </div>
      </Shell>
    );
  }
  if (!questionnaire) return <Shell><p>Not available.</p></Shell>;

  // ── The form ───────────────────────────────────────────────────────
  const g = (s: SectionKey) => (form[s] ?? {}) as SectionState;

  return (
    <Shell>
      <p style={{ margin: '0 0 20px', padding: '12px 16px', background: '#f8f8f9', borderLeft: `4px solid ${ACCENT}`, fontSize: 14, color: '#374151' }}>
        <strong>All fields are required.</strong> Please complete every section
        below — the questionnaire cannot be submitted until it is filled in
        full. If something does not apply to your business, enter{' '}
        <em>“N/A”</em> rather than leaving it blank. Use <strong>Save
        Progress</strong> at any time — you can close this page and resume later
        via the same link.
      </p>

      {banner && (
        <p style={{ margin: '0 0 16px', padding: '10px 14px', background: '#fff7ec', border: '1px solid #f1d9b0', borderRadius: 4, fontSize: 13.5, color: '#92400e', whiteSpace: 'pre-line' }}>
          {banner}
        </p>
      )}

      <section
        id="sec-nda"
        style={{
          marginBottom: 20,
          padding: 18,
          border: '1px solid #e5e7eb',
          borderRadius: 8,
          background: '#fff',
          scrollMarginTop: 16,
        }}
      >
        <h2 style={{ margin: '0 0 6px', color: INK, fontSize: 18 }}>
          Non-Disclosure Agreement
        </h2>
        <p style={{ margin: '0 0 14px', color: '#6b7280', fontSize: 13.5 }}>
          Download the current NDA, sign it, and upload the signed document.
          {questionnaire.ndaRequired
            ? ' A signed NDA is mandatory for this first questionnaire submission.'
            : ' Your NDA was collected during the initial onboarding revision.'}
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
          <button type="button" onClick={() => void downloadNdaTemplate()} style={btnPrimary}>
            Download NDA Template
          </button>
          {questionnaire.ndaRequired && !signedNdaUploaded && (
            <label
              style={{
                ...btnPrimary,
                background: '#fff',
                color: INK,
                border: '1px solid #d1d5db',
                cursor: ndaUploading ? 'wait' : 'pointer',
              }}
            >
              {ndaUploading ? 'Uploading…' : 'Upload Signed NDA *'}
              <input
                type="file"
                disabled={ndaUploading}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void uploadSignedNda(file);
                  event.currentTarget.value = '';
                }}
                style={{ display: 'none' }}
              />
            </label>
          )}
          {signedNdaUploaded && (
            <strong style={{ color: '#047857', fontSize: 13.5 }}>
              ✓ Signed NDA filed in Vault
            </strong>
          )}
        </div>
      </section>

      {/* 1. Company Information — writes back to the Vendor master record. */}
      <Section n="1" title="Company Information">
        <p style={{ fontSize: 13, color: '#6b7280', margin: '0 0 10px' }}>
          Please confirm or complete your company details below.
        </p>
        <FieldRow
          label="Registered Address"
          value={companyInfo.registeredAddress ?? ''}
          onChange={(v) => setCompanyInfoField('registeredAddress', v)}
        />
        <FieldRow
          label="Factory Address"
          value={companyInfo.factoryAddress ?? ''}
          onChange={(v) => setCompanyInfoField('factoryAddress', v)}
        />
        <FieldRow
          label="Year Established"
          value={companyInfo.yearEstablished ?? ''}
          onChange={(v) => setCompanyInfoField('yearEstablished', v)}
        />
        <FieldRow
          label="Number of Employees"
          value={companyInfo.numberOfEmployees ?? ''}
          onChange={(v) => setCompanyInfoField('numberOfEmployees', v)}
        />
        <FieldRow
          label="Annual Turnover"
          value={companyInfo.annualTurnover ?? ''}
          onChange={(v) => setCompanyInfoField('annualTurnover', v)}
        />
        <FieldRow
          label="MSME / UDYAM Certificate"
          value={companyInfo.msmeUdyamCertificate ?? ''}
          onChange={(v) => setCompanyInfoField('msmeUdyamCertificate', v)}
        />
        <FieldRow
          label="Contact Person Name"
          value={companyInfo.contactPersonName ?? ''}
          onChange={(v) => setCompanyInfoField('contactPersonName', v)}
        />
        <FieldRow
          label="Contact Person Designation"
          value={companyInfo.contactPersonDesignation ?? ''}
          onChange={(v) => setCompanyInfoField('contactPersonDesignation', v)}
        />
        <FieldRow
          label="Contact Phone"
          value={companyInfo.contactPhone ?? ''}
          onChange={(v) => setCompanyInfoField('contactPhone', v)}
        />
        <FieldRow
          label="Website"
          value={companyInfo.website ?? ''}
          onChange={(v) => setCompanyInfoField('website', v)}
        />
      </Section>

      {/* 2. Business Profile */}
      <Section n="2" title="Business Profile">
        <H3>Company Type</H3>
        <CheckGrid
          options={['Manufacturer', 'OEM', 'Contract Manufacturer', 'Distributor', 'Service Provider', 'System Integrator']}
          selected={(g('businessProfile').companyType as string[]) ?? []}
          onChange={(v) => setField('businessProfile', 'companyType', v)}
        />
        <H3>Manufacturing Area</H3>
        <CheckGrid
          options={['Sheet Metal', 'CNC Machining', 'Powder Coating', 'Welding', 'Assembly', 'Electrical Assembly', 'Injection Molding', 'Packaging']}
          selected={(g('businessProfile').manufacturingArea as string[]) ?? []}
          onChange={(v) => setField('businessProfile', 'manufacturingArea', v)}
        />
        <H3>Major Customers</H3>
        <DynamicList
          value={(g('businessProfile').majorCustomers as string[]) ?? ['']}
          placeholder="Customer name"
          onChange={(v) => setField('businessProfile', 'majorCustomers', v)}
        />
        <H3>Export Experience</H3>
        <FieldRows
          section="businessProfile"
          state={g('businessProfile')}
          setField={setField}
          fields={[
            ['exportCountries', 'Countries Served'],
            ['exportPercent', 'Annual Export %'],
            ['exportYears', 'Years of Export Experience'],
          ]}
        />
      </Section>

      {/* 3. Manufacturing Capability — yes/no grid */}
      <Section n="3" title="Manufacturing Capability">
        <YesNoGrid
          rows={['Laser Cutting', 'CNC Punching', 'CNC Bending', 'Robotic Welding', 'TIG Welding', 'MIG Welding', 'Spot Welding', 'Powder Coating', 'Assembly Line', 'FAT Area']}
          value={(g('manufacturingCapability').capabilities as CapabilityValue) ?? {}}
          onChange={(v) => setField('manufacturingCapability', 'capabilities', v)}
        />
      </Section>

      {/* 4. Equipment Details — table */}
      <Section n="4" title="Equipment Details">
        <GridTable
          columns={['Machine Name', 'Manufacturer', 'Model', 'Capacity', 'Year Installed']}
          value={(g('equipmentDetails').machines as string[][]) ?? [['', '', '', '', '']]}
          onChange={(v) => setField('equipmentDetails', 'machines', v)}
        />
      </Section>

      {/* 5. Production Capacity */}
      <Section n="5" title="Production Capacity">
        <FieldRows
          section="productionCapacity"
          state={g('productionCapacity')}
          setField={setField}
          fields={[
            ['maxMonthly', 'Maximum Monthly Production'],
            ['utilization', 'Current Utilization'],
            ['additionalCapacity', 'Additional Capacity Available'],
            ['leadTime', 'Lead Time'],
          ]}
        />
      </Section>

      {/* 6. Quality Management */}
      <Section n="6" title="Quality Management">
        <H3>Certifications</H3>
        <CheckGrid
          options={['ISO 9001', 'ISO 14001', 'ISO 45001', 'ISO 27001', 'IATF 16949', 'VDA', 'CE', 'UL']}
          selected={(g('qualityManagement').certifications as string[]) ?? []}
          onChange={(v) => setField('qualityManagement', 'certifications', v)}
        />
        {/* Per-certification document upload: one row per ticked certification. */}
        <CertUploads
          certifications={(g('qualityManagement').certifications as string[]) ?? []}
          files={certs}
          disabled={submitted}
          onUpload={uploadCert}
        />
        <H3>Inspection Equipment</H3>
        <CheckGrid
          options={['CMM', 'Height Gauge', 'Surface Plate', 'Vernier', 'Micrometer', 'Salt Spray', 'Coating Thickness Gauge', 'Torque Calibration']}
          selected={(g('qualityManagement').inspectionEquipment as string[]) ?? []}
          onChange={(v) => setField('qualityManagement', 'inspectionEquipment', v)}
        />
      </Section>

      {/* 7. Engineering Capability */}
      <Section n="7" title="Engineering Capability">
        <H3>Design Software Available</H3>
        <CheckGrid
          options={['AutoCAD', 'SolidWorks', 'Creo', 'CATIA', 'Inventor', 'NX']}
          selected={(g('engineeringCapability').designSoftware as string[]) ?? []}
          onChange={(v) => setField('engineeringCapability', 'designSoftware', v)}
        />
        <FieldRows
          section="engineeringCapability"
          state={g('engineeringCapability')}
          setField={setField}
          fields={[['teamSize', 'Engineering Team Size']]}
        />
      </Section>

      {/* 8. Supply Chain */}
      <Section n="8" title="Supply Chain">
        <FieldRows
          section="supplyChain"
          state={g('supplyChain')}
          setField={setField}
          fields={[
            ['rawMaterialSuppliers', 'Raw Material Suppliers'],
            ['approvedVendorList', 'Approved Vendor List'],
            ['safetyStock', 'Safety Stock'],
            ['erpUsed', 'ERP Used'],
            ['inventoryControl', 'Inventory Control Method'],
          ]}
        />
      </Section>

      {/* 9. Traceability */}
      <Section n="9" title="Traceability">
        <CheckGrid
          options={['Raw Material', 'Batch Number', 'Heat Number', 'Operator', 'Inspection Records', 'Calibration Records']}
          selected={(g('traceability').traceable as string[]) ?? []}
          onChange={(v) => setField('traceability', 'traceable', v)}
        />
      </Section>

      {/* 10. Logistics */}
      <Section n="10" title="Logistics">
        <FieldRows
          section="logistics"
          state={g('logistics')}
          setField={setField}
          fields={[
            ['packagingMethod', 'Packaging Method'],
            ['exportPackaging', 'Export Packaging'],
            ['ispm15', 'ISPM-15'],
            ['shippingPorts', 'Shipping Ports'],
            ['freightExperience', 'International Freight Experience'],
          ]}
        />
      </Section>

      {/* 11. Sustainability */}
      <Section n="11" title="Sustainability">
        <FieldRows
          section="sustainability"
          state={g('sustainability')}
          setField={setField}
          fields={[
            ['iso14001', 'ISO 14001'],
            ['wasteDisposal', 'Waste Disposal'],
            ['energyManagement', 'Energy Management'],
            ['waterRecycling', 'Water Recycling'],
            ['rohs', 'RoHS Compliance'],
            ['reach', 'REACH Compliance'],
          ]}
        />
      </Section>

      {/* 12. Information Security */}
      <Section n="12" title="Information Security">
        <FieldRows
          section="informationSecurity"
          state={g('informationSecurity')}
          setField={setField}
          fields={[
            ['iso27001', 'ISO 27001'],
            ['ndaPolicy', 'NDA Policy'],
            ['drawingControl', 'Drawing Control'],
            ['cyberSecurity', 'Cyber Security'],
            ['visitorControl', 'Visitor Control'],
          ]}
        />
      </Section>

      {/* 13. Business Continuity */}
      <Section n="13" title="Business Continuity">
        <FieldRows
          section="businessContinuity"
          state={g('businessContinuity')}
          setField={setField}
          fields={[
            ['disasterRecovery', 'Disaster Recovery Plan'],
            ['alternateLocation', 'Alternate Manufacturing Location'],
            ['generatorBackup', 'Generator Backup'],
            ['fireProtection', 'Fire Protection'],
            ['insurance', 'Insurance Coverage'],
          ]}
        />
      </Section>

      {/* 14. EHS */}
      <Section n="14" title="EHS (Environment, Health & Safety)">
        <FieldRows
          section="ehs"
          state={g('ehs')}
          setField={setField}
          fields={[
            ['ppe', 'PPE Compliance'],
            ['incidentReporting', 'Incident Reporting'],
            ['firstAid', 'First Aid'],
            ['emergencyResponse', 'Emergency Response'],
            ['hazmat', 'Hazardous Material Handling'],
          ]}
        />
      </Section>

      {/* 15. Financial Information */}
      <Section n="15" title="Financial Information">
        <FieldRows
          section="financialInformation"
          state={g('financialInformation')}
          setField={setField}
          fields={[
            ['annualRevenue', 'Annual Revenue'],
            ['netWorth', 'Net Worth'],
            ['banker', 'Banker'],
            ['creditRating', 'Credit Rating'],
            ['yearsInBusiness', 'Years in Business'],
          ]}
        />
      </Section>

      {/* 16. Customer Support */}
      <Section n="16" title="Customer Support">
        <FieldRows
          section="customerSupport"
          state={g('customerSupport')}
          setField={setField}
          fields={[
            ['accountManager', 'Dedicated Account Manager'],
            ['responseTime', 'Response Time'],
            ['complaintHandling', 'Complaint Handling'],
            ['correctiveAction', 'Corrective Action Process'],
            ['eightD', '8D Methodology'],
          ]}
        />
      </Section>

      {/* 17. Compliance */}
      <Section n="17" title="Compliance">
        <FieldRows
          section="compliance"
          state={g('compliance')}
          setField={setField}
          fields={[
            ['conflictMinerals', 'Conflict Minerals'],
            ['antiBribery', 'Anti-Bribery Policy'],
            ['labourLaw', 'Labour Law Compliance'],
            ['childLabour', 'Child Labour Declaration'],
            ['humanRights', 'Human Rights Policy'],
            ['modernSlavery', 'Modern Slavery Policy'],
          ]}
        />
      </Section>

      {/* 18. References */}
      <Section n="18" title="References">
        {[0, 1, 2].map((i) => (
          <div key={i} style={{ padding: '12px 14px', background: '#f8f8f9', borderRadius: 4, marginBottom: 12 }}>
            <H4>{`Reference ${i + 1}`}</H4>
            {(['company', 'contact', 'phoneEmail', 'relationship'] as const).map((f) => (
              <FieldRow
                key={f}
                label={{ company: 'Company Name', contact: 'Contact Person', phoneEmail: 'Phone / Email', relationship: 'Relationship / Products Supplied' }[f]}
                value={((g('references')[`ref${i}`] as Record<string, string>) ?? {})[f] ?? ''}
                onChange={(val) => {
                  const refs = (g('references') as Record<string, Record<string, string>>);
                  const cur = refs[`ref${i}`] ?? {};
                  setField('references', `ref${i}`, { ...cur, [f]: val });
                }}
              />
            ))}
          </div>
        ))}
      </Section>

      {/* 19. Declaration */}
      <Section n="19" title="Declaration">
        <p style={{ fontSize: 13.5, color: '#374151' }}>
          We certify that the information provided in this questionnaire is true
          and accurate to the best of our knowledge.
        </p>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, margin: '10px 0' }}>
          <input
            type="checkbox"
            checked={!!g('declaration').certified}
            onChange={(e) => setField('declaration', 'certified', e.target.checked)}
          />
          I certify the above.
        </label>
        <FieldRows
          section="declaration"
          state={g('declaration')}
          setField={setField}
          fields={[
            ['signatoryName', 'Authorized Signatory Name'],
            ['designation', 'Designation'],
            ['date', 'Date'],
          ]}
        />
      </Section>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 12, marginTop: 28, justifyContent: 'flex-end' }}>
        <button onClick={save} disabled={saving} style={btnSecondary}>
          {saving ? 'Saving…' : 'Save Progress'}
        </button>
        <button onClick={submit} disabled={saving} style={btnPrimary}>
          Submit
        </button>
      </div>
    </Shell>
  );
}

// ── Layout shell (standalone document look) ──────────────────────────
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main style={{ background: '#eef0f3', minHeight: '100vh', padding: '24px 0 60px' }}>
      <div style={{ maxWidth: 860, margin: '0 auto', background: '#fff', boxShadow: '0 2px 10px rgba(0,0,0,0.08)' }}>
        <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '28px 40px 20px', borderBottom: `3px solid ${INK}` }}>
          {COMPANY.logoPath ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={COMPANY.logoPath} alt={COMPANY.name} style={{ height: 46 }} />
          ) : (
            <strong style={{ fontSize: 20, color: INK }}>{COMPANY.name}</strong>
          )}
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 12, letterSpacing: '0.06em', color: '#6b7280', textTransform: 'uppercase' }}>
              {COMPANY.legalEntityName}
            </div>
            <h1 style={{ fontSize: 20, margin: '4px 0 0', color: INK }}>
              Vendor Self-Assessment Questionnaire
            </h1>
          </div>
        </header>
        <div style={{ padding: '20px 40px 40px' }}>{children}</div>
        <footer style={{ textAlign: 'center', fontSize: 11.5, color: '#6b7280', padding: '20px 40px 34px' }}>
          {COMPANY.legalEntityName} — Vendor Self-Assessment Questionnaire ·{' '}
          {COMPANY.confidentialityLine}
        </footer>
      </div>
    </main>
  );
}

// ── Reusable inputs ──────────────────────────────────────────────────
const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '6px 8px',
  border: '1px solid #d8dbe2',
  borderRadius: 3,
  fontSize: 13.5,
  fontFamily: 'inherit',
  color: INK,
  boxSizing: 'border-box',
};
const btnPrimary: React.CSSProperties = {
  background: INK,
  color: '#fff',
  border: 'none',
  padding: '9px 18px',
  borderRadius: 4,
  fontSize: 13.5,
  cursor: 'pointer',
};
const btnSecondary: React.CSSProperties = {
  background: '#fff',
  color: INK,
  border: `1px solid ${INK}`,
  padding: '9px 18px',
  borderRadius: 4,
  fontSize: 13.5,
  cursor: 'pointer',
};

function Section({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <section id={`sec-${n}`} style={{ marginTop: 30, scrollMarginTop: 16 }}>
      <h2 style={{ fontSize: 16, margin: '0 0 14px', paddingBottom: 8, borderBottom: `2px solid ${INK}`, color: INK }}>
        <span style={{ color: ACCENT, fontWeight: 700, marginRight: 6 }}>{n}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}
function H3({ children }: { children: React.ReactNode }) {
  return (
    <h3 style={{ fontSize: 13.5, margin: '16px 0 8px', color: INK }}>
      {children}
      <Req />
    </h3>
  );
}
/** The "* required" marker — every questionnaire field is mandatory. */
function Req() {
  return (
    <span style={{ color: ACCENT, marginLeft: 3 }} aria-hidden title="Required">
      *
    </span>
  );
}
function H4({ children }: { children: React.ReactNode }) {
  return <h4 style={{ fontSize: 13, margin: '0 0 8px', color: '#6b7280' }}>{children}</h4>;
}

function CheckGrid({
  options,
  selected,
  onChange,
}: {
  options: string[];
  selected: string[];
  onChange: (v: string[]) => void;
}) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 26px', marginBottom: 6 }}>
      {options.map((o) => (
        <label key={o} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13.5, color: '#374151', minWidth: 150 }}>
          <input
            type="checkbox"
            checked={selected.includes(o)}
            onChange={(e) =>
              onChange(e.target.checked ? [...selected, o] : selected.filter((x) => x !== o))
            }
          />
          {o}
        </label>
      ))}
    </div>
  );
}

/**
 * Per-certification document upload. Renders one upload row for each ticked
 * certification (label === the cert name) plus a catch-all "Other documents"
 * row for anything not tied to a listed certification. Existing files are
 * grouped under their label; legacy files with no label fall into "Other".
 */
function CertUploads({
  certifications,
  files,
  disabled,
  onUpload,
}: {
  certifications: string[];
  files: CertificateFile[];
  disabled: boolean;
  onUpload: (file: File, label?: string) => void | Promise<void>;
}) {
  const forLabel = (label?: string) =>
    files.filter((f) =>
      label ? f.label === label : !f.label || f.label.trim() === '',
    );
  const rows: Array<{ key: string; title: string; label?: string }> = [
    ...certifications.map((c) => ({ key: c, title: c, label: c })),
    { key: '__other__', title: 'Other documents', label: undefined },
  ];
  return (
    <div style={{ margin: '12px 0 4px' }}>
      <H4>Certification documents</H4>
      {certifications.length === 0 && (
        <p style={{ fontSize: 12.5, color: '#6b7280', margin: '0 0 8px' }}>
          Tick a certification above to attach its document, or use “Other
          documents” below.
        </p>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {rows.map((row) => {
          const uploaded = forLabel(row.label);
          return (
            <div
              key={row.key}
              style={{
                border: '1px solid #e5e7eb',
                borderRadius: 5,
                padding: '8px 10px',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  flexWrap: 'wrap',
                }}
              >
                <span
                  style={{
                    fontSize: 13.5,
                    color: INK,
                    fontWeight: 600,
                    minWidth: 140,
                  }}
                >
                  {row.title}
                </span>
                <input
                  type="file"
                  multiple
                  disabled={disabled}
                  style={{ fontSize: 13 }}
                  onChange={(e) => {
                    const picked = Array.from(e.target.files ?? []);
                    picked.forEach((f) => void onUpload(f, row.label));
                    e.target.value = '';
                  }}
                />
              </div>
              {uploaded.length > 0 && (
                <ul style={{ fontSize: 13, color: '#374151', margin: '6px 0 0', paddingLeft: 18 }}>
                  {uploaded.map((c) => (
                    <li key={c.storageKey}>{c.name}</li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** One capability row's answer: whether it's available and, if so, how many. */
type CapabilityCell = { available?: string; count?: string };
/** Stored map tolerates the legacy flat shape (capability -> 'yes'|'no'). */
type CapabilityValue = Record<string, CapabilityCell | string>;

function YesNoGrid({
  rows,
  value,
  onChange,
}: {
  rows: string[];
  value: CapabilityValue;
  onChange: (v: Record<string, CapabilityCell>) => void;
}) {
  // Normalize a cell, tolerating the older flat 'yes'/'no' string shape.
  const cell = (r: string): CapabilityCell => {
    const raw = value[r];
    return typeof raw === 'string' ? { available: raw } : (raw ?? {});
  };
  // Rebuild the whole map in the nested shape, then apply the patch to one row.
  const update = (r: string, patch: CapabilityCell) => {
    const next: Record<string, CapabilityCell> = {};
    for (const key of Object.keys(value)) {
      const raw = value[key];
      next[key] = typeof raw === 'string' ? { available: raw } : { ...raw };
    }
    next[r] = { ...cell(r), ...patch };
    onChange(next);
  };
  const th: React.CSSProperties = { background: INK, color: '#fff', fontSize: 12.5, padding: '8px 10px' };
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 6 }}>
      <thead>
        <tr>
          <th style={{ ...th, textAlign: 'left' }}>Capability</th>
          <th style={{ ...th, width: 60 }}>Yes</th>
          <th style={{ ...th, width: 60 }}>No</th>
          <th style={{ ...th, width: 100, textAlign: 'left' }}>Count</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const c = cell(r);
          const available = c.available === 'yes';
          return (
            <tr key={r}>
              <td style={{ padding: '6px 8px', borderBottom: '1px solid #d8dbe2', fontSize: 13.5 }}>{r}</td>
              {['yes', 'no'].map((opt) => (
                <td key={opt} style={{ textAlign: 'center', borderBottom: '1px solid #d8dbe2' }}>
                  <input
                    type="radio"
                    name={`ynr-${r}`}
                    checked={c.available === opt}
                    // Clearing availability to "no" also clears any count.
                    onChange={() => update(r, opt === 'yes' ? { available: opt } : { available: opt, count: '' })}
                  />
                </td>
              ))}
              <td style={{ padding: '4px 8px', borderBottom: '1px solid #d8dbe2' }}>
                <input
                  type="number"
                  min={0}
                  step={1}
                  style={{ ...inputStyle, width: 84, padding: '4px 6px' }}
                  value={c.count ?? ''}
                  disabled={!available}
                  placeholder={available ? 'e.g. 3' : '—'}
                  onChange={(e) => update(r, { count: e.target.value })}
                />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function GridTable({
  columns,
  value,
  onChange,
}: {
  columns: string[];
  value: string[][];
  onChange: (v: string[][]) => void;
}) {
  return (
    <div>
      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 6 }}>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c} style={{ background: INK, color: '#fff', fontSize: 12.5, padding: '8px 10px', textAlign: 'left' }}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {value.map((row, ri) => (
            <tr key={ri}>
              {columns.map((_, ci) => (
                <td key={ci} style={{ padding: '4px', borderBottom: '1px solid #d8dbe2' }}>
                  <input
                    style={inputStyle}
                    value={row[ci] ?? ''}
                    onChange={(e) => {
                      const next = value.map((r) => [...r]);
                      next[ri][ci] = e.target.value;
                      onChange(next);
                    }}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <button
        type="button"
        style={{ ...btnSecondary, padding: '5px 12px', fontSize: 12.5 }}
        onClick={() => onChange([...value, columns.map(() => '')])}
      >
        + Add row
      </button>
    </div>
  );
}

function DynamicList({
  value,
  placeholder,
  onChange,
}: {
  value: string[];
  placeholder: string;
  onChange: (v: string[]) => void;
}) {
  return (
    <div>
      {value.map((item, i) => (
        <input
          key={i}
          style={{ ...inputStyle, marginBottom: 6 }}
          placeholder={placeholder}
          value={item}
          onChange={(e) => {
            const next = [...value];
            next[i] = e.target.value;
            onChange(next);
          }}
        />
      ))}
      <button
        type="button"
        style={{ ...btnSecondary, padding: '5px 12px', fontSize: 12.5 }}
        onClick={() => onChange([...value, ''])}
      >
        + Add
      </button>
    </div>
  );
}

function FieldRow({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '5px 0', borderBottom: '1px solid #d8dbe2' }}>
      <span style={{ width: '40%', fontSize: 13.5, color: '#374151' }}>
        {label}
        <Req />
      </span>
      <input style={inputStyle} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function FieldRows({
  section,
  state,
  setField,
  fields,
}: {
  section: SectionKey;
  state: SectionState;
  setField: (s: SectionKey, k: string, v: unknown) => void;
  fields: [string, string][];
}) {
  return (
    <div>
      {fields.map(([key, label]) => (
        <FieldRow
          key={key}
          label={label}
          value={(state[key] as string) ?? ''}
          onChange={(v) => setField(section, key, v)}
        />
      ))}
    </div>
  );
}
