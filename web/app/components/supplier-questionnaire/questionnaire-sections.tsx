'use client';

import type { CertificateFile, SectionKey } from '../../lib/scm-supplier';

/**
 * The 9 supplier-questionnaire sections + certificate upload, as a single
 * shared form body used by BOTH the external public page and the internal-fill
 * UI (spec: reuse the same section components, no second copy). Purely
 * controlled — the host owns form state, save/submit actions, and the banner.
 *
 * Inline-styled (not shadcn) so it renders identically inside the app shell and
 * on the standalone public document. Style constants are exported so hosts can
 * match button styling.
 */

export const ACCENT = '#f97316';
export const INK = '#1e2340';

export type SectionState = Record<string, unknown>;
export type FormState = Partial<Record<SectionKey, SectionState>>;

export function QuestionnaireSections({
  form,
  setField,
  certs,
  onUploadCert,
}: {
  form: FormState;
  setField: (section: SectionKey, key: string, value: unknown) => void;
  certs: CertificateFile[];
  onUploadCert: (file: File) => void;
}) {
  const g = (s: SectionKey) => (form[s] ?? {}) as SectionState;

  return (
    <>
      {/* 1. Material Range */}
      <Section n="1" title="Material Range">
        <H3>Material Categories Supplied</H3>
        <CheckGrid
          options={['Ferrous Metals', 'Non-Ferrous Metals', 'Polymers / Plastics', 'Composites', 'Rubber / Elastomers', 'Chemicals', 'Adhesives / Sealants', 'Fasteners / Hardware']}
          selected={(g('materialRange').categories as string[]) ?? []}
          onChange={(v) => setField('materialRange', 'categories', v)}
        />
        <H3>Grades / Specifications Offered</H3>
        <DynamicList
          value={(g('materialRange').grades as string[]) ?? ['']}
          placeholder="e.g. SS 304, AL 6061-T6, PA66-GF30"
          onChange={(v) => setField('materialRange', 'grades', v)}
        />
        <H3>Form Supplied</H3>
        <CheckGrid
          options={['Sheet / Coil', 'Bar / Rod', 'Tube / Pipe', 'Wire', 'Pellets / Granules', 'Powder', 'Liquid', 'Ingot / Billet']}
          selected={(g('materialRange').forms as string[]) ?? []}
          onChange={(v) => setField('materialRange', 'forms', v)}
        />
      </Section>

      {/* 2. Material Certifications */}
      <Section n="2" title="Material Certifications">
        <H3>Certifications Held</H3>
        <CheckGrid
          options={['Mill Test Certificate (MTC / EN 10204 3.1)', 'RoHS', 'REACH', 'Material Safety Data Sheet (MSDS)', 'Certificate of Analysis', 'Certificate of Conformance', 'DFARS / Melt Origin']}
          selected={(g('materialCertifications').certifications as string[]) ?? []}
          onChange={(v) => setField('materialCertifications', 'certifications', v)}
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
              files.forEach((f) => onUploadCert(f));
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
        <FieldRows
          section="materialCertifications"
          state={g('materialCertifications')}
          setField={setField}
          fields={[
            ['testReports', 'Batch / Heat Test Reports Provided'],
            ['traceability', 'Material Traceability Method'],
          ]}
        />
      </Section>

      {/* 3. Compliance */}
      <Section n="3" title="Compliance (RoHS / REACH / Conflict Minerals)">
        <FieldRows
          section="compliance"
          state={g('compliance')}
          setField={setField}
          fields={[
            ['rohs', 'RoHS Compliance'],
            ['reach', 'REACH Compliance'],
            ['conflictMinerals', 'Conflict Minerals Declaration'],
            ['prop65', 'California Prop 65'],
            ['substanceRestrictions', 'Restricted Substance Controls'],
          ]}
        />
      </Section>

      {/* 4. Quality Certifications */}
      <Section n="4" title="Quality Certifications">
        <H3>Quality Systems</H3>
        <CheckGrid
          options={['ISO 9001', 'ISO 14001', 'ISO 45001', 'IATF 16949', 'AS9100', 'ISO 13485', 'NADCAP']}
          selected={(g('qualityCertifications').systems as string[]) ?? []}
          onChange={(v) => setField('qualityCertifications', 'systems', v)}
        />
        <FieldRows
          section="qualityCertifications"
          state={g('qualityCertifications')}
          setField={setField}
          fields={[
            ['incomingInspection', 'Incoming Inspection Process'],
            ['ppapCapability', 'PPAP / First-Article Capability'],
            ['labAccreditation', 'Lab Accreditation (ISO 17025)'],
          ]}
        />
      </Section>

      {/* 5. Commercial Terms */}
      <Section n="5" title="Commercial Terms">
        <FieldRows
          section="commercialTerms"
          state={g('commercialTerms')}
          setField={setField}
          fields={[
            ['moq', 'Minimum Order Quantity (MOQ)'],
            ['leadTime', 'Standard Lead Time'],
            ['pricingBasis', 'Pricing Basis / Validity'],
            ['paymentTerms', 'Payment Terms'],
            ['incoterms', 'Incoterms'],
            ['currency', 'Currency'],
          ]}
        />
      </Section>

      {/* 6. Packaging & Delivery — OPTIONAL */}
      <Section n="6" title="Packaging & Delivery" optional>
        <p style={{ fontSize: 13, color: '#6b7280', margin: '0 0 10px' }}>
          This section is optional — you may leave it blank if it does not apply.
        </p>
        <FieldRows
          section="packagingAndDelivery"
          state={g('packagingAndDelivery')}
          setField={setField}
          fields={[
            ['packagingMethod', 'Packaging Method'],
            ['unitPackSize', 'Unit Pack Size'],
            ['palletization', 'Palletization / Handling'],
            ['deliveryFrequency', 'Delivery Frequency'],
            ['shelfLife', 'Shelf Life (if applicable)'],
          ]}
        />
      </Section>

      {/* 7. Logistics */}
      <Section n="7" title="Logistics">
        <FieldRows
          section="logistics"
          state={g('logistics')}
          setField={setField}
          fields={[
            ['originLocation', 'Origin / Dispatch Location'],
            ['exportPackaging', 'Export Packaging'],
            ['ispm15', 'ISPM-15 (wood packaging)'],
            ['shippingPorts', 'Shipping Ports'],
            ['freightExperience', 'International Freight Experience'],
            ['warehousing', 'Warehousing / Buffer Stock'],
          ]}
        />
      </Section>

      {/* 8. References */}
      <Section n="8" title="References">
        {[0, 1, 2].map((i) => (
          <div key={i} style={{ padding: '12px 14px', background: '#f8f8f9', borderRadius: 4, marginBottom: 12 }}>
            <H4>{`Reference ${i + 1}`}</H4>
            {(['company', 'contact', 'phoneEmail', 'relationship'] as const).map((f) => (
              <FieldRow
                key={f}
                label={{ company: 'Company Name', contact: 'Contact Person', phoneEmail: 'Phone / Email', relationship: 'Relationship / Materials Supplied' }[f]}
                value={((g('references')[`ref${i}`] as Record<string, string>) ?? {})[f] ?? ''}
                onChange={(val) => {
                  const refs = g('references') as Record<string, Record<string, string>>;
                  const cur = refs[`ref${i}`] ?? {};
                  setField('references', `ref${i}`, { ...cur, [f]: val });
                }}
              />
            ))}
          </div>
        ))}
      </Section>

      {/* 9. Declaration */}
      <Section n="9" title="Declaration">
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
    </>
  );
}

