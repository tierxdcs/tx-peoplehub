'use client';

import {
  FILLED_BY_LABEL,
  OPTIONAL_SECTION_KEYS,
  SECTION_KEYS,
  type SupplierDetail,
  type SupplierQuestionnaire,
} from '../../../../lib/scm-supplier';

/** Section key → human title (the 9 supplier questionnaire sections). */
const SECTION_TITLES: Record<string, string> = {
  materialRange: '1. Material Range',
  materialCertifications: '2. Material Certifications',
  compliance: '3. Compliance (RoHS / REACH / Conflict Minerals)',
  qualityCertifications: '4. Quality Certifications',
  commercialTerms: '5. Commercial Terms',
  packagingAndDelivery: '6. Packaging & Delivery',
  logistics: '7. Logistics',
  references: '8. References',
  declaration: '9. Declaration',
};

/** Render any JSON value as readable read-only content. */
function renderValue(value: unknown): React.ReactNode {
  if (value == null || value === '') return <span className="text-muted-foreground">—</span>;
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-muted-foreground">—</span>;
    return (
      <ul className="list-inside list-disc">
        {value.map((v, i) => (
          <li key={i}>{renderValue(v)}</li>
        ))}
      </ul>
    );
  }
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'object') {
    return (
      <div className="ml-2 space-y-0.5">
        {Object.entries(value as Record<string, unknown>).map(([k, v]) => (
          <div key={k} className="grid grid-cols-[minmax(120px,220px)_1fr] gap-2">
            <span className="text-muted-foreground">{humanizeKey(k)}</span>
            <span>{renderValue(v)}</span>
          </div>
        ))}
      </div>
    );
  }
  return String(value);
}

function humanizeKey(k: string): string {
  return k
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function isFilled(v: unknown): boolean {
  return v != null && typeof v === 'object' && Object.keys(v as object).length > 0;
}

/**
 * Read-only rendering of a SUBMITTED questionnaire's 9 sections. Section content
 * is opaque JSON (the public form owns its exact shape), so this renders
 * generically — objects as label/value rows, arrays as lists, booleans as
 * Yes/No. Certificate files are listed by name.
 *
 * Packaging & Delivery is OPTIONAL: when left blank it is shown explicitly as
 * "Not provided (optional section)" rather than silently omitted, so a blank
 * state reads as expected rather than as a gap/error (spec §3.2). Other empty
 * sections are simply skipped.
 */
export function QuestionnaireView({
  questionnaire,
  supplier,
}: {
  questionnaire: SupplierQuestionnaire;
  supplier: SupplierDetail;
}) {
  // Sections to render: any filled section, plus optional sections always
  // (so a blank optional section renders its explicit "Not provided" state).
  const sectionsToShow = SECTION_KEYS.filter(
    (k) => isFilled(questionnaire[k]) || OPTIONAL_SECTION_KEYS.includes(k),
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
        Submitted responses (Rev {questionnaire.revisionNumber})
        {questionnaire.filledBy && (
          <span
            className={
              'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ' +
              (questionnaire.filledBy === 'INTERNAL_STAFF'
                ? 'bg-amber-100 text-amber-800'
                : 'bg-emerald-100 text-emerald-800')
            }
          >
            {FILLED_BY_LABEL[questionnaire.filledBy]}
          </span>
        )}
      </div>

      {/* Supplier Information section — from the Supplier record itself. */}
      <section className="rounded-md border p-3">
        <div className="mb-2 font-medium">Supplier Information</div>
        <div className="space-y-0.5 text-sm">
          <Row label="Company Name" value={supplier.companyName} />
          <Row label="Registered Address / Origin" value={supplier.registeredAddress} />
          <Row label="Factory Address" value={supplier.factoryAddress} />
          <Row label="Year Established" value={supplier.yearEstablished} />
          <Row label="Employees" value={supplier.numberOfEmployees} />
          <Row label="Annual Turnover" value={supplier.annualTurnover} />
          <Row label="Contact" value={`${supplier.contactPersonName} · ${supplier.contactPersonDesignation}`} />
        </div>
      </section>

      {sectionsToShow.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No section responses were recorded.
        </p>
      ) : (
        sectionsToShow.map((k) => {
          const optional = OPTIONAL_SECTION_KEYS.includes(k);
          const filled = isFilled(questionnaire[k]);
          return (
            <section key={k} className="rounded-md border p-3 text-sm">
              <div className="mb-2 font-medium">
                {SECTION_TITLES[k] ?? k}
                {optional && (
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    (Optional)
                  </span>
                )}
              </div>
              {filled ? (
                renderValue(questionnaire[k])
              ) : (
                <span className="text-muted-foreground">
                  Not provided (optional section)
                </span>
              )}
            </section>
          );
        })
      )}

      {/* Uploaded certificates */}
      <section className="rounded-md border p-3 text-sm">
        <div className="mb-2 font-medium">Certificate Files</div>
        {questionnaire.certificateFiles.length === 0 ? (
          <span className="text-muted-foreground">None uploaded.</span>
        ) : (
          <ul className="list-inside list-disc">
            {questionnaire.certificateFiles.map((f) => (
              <li key={f.storageKey}>
                {f.name}
                {f.sizeBytes != null && (
                  <span className="text-muted-foreground">
                    {' '}
                    ({Math.round(f.sizeBytes / 1024)} KB)
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[minmax(120px,220px)_1fr] gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span>{value}</span>
    </div>
  );
}
