'use client';

import { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { apiFetch, ApiError } from '../../../../lib/api';
import {
  SECTION_KEYS,
  type VendorDetail,
  type VendorQuestionnaire,
} from '../../../../lib/scm';
import { Button } from '../../../../components/ui/button';
import { useToast } from '../../../../components/ui/toaster';

/** Section key → human title (matches the VSAQ's numbered sections). */
const SECTION_TITLES: Record<string, string> = {
  businessProfile: '1. Business Profile',
  manufacturingCapability: '2. Manufacturing Capability',
  equipmentDetails: '3. Equipment Details',
  productionCapacity: '4. Production Capacity',
  qualityManagement: '5. Quality Management',
  engineeringCapability: '6. Engineering Capability',
  supplyChain: '7. Supply Chain',
  traceability: '8. Traceability',
  logistics: '9. Logistics',
  sustainability: '10. Sustainability',
  informationSecurity: '11. Information Security',
  businessContinuity: '12. Business Continuity',
  ehs: '13. EHS',
  financialInformation: '14. Financial Information',
  customerSupport: '15. Customer Support',
  compliance: '16. Compliance',
  references: '17. References',
  declaration: '18. Declaration',
};

/** Render any JSON value as readable read-only content. */
function renderValue(value: unknown): React.ReactNode {
  if (value == null || value === '')
    return <span className="text-muted-foreground">—</span>;
  if (Array.isArray(value)) {
    if (value.length === 0)
      return <span className="text-muted-foreground">—</span>;
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
    // Capability cell { available: 'yes'|'no', count?: string } → "Yes (3)".
    const cell = value as { available?: unknown; count?: unknown };
    if (
      typeof cell.available === 'string' &&
      Object.keys(value as object).every(
        (k) => k === 'available' || k === 'count',
      )
    ) {
      const yes = cell.available === 'yes';
      const count = typeof cell.count === 'string' ? cell.count.trim() : '';
      if (!yes) return 'No';
      return count ? `Yes (${count})` : 'Yes';
    }
    return (
      <div className="ml-2 space-y-0.5">
        {Object.entries(value as Record<string, unknown>).map(([k, v]) => (
          <div
            key={k}
            className="grid grid-cols-[minmax(120px,220px)_1fr] gap-2"
          >
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

/**
 * Read-only rendering of a SUBMITTED questionnaire's 18 sections. The section
 * content is opaque JSON (the public form owns its exact shape), so this
 * renders generically — objects as label/value rows, arrays as lists, booleans
 * as Yes/No. Empty sections are skipped. Certificate files are listed by name.
 */
export function QuestionnaireView({
  questionnaire,
  vendor,
}: {
  questionnaire: VendorQuestionnaire;
  vendor: VendorDetail;
}) {
  const toast = useToast();
  const [openingCertificate, setOpeningCertificate] = useState<number | null>(
    null,
  );
  const filled = SECTION_KEYS.filter((k) => {
    const v = questionnaire[k];
    return v != null && Object.keys(v as object).length > 0;
  });

  async function openCertificate(fileIndex: number) {
    setOpeningCertificate(fileIndex);
    try {
      const result = await apiFetch<{ downloadUrl: string }>(
        `/vendors/questionnaires/${questionnaire.id}/certificates/${fileIndex}/download`,
      );
      window.open(result.downloadUrl, '_blank', 'noopener,noreferrer');
    } catch (error) {
      toast.error(
        error instanceof ApiError
          ? error.message
          : 'Could not open the certificate',
      );
      setOpeningCertificate(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="text-sm font-medium">
        Submitted responses (Rev {questionnaire.revisionNumber})
      </div>

      {/* Vendor Information section — from the Vendor record itself. */}
      <section className="rounded-md border p-3">
        <div className="mb-2 font-medium">Vendor Information</div>
        <div className="space-y-0.5 text-sm">
          <Row label="Company Name" value={vendor.companyName} />
          <Row label="Registered Address" value={vendor.registeredAddress} />
          <Row label="Factory Address" value={vendor.factoryAddress} />
          <Row label="Year Established" value={vendor.yearEstablished} />
          <Row label="Employees" value={vendor.numberOfEmployees} />
          <Row label="Annual Turnover" value={vendor.annualTurnover} />
          <Row
            label="Contact"
            value={joinParts([
              vendor.contactPersonName,
              vendor.contactPersonDesignation,
            ])}
          />
        </div>
      </section>

      {filled.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No section responses were recorded.
        </p>
      ) : (
        filled.map((k) => (
          <section key={k} className="rounded-md border p-3 text-sm">
            <div className="mb-2 font-medium">{SECTION_TITLES[k] ?? k}</div>
            {renderValue(questionnaire[k])}
          </section>
        ))
      )}

      {/* Uploaded certificates */}
      <section className="rounded-md border p-3 text-sm">
        <div className="mb-2 font-medium">Quality Certificates</div>
        {questionnaire.qualityCertificateFiles.length === 0 ? (
          <span className="text-muted-foreground">None uploaded.</span>
        ) : (
          <ul className="divide-y rounded-md border">
            {questionnaire.qualityCertificateFiles.map((f, index) => (
              <li
                key={`${f.storageKey}-${index}`}
                className="flex flex-wrap items-center justify-between gap-3 p-3"
              >
                <div className="min-w-0">
                  {f.label && <span className="font-medium">{f.label}: </span>}
                  <span className="break-all">{f.name}</span>
                  {f.sizeBytes != null && (
                    <span className="ml-1 text-muted-foreground">
                      ({Math.round(f.sizeBytes / 1024)} KB)
                    </span>
                  )}
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={openingCertificate === index}
                  onClick={() => void openCertificate(index)}
                >
                  <ExternalLink className="size-4" />
                  {openingCertificate === index
                    ? 'Opening…'
                    : 'View / download'}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="grid grid-cols-[minmax(120px,220px)_1fr] gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span>{value ?? <span className="text-muted-foreground">—</span>}</span>
    </div>
  );
}

/** Join non-empty parts with " · ", falling back to "—" when nothing is set. */
function joinParts(parts: (string | null | undefined)[]): string {
  const present = parts.filter((p): p is string => !!p?.trim());
  return present.length > 0 ? present.join(' · ') : '—';
}