// ── Shared style constants + reusable inputs ─────────────────────────
export const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '6px 8px',
  border: '1px solid #d8dbe2',
  borderRadius: 3,
  fontSize: 13.5,
  fontFamily: 'inherit',
  color: INK,
  boxSizing: 'border-box',
};
export const btnPrimary: React.CSSProperties = {
  background: INK,
  color: '#fff',
  border: 'none',
  padding: '9px 18px',
  borderRadius: 4,
  fontSize: 13.5,
  cursor: 'pointer',
};
export const btnSecondary: React.CSSProperties = {
  background: '#fff',
  color: INK,
  border: `1px solid ${INK}`,
  padding: '9px 18px',
  borderRadius: 4,
  fontSize: 13.5,
  cursor: 'pointer',
};

function Section({
  n,
  title,
  optional,
  children,
}: {
  n: string;
  title: string;
  optional?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section style={{ marginTop: 30 }}>
      <h2 style={{ fontSize: 16, margin: '0 0 14px', paddingBottom: 8, borderBottom: `2px solid ${INK}`, color: INK }}>
        <span style={{ color: ACCENT, fontWeight: 700, marginRight: 6 }}>{n}</span>
        {title}
        {optional && (
          <span style={{ marginLeft: 8, fontSize: 12.5, fontWeight: 400, color: '#6b7280' }}>
            (Optional)
          </span>
        )}
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
