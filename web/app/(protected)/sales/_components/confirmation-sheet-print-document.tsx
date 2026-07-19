import { Customer, OrderConfirmationSheet } from '../../../lib/types';
import { COMPANY } from '../../../lib/theme';
import { prettyEnum } from '../../../lib/sales';
import { signatureStyle } from '../../../lib/signature';

// Letterhead palette — matches BidPrintDocument / KickoffPrintDocument so all
// outward-facing documents share one branded header.
const NAVY = '#16283b';
const ACCENT = '#e0a83d';
const MUTED = '#6b7280';

/** Render an address object/string as newline-joined lines (skips blanks). */
function addressLines(addr: unknown): string[] {
  if (!addr) return [];
  if (typeof addr === 'string') return [addr];
  if (typeof addr === 'object') {
    const a = addr as Record<string, unknown>;
    // De-duplicate identical values (some seed rows repeat line1 into state).
    const parts = [a.line1, a.line2, a.city, a.state, a.pincode, a.country]
      .map((v) => (v == null ? '' : String(v).trim()))
      .filter(Boolean);
    return Array.from(new Set(parts));
  }
  return [String(addr)];
}

const SECTION_LABEL: React.CSSProperties = {
  fontSize: 10,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  color: '#666',
  marginBottom: 4,
};

const SECTION_BODY: React.CSSProperties = {
  fontSize: 11,
  whiteSpace: 'pre-wrap',
};

