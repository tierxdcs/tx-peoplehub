'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { COMPANY } from '../../../lib/theme';
import { uploadToPresignedUrl } from '../../../lib/vault-api';
import {
  publicCertConfirm,
  publicCertUploadUrl,
  resolvePublicQuestionnaire,
  savePublicQuestionnaire,
  submitPublicQuestionnaire,
  type CertificateFile,
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

export default function PublicVsaqPage() {
  const { token } = useParams<{ token: string }>();

  const [loading, setLoading] = useState(true);
  const [needsPassword, setNeedsPassword] = useState(false);
  const [password, setPassword] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [questionnaire, setQuestionnaire] = useState<VendorQuestionnaire | null>(null);
  const [form, setForm] = useState<FormState>({});
  const [certs, setCerts] = useState<CertificateFile[]>([]);
  const [saving, setSaving] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);

  // Password is kept in a ref so save/submit calls always use the resolved one.
  const pwRef = useRef<string | undefined>(undefined);

  const applyResolved = useCallback((q: VendorQuestionnaire) => {
    setQuestionnaire(q);
    setSubmitted(q.status === 'SUBMITTED');
    setCerts(q.qualityCertificateFiles ?? []);
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
    const res = await savePublicQuestionnaire(token, form, pwRef.current);
    setSaving(false);
    if (res.ok) setBanner('Progress saved. You can close this and resume later via the same link.');
    else setBanner(res.message);
  }

  async function submit() {
    const declared = (form.declaration ?? {}) as SectionState;
    if (!declared.certified) {
      setBanner('Please tick the certification checkbox in the Declaration section before submitting.');
      return;
    }
    setSaving(true);
    setBanner(null);
    const res = await submitPublicQuestionnaire(token, form, pwRef.current);
    setSaving(false);
    if (res.ok) {
      setSubmitted(true);
      setQuestionnaire(res.data);
    } else {
      setBanner(res.message);
    }
  }

  async function uploadCert(file: File) {
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
      { storageKey: presign.data.storageKey, name: file.name },
      pwRef.current,
    );
    if (confirmed.ok) setCerts((c) => [...c, confirmed.data]);
    else setBanner(confirmed.message);
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
        Please complete all sections that are relevant to your business. If a
        section or question does not apply, leave it blank. Use <strong>Save
        Progress</strong> at any time — you can close this page and resume later
        via the same link.
      </p>

      {banner && (
        <p style={{ margin: '0 0 16px', padding: '10px 14px', background: '#fff7ec', border: '1px solid #f1d9b0', borderRadius: 4, fontSize: 13.5, color: '#92400e' }}>
          {banner}
        </p>
      )}

      {/* 1. Business Profile */}
      <Section n="1" title="Business Profile">
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

      {/* 2. Manufacturing Capability — yes/no grid */}
      <Section n="2" title="Manufacturing Capability">
        <YesNoGrid
          rows={['Laser Cutting', 'CNC Punching', 'CNC Bending', 'Robotic Welding', 'TIG Welding', 'MIG Welding', 'Spot Welding', 'Powder Coating', 'Assembly Line', 'FAT Area']}
          value={(g('manufacturingCapability').capabilities as Record<string, string>) ?? {}}
          onChange={(v) => setField('manufacturingCapability', 'capabilities', v)}
        />
      </Section>

      {/* 3. Equipment Details — table */}
      <Section n="3" title="Equipment Details">
        <GridTable
          columns={['Machine Name', 'Manufacturer', 'Model', 'Capacity', 'Year Installed']}
          value={(g('equipmentDetails').machines as string[][]) ?? [['', '', '', '', '']]}
          onChange={(v) => setField('equipmentDetails', 'machines', v)}
        />
      </Section>

      {/* 4. Production Capacity */}
      <Section n="4" title="Production Capacity">
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

      {/* 5. Quality Management */}
      <Section n="5" title="Quality Management">
        <H3>Certifications</H3>
        <CheckGrid
          options={['ISO 9001', 'ISO 14001', 'ISO 45001', 'ISO 27001', 'IATF 16949', 'VDA', 'CE', 'UL']}
          selected={(g('qualityManagement').certifications as string[]) ?? []}
          onChange={(v) => setField('qualityManagement', 'certifications', v)}
        />
        <div style={{ margin: '10px 0' }}>
          <label style={{ fontSize: 13.5, color: '#374151', marginRight: 10 }}>
            Upload Certificates
          </label>
          <input
            type="file"
            multiple
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              files.forEach((f) => void uploadCert(f));
              e.target.value = '';
            }}
          />
          {certs.length > 0 && (
            <ul style={{ fontSize: 13, color: '#374151' }}>
              {certs.map((c) => (
                <li key={c.storageKey}>{c.name}</li>
              ))}
            </ul>
          )}
        </div>
        <H3>Inspection Equipment</H3>
        <CheckGrid
          options={['CMM', 'Height Gauge', 'Surface Plate', 'Vernier', 'Micrometer', 'Salt Spray', 'Coating Thickness Gauge', 'Torque Calibration']}
          selected={(g('qualityManagement').inspectionEquipment as string[]) ?? []}
          onChange={(v) => setField('qualityManagement', 'inspectionEquipment', v)}
        />
      </Section>

      {/* 6. Engineering Capability */}
      <Section n="6" title="Engineering Capability">
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

      {/* 7. Supply Chain */}
      <Section n="7" title="Supply Chain">
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

      {/* 8. Traceability */}
      <Section n="8" title="Traceability">
        <CheckGrid
          options={['Raw Material', 'Batch Number', 'Heat Number', 'Operator', 'Inspection Records', 'Calibration Records']}
          selected={(g('traceability').traceable as string[]) ?? []}
          onChange={(v) => setField('traceability', 'traceable', v)}
        />
      </Section>

      {/* 9. Logistics */}
      <Section n="9" title="Logistics">
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

      {/* 10. Sustainability */}
      <Section n="10" title="Sustainability">
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

      {/* 11. Information Security */}
      <Section n="11" title="Information Security">
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

      {/* 12. Business Continuity */}
      <Section n="12" title="Business Continuity">
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

      {/* 13. EHS */}
      <Section n="13" title="EHS (Environment, Health & Safety)">
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

      {/* 14. Financial Information */}
      <Section n="14" title="Financial Information">
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

      {/* 15. Customer Support */}
      <Section n="15" title="Customer Support">
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

      {/* 16. Compliance */}
      <Section n="16" title="Compliance">
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

      {/* 17. References */}
      <Section n="17" title="References">
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

      {/* 18. Declaration */}
      <Section n="18" title="Declaration">
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
    <section style={{ marginTop: 30 }}>
      <h2 style={{ fontSize: 16, margin: '0 0 14px', paddingBottom: 8, borderBottom: `2px solid ${INK}`, color: INK }}>
        <span style={{ color: ACCENT, fontWeight: 700, marginRight: 6 }}>{n}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}
