import { Bid, Customer } from '../../../lib/types';
import { COMPANY, PROPOSAL_TERMS } from '../../../lib/theme';
import { formatINR } from '../../../lib/sales';
import { amountToIndianWords } from '../../../lib/indian-number-words';

/** Palette — restrained: a dark navy for structure, amber accent, muted grey. */
const NAVY = '#16283b';
const ACCENT = '#e0a83d';
const RULE = '#dfe3e8';
const MUTED = '#6b7280';

/** Render an address object/string as newline-joined lines (skips blanks). */
function addressLines(addr: unknown): string[] {
  if (!addr) return [];
  if (typeof addr === 'string') return [addr];
  if (typeof addr === 'object') {
    const a = addr as Record<string, unknown>;
    const parts = [a.line1, a.line2, a.city, a.state, a.pincode, a.country]
      .map((v) => (v == null ? '' : String(v).trim()))
      .filter(Boolean);
    return Array.from(new Set(parts));
  }
  return [String(addr)];
}

/** A small uppercase kicker/label. */
function Kicker({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        color: NAVY,
        display: 'flex',
        alignItems: 'center',
        gap: 6,
      }}
    >
      <span
        style={{
          display: 'inline-block',
          width: 8,
          height: 8,
          background: ACCENT,
        }}
      />
      {children}
    </div>
  );
}

/**
 * The repeating page header (logo + get-in-touch). Rendered inside a <thead>
 * so print engines repeat it on every page. The accent divider sits under it.
 */
function PageHeader() {
  return (
    <div>
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        paddingBottom: 10,
      }}
    >
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
      </div>
      <div style={{ textAlign: 'right', fontSize: 11, color: MUTED }}>
        <div
          style={{
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: NAVY,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
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
      {/* Thin full-width rule with an amber segment on the left — repeats on
       * every page as part of the running header (matches the reference). The
       * base line is a solid navy BORDER (prints even when "Background
       * graphics" is off); the amber segment sits on top. */}
      <div style={{ borderTop: `2px solid ${NAVY}`, position: 'relative' }}>
        <div
          style={{
            position: 'absolute',
            top: -2,
            left: 0,
            width: '14%',
            borderTop: `2px solid ${ACCENT}`,
          }}
        />
      </div>
    </div>
  );
}

/** The repeating page footer (two addresses). Rendered inside a <tfoot>. */
function PageFooter() {
  return (
    <div style={{ paddingTop: 8 }}>
      {/* Full-width navy rule with an amber segment on the right (mirrors the
       * header). Solid borders so the line prints regardless of the browser's
       * "Background graphics" print setting. */}
      <div
        style={{
          borderTop: `2px solid ${NAVY}`,
          position: 'relative',
          marginBottom: 8,
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: -2,
            right: 0,
            width: '18%',
            borderTop: `2px solid ${ACCENT}`,
          }}
        />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 24 }}>
        <div style={{ fontSize: 9, color: MUTED, maxWidth: '55%' }}>
          <div
            style={{
              fontWeight: 700,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: NAVY,
            }}
          >
            {COMPANY.manufacturingCenter.label}
          </div>
          {COMPANY.manufacturingCenter.lines.map((l, i) => (
            <div key={i}>{l}</div>
          ))}
        </div>
        <div style={{ fontSize: 9, color: MUTED, textAlign: 'right' }}>
          <div
            style={{
              fontWeight: 700,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: NAVY,
            }}
          >
            {COMPANY.headquarters.label}
          </div>
          {COMPANY.headquarters.lines.map((l, i) => (
            <div key={i}>{l}</div>
          ))}
        </div>
      </div>
      <div
        style={{
          marginTop: 6,
          fontSize: 8,
          color: MUTED,
          textAlign: 'center',
        }}
      >
        {COMPANY.confidentialityLine}
      </div>
    </div>
  );
}

/**
 * Print-only "Techno-Commercial Proposal" (matches the reference PDF). Hidden
 * on screen (`.print-document`); revealed by @media print in globals.css on
 * Save-as-PDF.
 *
 * Layout uses a single outer <table> so the header (<thead>) and footer
 * (<tfoot>) REPEAT on every printed page, with all body content in one <tbody>
 * cell — the standard, reliable way to get running headers/footers in browser
 * print (no PDF library). The signature block is print-only blank lines, wired
 * to nothing.
 */