/** One labelled print section. Renders nothing when the value is empty. */
function Section({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) {
  if (!value) return null;
  return (
    <div className="print-avoid-break" style={{ marginBottom: 14 }}>
      <div style={SECTION_LABEL}>{label}</div>
      <div style={SECTION_BODY}>{value}</div>
    </div>
  );
}

/**
 * Print-only Order Confirmation Sheet. Mirrors BidPrintDocument: hidden on
 * screen (`.print-document`), revealed by the @media print rules in
 * globals.css for Save-as-PDF. This is the external-facing document that gets
 * physically signed by the customer and countersigned by the Sales Head, so
 * it ends with two signature blocks and carries no app chrome.
 */
export function ConfirmationSheetPrintDocument({
  sheet,
  customer,
  generatedOn,
}: {
  sheet: OrderConfirmationSheet;
  customer: Customer | null;
  /** Pre-formatted YYYY-MM-DD; passed in so render stays deterministic. */
  generatedOn: string;
}) {
  const primaryContact =
    customer?.contacts?.find((c) => c.isPrimary) ?? customer?.contacts?.[0];
  const custAddress = addressLines(customer?.billingAddress);

  const qualityReports = sheet.qualityReportsExpected
    .map((q) => prettyEnum(q))
    .join(', ');

  return (
    <div className="print-document">
      {/* Letterhead */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          borderBottom: '2px solid #000',
          paddingBottom: 12,
          marginBottom: 20,
        }}
      >
        {/* Branded letterhead — logo (with wordmark fallback) + contact block,
            matching BidPrintDocument / KickoffPrintDocument. */}
        <div style={{ display: 'flex', alignItems: 'center' }}>
          {COMPANY.logoPath ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={COMPANY.logoPath}
              alt={`${COMPANY.name} logo`}
              style={{ height: 52, width: 'auto', objectFit: 'contain' }}
            />
          ) : (
            <span style={{ fontSize: 22, fontWeight: 800 }}>{COMPANY.name}</span>
          )}
          <div style={{ marginLeft: 12, fontSize: 11, color: MUTED }}>
            <div
              style={{
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                color: NAVY,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <span style={{ width: 8, height: 8, background: ACCENT, display: 'inline-block' }} />
              Get in touch
            </div>
            <div style={{ marginTop: 3 }}>{COMPANY.contactEmail}</div>
            <div>{COMPANY.website}</div>
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 20, fontWeight: 700 }}>
            Order Confirmation Sheet
          </div>
          <div style={{ fontSize: 12, marginTop: 4 }}>
            {sheet.confirmationNumber}
          </div>
          <div style={{ fontSize: 11, color: MUTED }}>
            Revision {sheet.revisionNumber}
          </div>
          <div style={{ fontSize: 11, color: MUTED }}>
            Date: {generatedOn}
          </div>
        </div>
      </div>

      {/* Recipient block */}
      <div style={{ marginBottom: 20 }}>
        <div style={SECTION_LABEL}>Prepared for</div>
        <div style={{ fontSize: 13, fontWeight: 600 }}>
          {customer?.name ?? '—'}
        </div>
        {custAddress.map((line, i) => (
          <div key={i} style={{ fontSize: 11, color: '#333' }}>
            {line}
          </div>
        ))}
        {customer?.gstin && (
          <div style={{ fontSize: 11, color: '#333' }}>
            GSTIN: {customer.gstin}
          </div>
        )}
        {primaryContact && (
          <div style={{ fontSize: 11, color: '#333', marginTop: 4 }}>
            Attention: {primaryContact.name}
            {primaryContact.designation ? `, ${primaryContact.designation}` : ''}
          </div>
        )}
      </div>

      {/* Requirements */}
      <Section
        label="Requirements Overview"
        value={sheet.requirementsOverview}
      />

      {/* Delivery */}
      <div className="print-avoid-break" style={{ marginBottom: 14 }}>
        <div style={SECTION_LABEL}>Delivery</div>
        <table style={{ width: '100%', fontSize: 11 }}>
          <tbody>
            <tr>
              <td style={{ color: '#666', paddingRight: 8, width: 160 }}>
                Delivery date
              </td>
              <td style={{ fontWeight: 600 }}>
                {sheet.deliveryDate ? sheet.deliveryDate.slice(0, 10) : '—'}
              </td>
            </tr>
            <tr>
              <td style={{ color: '#666', paddingRight: 8 }}>
                Delivery location
              </td>
              <td style={{ fontWeight: 600 }}>
                {sheet.deliveryLocation || '—'}
              </td>
            </tr>
            <tr>
              <td style={{ color: '#666', paddingRight: 8 }}>Delivery type</td>
              <td style={{ fontWeight: 600 }}>
                {sheet.deliveryType ? prettyEnum(sheet.deliveryType) : '—'}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Packaging */}
      <div className="print-avoid-break" style={{ marginBottom: 14 }}>
        <div style={SECTION_LABEL}>Packaging</div>
        <table style={{ width: '100%', fontSize: 11 }}>
          <tbody>
            <tr>
              <td style={{ color: '#666', paddingRight: 8, width: 160 }}>
                Packaging type
              </td>
              <td style={{ fontWeight: 600 }}>{sheet.packagingType || '—'}</td>
            </tr>
            <tr>
              <td
                style={{
                  color: '#666',
                  paddingRight: 8,
                  verticalAlign: 'top',
                }}
              >
                Protective measures
              </td>
              <td style={{ whiteSpace: 'pre-wrap' }}>
                {sheet.protectiveMeasures || '—'}
              </td>
            </tr>
            {sheet.packagingComplianceStandard && (
              <tr>
                <td style={{ color: '#666', paddingRight: 8 }}>
                  Compliance standard
                </td>
                <td>{sheet.packagingComplianceStandard}</td>
              </tr>
            )}
            <tr>
              <td
                style={{
                  color: '#666',
                  paddingRight: 8,
                  verticalAlign: 'top',
                }}
              >
                Labeling requirements
              </td>
              <td style={{ whiteSpace: 'pre-wrap' }}>
                {sheet.labelingRequirements || '—'}
              </td>
            </tr>
            {sheet.customerPackagingSpecReference && (
              <tr>
                <td style={{ color: '#666', paddingRight: 8 }}>
                  Customer spec reference
                </td>
                <td>{sheet.customerPackagingSpecReference}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Quality reports */}
      {(qualityReports || sheet.qualityReportNotes) && (
        <div className="print-avoid-break" style={{ marginBottom: 14 }}>
          <div style={SECTION_LABEL}>Quality reports expected</div>
          {qualityReports && <div style={SECTION_BODY}>{qualityReports}</div>}
          {sheet.qualityReportNotes && (
            <div style={{ ...SECTION_BODY, marginTop: 4, color: '#333' }}>
              {sheet.qualityReportNotes}
            </div>
          )}
        </div>
      )}

      {/* Installation / commissioning */}
      <div className="print-avoid-break" style={{ marginBottom: 14 }}>
        <div style={SECTION_LABEL}>Installation &amp; commissioning</div>
        <div style={SECTION_BODY}>
          {sheet.installationCommissioningRequired ? 'Required' : 'Not required'}
        </div>
        {sheet.installationNotes && (
          <div style={{ ...SECTION_BODY, marginTop: 4, color: '#333' }}>
            {sheet.installationNotes}
          </div>
        )}
      </div>

      <Section label="Warranty Terms" value={sheet.warrantyTerms} />
      <Section label="Payment Milestones" value={sheet.paymentMilestones} />
      <Section
        label="Site Readiness Requirements"
        value={sheet.siteReadinessRequirements}
      />
      <Section
        label="Special Handling Instructions"
        value={sheet.specialHandlingInstructions}
      />

      {/* Customer coordination contact */}
      <div className="print-avoid-break" style={{ marginBottom: 14 }}>
        <div style={SECTION_LABEL}>Customer coordination contact</div>
        <table style={{ width: '100%', fontSize: 11 }}>
          <tbody>
            <tr>
              <td style={{ color: '#666', paddingRight: 8, width: 160 }}>
                Name
              </td>
              <td style={{ fontWeight: 600 }}>
                {sheet.customerContactName || '—'}
              </td>
            </tr>
            <tr>
              <td style={{ color: '#666', paddingRight: 8 }}>Phone</td>
              <td>{sheet.customerContactPhone || '—'}</td>
            </tr>
            <tr>
              <td style={{ color: '#666', paddingRight: 8 }}>Email</td>
              <td>{sheet.customerContactEmail || '—'}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Signature blocks — this document is physically signed. */}
      <div
        className="print-avoid-break"
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: 40,
          marginTop: 56,
        }}
      >
        <div style={{ flex: 1 }}>
          <div style={{ borderTop: '1px solid #000', paddingTop: 6 }}>
            <div style={{ fontSize: 11, fontWeight: 600 }}>
              Customer signature
            </div>
            <div style={{ fontSize: 10, color: '#666', marginTop: 20 }}>
              Name / Date
            </div>
          </div>
        </div>
        <div style={{ flex: 1 }}>
          {/* When executed, render the Sales Head's e-signature (if configured)
              above the line, and always show WHO signed + the date so the
              document reads as signed even without a typed signature. */}
          {sheet.status === 'EXECUTED' ? (
            <>
              <div
                style={{
                  fontSize: 24,
                  lineHeight: 1.1,
                  minHeight: 30,
                  ...signatureStyle(sheet.approverSignatureFontSnapshot),
                }}
              >
                {sheet.approverSignatureTextSnapshot ?? ''}
              </div>
              <div style={{ borderTop: '1px solid #000', paddingTop: 6 }}>
                <div style={{ fontSize: 11, fontWeight: 600 }}>
                  For {COMPANY.name} (Sales Head)
                </div>
                <div style={{ fontSize: 10, color: '#666', marginTop: 4 }}>
                  {sheet.internalSignedByName ?? ''}
                  {sheet.internalSignedByName && sheet.internalSignedAt
                    ? ' · '
                    : ''}
                  {sheet.internalSignedAt
                    ? sheet.internalSignedAt.slice(0, 10)
                    : ''}
                </div>
              </div>
            </>
          ) : (
            <div style={{ borderTop: '1px solid #000', paddingTop: 6 }}>
              <div style={{ fontSize: 11, fontWeight: 600 }}>
                For {COMPANY.name} (Sales Head)
              </div>
              <div style={{ fontSize: 10, color: '#666', marginTop: 20 }}>
                Name / Date
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div
        style={{
          marginTop: 40,
          paddingTop: 8,
          borderTop: '1px solid #ddd',
          fontSize: 9,
          color: '#888',
          textAlign: 'center',
        }}
      >
        Generated by {COMPANY.name} ERP on {generatedOn}. This is a
        system-generated document.
      </div>
    </div>
  );
}
