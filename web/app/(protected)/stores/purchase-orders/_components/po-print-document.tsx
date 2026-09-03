import { COMPANY } from '../../../../lib/theme';
import { formatINR } from '../../../../lib/sales';
import { amountToIndianWords } from '../../../../lib/indian-number-words';
import { dateOnlyStr } from '../../../../lib/date';
import type { PurchaseOrder } from '../../../../lib/stores';

/** Palette — shared with the Techno-Commercial Proposal for a consistent look. */
const NAVY = '#16283b';
const ACCENT = '#e0a83d';
const RULE = '#dfe3e8';
const MUTED = '#6b7280';

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
       * every page as part of the running header. The base line is a solid
       * navy BORDER (prints even when "Background graphics" is off); the amber
       * segment sits on top. */}
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
 * Print-only "Purchase Order" document — the supplier-facing PO to send to the
 * vendor. Hidden on screen (`.print-document`); revealed by @media print in
 * globals.css on Save-as-PDF (see the Bid TCP for the same mechanism).
 *
 * Layout uses a single outer <table> so the header (<thead>) and footer
 * (<tfoot>) REPEAT on every printed page, with body content in one <tbody>
 * cell — the standard, reliable way to get running headers/footers in browser
 * print (no PDF library).
 */
export function PurchaseOrderPrintDocument({
  po,
  generatedOn,
}: {
  po: PurchaseOrder;
  /** Pre-formatted YYYY-MM-DD; passed in so render stays deterministic. */
  generatedOn: string;
}) {
  const supplierName = po.supplierName ?? po.vendorName ?? po.adHocPartyName ?? '—';
  const supplierKind = po.supplierId ? 'Supplier' : po.vendorId ? 'Vendor' : 'Ad-hoc Party';
  const lines = po.lines ?? [];

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
  const tdR: React.CSSProperties = {
    ...td,
    textAlign: 'right',
    whiteSpace: 'nowrap',
  };

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
              {/* Title + PO metadata */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  marginBottom: 26,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Kicker>Procurement</Kicker>
                  <div
                    style={{
                      fontSize: 22,
                      fontWeight: 800,
                      color: NAVY,
                      letterSpacing: '-0.01em',
                      marginTop: 8,
                    }}
                  >
                    PURCHASE ORDER
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
                      <td style={{ color: MUTED, paddingRight: 14 }}>PO No.</td>
                      <td
                        style={{
                          fontWeight: 700,
                          color: NAVY,
                          textAlign: 'right',
                        }}
                      >
                        {po.poNumber}
                      </td>
                    </tr>
                    <tr>
                      <td style={{ color: MUTED, paddingRight: 14, paddingTop: 4 }}>
                        Order Date
                      </td>
                      <td
                        style={{
                          fontWeight: 700,
                          paddingTop: 4,
                          textAlign: 'right',
                        }}
                      >
                        {dateOnlyStr(po.orderDate)}
                      </td>
                    </tr>
                    <tr>
                      <td style={{ color: MUTED, paddingRight: 14, paddingTop: 4 }}>
                        Expected Delivery
                      </td>
                      <td
                        style={{
                          fontWeight: 700,
                          paddingTop: 4,
                          textAlign: 'right',
                        }}
                      >
                        {po.expectedDeliveryDate
                          ? dateOnlyStr(po.expectedDeliveryDate)
                          : '—'}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Vendor (addressee) / Ship To (us) */}
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
                    {supplierKind}
                  </div>
                  <div style={{ fontWeight: 700 }}>M/s. {supplierName}</div>
                  {po.adHocContactInfo && (
                    <div style={{ marginTop: 3, color: '#333', whiteSpace: 'pre-line' }}>
                      {po.adHocContactInfo}
                    </div>
                  )}
                  {po.adHocPartyAddress && (
                    <div style={{ marginTop: 3, color: '#333', whiteSpace: 'pre-line' }}>
                      {po.adHocPartyAddress}
                    </div>
                  )}
                </div>
                <div style={{ fontSize: 12, textAlign: 'right' }}>
                  <div style={{ color: ACCENT, fontWeight: 700, fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 6 }}>
                    Ship To
                  </div>
                  <div style={{ fontWeight: 700 }}>{COMPANY.legalEntityName}</div>
                  {COMPANY.manufacturingCenter.lines.map((l, i) => (
                    <div key={i} style={{ color: '#333' }}>
                      {l}
                    </div>
                  ))}
                </div>
              </div>

              {/* Opening line */}
              <p style={{ fontSize: 12, marginBottom: 24 }}>
                Dear Sir/Madam, please supply the following goods in accordance
                with the terms and conditions of this purchase order.
              </p>

              {/* Line-item table */}
              <Kicker>Order Details</Kicker>
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
                    <th style={{ ...th, width: '16%' }}>Item Code</th>
                    <th style={th}>Description</th>
                    <th style={{ ...thR, width: '8%' }}>Qty</th>
                    <th style={{ ...th, width: '9%' }}>Units</th>
                    <th style={{ ...thR, width: '14%' }}>Unit Price (INR)</th>
                    <th style={{ ...thR, width: '16%' }}>Total (INR)</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line, i) => (
                    <tr
                      key={line.id}
                      className="print-avoid-break"
                      style={{ background: i % 2 ? '#f6f8fa' : '#fff' }}
                    >
                      <td style={td}>{i + 1}</td>
                      <td style={td}>{line.itemCode ?? '—'}</td>
                      <td style={td}>
                        <span style={{ fontWeight: 600 }}>{line.itemName}</span>
                        {line.adHocDescription && (
                          <div style={{ color: MUTED, marginTop: 2 }}>
                            {line.adHocDescription}
                          </div>
                        )}
                        {line.notes && (
                          <div style={{ color: MUTED, marginTop: 2 }}>
                            {line.notes}
                          </div>
                        )}
                      </td>
                      <td style={tdR}>{line.orderedQuantity}</td>
                      <td style={td}>{line.unitOfMeasure}</td>
                      <td style={tdR}>{formatINR(line.unitPrice)}</td>
                      <td style={tdR}>{formatINR(line.lineTotal)}</td>
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
                        whiteSpace: 'nowrap',
                      }}
                    >
                      TOTAL VALUE (INR)
                    </td>
                    <td
                      style={{
                        padding: '9px 8px',
                        textAlign: 'right',
                        fontWeight: 800,
                        color: NAVY,
                        fontSize: 12,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {formatINR(po.totalAmount)}
                    </td>
                  </tr>
                </tbody>
              </table>

              {/* Amount in words + tax caption */}
              <p style={{ fontSize: 10.5, color: MUTED, marginBottom: 24 }}>
                Amount in words: {amountToIndianWords(po.totalAmount)}. Prices
                are exclusive of applicable taxes and duties unless stated
                otherwise.
              </p>

              {/* Advance payment terms — must match the server-rendered PDF in
                  purchase-order-document.ts. Prefers the snapshot frozen at
                  issue so the party reads the same figure Accounts was asked
                  for. */}
              {po.advance && (
                <div
                  style={{
                    borderLeft: `3px solid ${ACCENT}`,
                    padding: '8px 0 8px 10px',
                    marginBottom: 24,
                    fontSize: 11.5,
                    color: '#111',
                  }}
                >
                  <span style={{ fontWeight: 700, color: NAVY }}>
                    Payment terms — advance:
                  </span>{' '}
                  {po.advance.percent}% of the order value,{' '}
                  {formatINR(po.advance.amount ?? po.advance.indicativeAmount)}{' '}
                  (exclusive of taxes), payable against this purchase order
                  before delivery. The balance is payable against your tax
                  invoice on receipt and acceptance of the goods.
                </div>
              )}

              {/* PO notes, if any */}
              {po.notes && (
                <div style={{ marginBottom: 24 }}>
                  <Kicker>Notes</Kicker>
                  <p style={{ fontSize: 11, color: '#333', marginTop: 10 }}>
                    {po.notes}
                  </p>
                </div>
              )}

              {/* Signature block — blank print lines, no data binding */}
              <div
                className="print-avoid-break"
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 48,
                  marginBottom: 28,
                  marginTop: 8,
                }}
              >
                {[
                  {
                    heading: `For ${COMPANY.name}`,
                    l1: 'Authorised Signatory',
                    l2: po.createdByName
                      ? `Raised by ${po.createdByName}`
                      : 'Name & Designation',
                  },
                  {
                    heading: 'Supplier Acknowledgement',
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
              <div style={{ fontSize: 11, color: MUTED }}>
                This purchase order was generated on {generatedOn} by{' '}
                {COMPANY.legalEntityName}.
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