export function BidPrintDocument({
  bid,
  customer,
  preparedByName,
  generatedOn,
}: {
  bid: Bid;
  customer: Customer | null;
  /** Name of the rep who created the bid (Prepared By + closing). */
  preparedByName: string | null;
  /** Pre-formatted YYYY-MM-DD; passed in so render stays deterministic. */
  generatedOn: string;
}) {
  const primaryContact =
    customer?.contacts?.find((c) => c.isPrimary) ?? customer?.contacts?.[0];
  const custAddress = addressLines(customer?.billingAddress);
  const subject = bid.quotationSubject?.trim();
  const contactName = primaryContact?.name?.trim();

  const preparedBy = preparedByName ?? 'Sales & Business Development';
  const lineItems = bid.lineItems ?? [];

  const th: React.CSSProperties = {
    padding: '8px 8px',
    fontSize: 10,
    fontWeight: 700,
    color: '#fff',
    textAlign: 'left',
  };
  const thR: React.CSSProperties = { ...th, textAlign: 'right' };
  const td: React.CSSProperties = {
    padding: '8px 8px',
    fontSize: 10.5,
    verticalAlign: 'top',
    borderBottom: `1px solid ${RULE}`,
    overflowWrap: 'break-word',
    wordBreak: 'break-word',
  };
  const tdR: React.CSSProperties = { ...td, textAlign: 'right' };

  return (
    <div className="print-document" style={{ color: '#111', lineHeight: 1.5 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        {/* Running header (repeats every page) */}
        <thead className="print-running-head">
          <tr>
            <td style={{ padding: 0 }}>
              <PageHeader />
            </td>
          </tr>
        </thead>

        {/* Running footer (repeats every page) */}
        <tfoot className="print-running-foot">
          <tr>
            <td style={{ padding: 0 }}>
              <PageFooter />
            </td>
          </tr>
        </tfoot>

        <tbody>
          <tr>
            <td style={{ padding: '18px 0 0' }}>
              {/* Title + quote metadata */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  marginBottom: 26,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Kicker>Commercial Offer</Kicker>
                  <div
                    style={{
                      fontSize: 22,
                      fontWeight: 800,
                      color: NAVY,
                      letterSpacing: '-0.01em',
                      marginTop: 8,
                    }}
                  >
                    <span style={{ display: 'block', whiteSpace: 'nowrap' }}>
                      TECHNO-COMMERCIAL
                    </span>
                    <span style={{ display: 'block' }}>PROPOSAL</span>
                  </div>
                </div>
                <table
                  style={{
                    width: 250,
                    marginLeft: 'auto',
                    fontSize: 11,
                    borderCollapse: 'collapse',
                  }}
                >
                  <tbody>
                    <tr>
                      <td style={{ color: MUTED, paddingRight: 14 }}>Quote Ref</td>
                      <td
                        style={{
                          fontWeight: 700,
                          color: NAVY,
                          textAlign: 'right',
                        }}
                      >
                        {bid.bidNumber}
                      </td>
                    </tr>
                    <tr>
                      <td style={{ color: MUTED, paddingRight: 14, paddingTop: 4 }}>
                        Quote Date
                      </td>
                      <td
                        style={{
                          fontWeight: 700,
                          paddingTop: 4,
                          textAlign: 'right',
                        }}
                      >
                        {generatedOn}
                      </td>
                    </tr>
                    <tr>
                      <td style={{ color: MUTED, paddingRight: 14, paddingTop: 4 }}>
                        Valid Until
                      </td>
                      <td
                        style={{
                          fontWeight: 700,
                          paddingTop: 4,
                          textAlign: 'right',
                        }}
                      >
                        {bid.validUntil.slice(0, 10)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Prepared For / Prepared By */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 40,
                  marginBottom: 24,
                }}
              >
                <div style={{ fontSize: 12 }}>
                  <div style={{ color: ACCENT, fontWeight: 700, fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 6 }}>
                    Prepared For
                  </div>
                  <div style={{ fontWeight: 700 }}>{contactName ?? '—'}</div>
                  <div>M/s. {customer?.name ?? '—'}</div>
                  {custAddress.map((line, i) => (
                    <div key={i} style={{ color: '#333' }}>
                      {line}
                    </div>
                  ))}
                </div>
                <div style={{ fontSize: 12, textAlign: 'right' }}>
                  <div style={{ color: ACCENT, fontWeight: 700, fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 6 }}>
                    Prepared By
                  </div>
                  <div style={{ fontWeight: 700 }}>{COMPANY.name}</div>
                  <div>{preparedBy}</div>
                  <div style={{ color: '#333' }}>{COMPANY.contactEmail}</div>
                  <div style={{ color: '#333' }}>{COMPANY.website}</div>
                </div>
              </div>

              {/* Subject + greeting + opening */}
              <div style={{ fontSize: 12, marginBottom: 6 }}>
                <span style={{ fontWeight: 700 }}>Subject:</span>{' '}
                {subject
                  ? `Submission of quotation for supply of ${subject}.`
                  : 'Submission of quotation for your requirements.'}
              </div>
              <p style={{ fontSize: 12, marginBottom: 10 }}>
                Dear {contactName ?? 'Sir/Madam'},
              </p>
              <p style={{ fontSize: 12, marginBottom: 24 }}>
                We sincerely thank you for your interest in our solutions and for
                considering {COMPANY.name} for your esteemed requirements. It is
                our pleasure to submit our commercial offer for the supply of{' '}
                {subject ?? 'your requirements'}, as detailed below.
              </p>

              {/* Commercial offer table */}
              <Kicker>Commercial Offer</Kicker>
              <table
                style={{
                  width: '100%',
                  tableLayout: 'fixed',
                  borderCollapse: 'collapse',
                  marginTop: 10,
                  marginBottom: 8,
                }}
              >
                <thead>
                  <tr style={{ background: NAVY }}>
                    <th style={{ ...th, width: '5%' }}>Sl.</th>
                    <th style={{ ...th, width: '16%' }}>Part Code</th>
                    <th style={th}>Description</th>
                    <th style={{ ...thR, width: '7%' }}>Qty</th>
                    <th style={{ ...th, width: '9%' }}>Units</th>
                    <th style={{ ...thR, width: '13%' }}>Unit Price (INR)</th>
                    <th style={{ ...thR, width: '13%' }}>Total (INR)</th>
                  </tr>
                </thead>
                <tbody>
                  {lineItems.map((li, i) => (
                    <tr
                      key={li.id}
                      className="print-avoid-break"
                      style={{ background: i % 2 ? '#f6f8fa' : '#fff' }}
                    >
                      <td style={td}>{i + 1}</td>
                      <td style={td}>{li.productSku}</td>
                      <td style={td}>
                        <span style={{ fontWeight: 600 }}>{li.productName}</span>
                        {li.productDescription && (
                          <div style={{ color: MUTED, marginTop: 2 }}>
                            {li.productDescription}
                          </div>
                        )}
                      </td>
                      <td style={tdR}>{li.quantity}</td>
                      <td style={td}>{li.productUnitOfMeasure}</td>
                      <td style={tdR}>{formatINR(li.unitPrice)}</td>
                      <td style={tdR}>{formatINR(li.lineTotal)}</td>
                    </tr>
                  ))}
                  {/* Grand total — highlighted */}
                  <tr className="print-avoid-break" style={{ background: '#eef1f4' }}>
                    <td
                      colSpan={6}
                      style={{
                        padding: '9px 8px',
                        textAlign: 'right',
                        fontWeight: 700,
                        color: NAVY,
                        fontSize: 11,
                        letterSpacing: '0.04em',
                      }}
                    >
                      GRAND TOTAL (INR)
                    </td>
                    <td
                      style={{
                        padding: '9px 8px',
                        textAlign: 'right',
                        fontWeight: 800,
                        color: NAVY,
                        fontSize: 12,
                      }}
                    >
                      {formatINR(bid.totalAmount)}
                    </td>
                  </tr>
                </tbody>
              </table>

              {/* Amount in words + tax caption */}
              <p style={{ fontSize: 10.5, color: MUTED, marginBottom: 24 }}>
                Amount in words: {amountToIndianWords(bid.totalAmount)}. Prices
                are exclusive of applicable taxes and duties unless stated
                otherwise.
              </p>

              {/* General terms & conditions */}
              <Kicker>General Terms &amp; Conditions</Kicker>
              <ol style={{ fontSize: 11, paddingLeft: 20, margin: '10px 0 28px' }}>
                {PROPOSAL_TERMS.map((term, i) => (
                  <li
                    key={i}
                    className="print-avoid-break"
                    style={{ marginBottom: 6, color: '#333' }}
                  >
                    {term}
                  </li>
                ))}
              </ol>

              {/* Signature block — blank print lines, no data binding */}
              <div
                className="print-avoid-break"
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 48,
                  marginBottom: 28,
                }}
              >
                {[
                  {
                    heading: 'For Phaze Dynamics',
                    l1: 'Authorised Signatory',
                    l2: 'Name & Designation',
                  },
                  {
                    heading: 'Accepted by Client',
                    l1: 'Signature & Company Seal',
                    l2: 'Name, Designation & Date',
                  },
                ].map((b) => (
                  <div key={b.heading} style={{ flex: 1, fontSize: 11 }}>
                    <div style={{ fontWeight: 700, color: NAVY, marginBottom: 44 }}>
                      {b.heading}
                    </div>
                    <div style={{ borderTop: `1px solid ${NAVY}`, paddingTop: 6 }}>
                      {b.l1}
                    </div>
                    <div style={{ color: MUTED }}>{b.l2}</div>
                  </div>
                ))}
              </div>

              {/* Closing */}
              <p style={{ fontSize: 12, marginBottom: 14 }}>
                We look forward to the opportunity of working with you and remain
                available for any technical or commercial clarifications.
              </p>
              <div style={{ fontSize: 12 }}>
                <div>Warm regards,</div>
                <div style={{ fontWeight: 700, marginTop: 2 }}>{preparedBy}</div>
                <div>{COMPANY.legalEntityName}</div>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