function H3({ children }: { children: React.ReactNode }) {
  return <h3 style={{ fontSize: 13.5, margin: '16px 0 8px', color: INK }}>{children}</h3>;
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

function YesNoGrid({
  rows,
  value,
  onChange,
}: {
  rows: string[];
  value: Record<string, string>;
  onChange: (v: Record<string, string>) => void;
}) {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 6 }}>
      <thead>
        <tr>
          <th style={{ background: INK, color: '#fff', fontSize: 12.5, padding: '8px 10px', textAlign: 'left' }}>Capability</th>
          <th style={{ background: INK, color: '#fff', fontSize: 12.5, padding: '8px 10px', width: 70 }}>Yes</th>
          <th style={{ background: INK, color: '#fff', fontSize: 12.5, padding: '8px 10px', width: 70 }}>No</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r}>
            <td style={{ padding: '6px 8px', borderBottom: '1px solid #d8dbe2', fontSize: 13.5 }}>{r}</td>
            {['yes', 'no'].map((opt) => (
              <td key={opt} style={{ textAlign: 'center', borderBottom: '1px solid #d8dbe2' }}>
                <input
                  type="radio"
                  name={`ynr-${r}`}
                  checked={value[r] === opt}
                  onChange={() => onChange({ ...value, [r]: opt })}
                />
              </td>
            ))}
          </tr>
        ))}
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
      <span style={{ width: '40%', fontSize: 13.5, color: '#374151' }}>{label}</span>
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
