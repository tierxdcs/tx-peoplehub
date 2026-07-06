import { Bid, Customer } from '../../../lib/types';
import { COMPANY } from '../../../lib/theme';
import { formatINR, prettyEnum } from '../../../lib/sales';

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

/**
 * Print-only Bid proposal document. Hidden on screen (`.print-document`);
 * revealed by the @media print rules in globals.css when the user does
 * Save-as-PDF. Deliberately NOT the on-screen layout — this is the
 * external-facing document: company letterhead, recipient block, clean
 * table, summary, footer. No app chrome, no status badge (internal pipeline
 * status isn't the customer's concern), no action buttons.
 */
export function BidPrintDocument({
  bid,
  customer,
  generatedOn,
}: {
  bid: Bid;
  customer: Customer | null;
  /** Pre-formatted YYYY-MM-DD; passed in so render stays deterministic. */
  generatedOn: string;
}) {
  const primaryContact =
    customer?.contacts?.find((c) => c.isPrimary) ?? customer?.contacts?.[0];
  const custAddress = addressLines(customer?.billingAddress);

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
        <div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>{COMPANY.name}</div>
          {COMPANY.addressLines.map((line, i) => (
            <div key={i} style={{ fontSize: 11, color: '#333' }}>
              {line}
            </div>
          ))}
          {COMPANY.contact && (
            <div style={{ fontSize: 11, color: '#333', marginTop: 2 }}>
              {COMPANY.contact}
            </div>
          )}
          {COMPANY.gstin && (
            <div style={{ fontSize: 11, color: '#333' }}>
              GSTIN: {COMPANY.gstin}
            </div>
          )}
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 20, fontWeight: 700 }}>Bid Proposal</div>
          <div style={{ fontSize: 12, marginTop: 4 }}>{bid.bidNumber}</div>
          <div style={{ fontSize: 11, color: '#333' }}>
            Date: {generatedOn}
          </div>
        </div>
      </div>

      {/* Recipient block */}
      <div style={{ marginBottom: 20 }}>
        <div
          style={{
            fontSize: 10,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            color: '#666',
            marginBottom: 4,
          }}
        >
          Prepared for
        </div>
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

      {/* Bid meta */}
      <table style={{ width: '100%', marginBottom: 16, fontSize: 11 }}>
        <tbody>
          <tr>
            <td style={{ color: '#666', paddingRight: 8, width: 120 }}>
              Valid until
            </td>
            <td style={{ fontWeight: 600 }}>{bid.validUntil.slice(0, 10)}</td>
          </tr>
          {bid.tenderReferenceNumber && (
            <tr>
              <td style={{ color: '#666', paddingRight: 8 }}>
                Tender reference
              </td>
              <td style={{ fontWeight: 600 }}>{bid.tenderReferenceNumber}</td>
            </tr>
          )}
        </tbody>
      </table>

      {/* Technical specification */}
      {bid.technicalSpecification && (
        <div style={{ marginBottom: 16 }}>
          <div
            style={{
              fontSize: 10,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              color: '#666',
              marginBottom: 4,
            }}
          >
            Technical specification
          </div>
          <div style={{ fontSize: 11, whiteSpace: 'pre-wrap' }}>
            {bid.technicalSpecification}
          </div>
        </div>
      )}

      {/* Line items */}
      <table
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          fontSize: 11,
          marginBottom: 16,
        }}
      >
        <thead>
          <tr style={{ borderBottom: '1px solid #000' }}>
            <th style={{ textAlign: 'left', padding: '6px 4px' }}>Product</th>
            <th style={{ textAlign: 'right', padding: '6px 4px' }}>Qty</th>
            <th style={{ textAlign: 'right', padding: '6px 4px' }}>
              Unit Price
            </th>
            <th style={{ textAlign: 'right', padding: '6px 4px' }}>Disc %</th>
            <th style={{ textAlign: 'right', padding: '6px 4px' }}>
              Line Total
            </th>
          </tr>
        </thead>
        <tbody>
          {(bid.lineItems ?? []).map((li) => (
            <tr
              key={li.id}
              className="print-avoid-break"
              style={{ borderBottom: '1px solid #ddd' }}
            >
              <td style={{ padding: '6px 4px' }}>
                <div style={{ fontWeight: 600 }}>{li.productName}</div>
                <div style={{ fontSize: 10, color: '#666' }}>
                  SKU: {li.productSku}
                </div>
              </td>
              <td style={{ textAlign: 'right', padding: '6px 4px' }}>
                {li.quantity}
              </td>
              <td style={{ textAlign: 'right', padding: '6px 4px' }}>
                {formatINR(li.unitPrice)}
              </td>
              <td style={{ textAlign: 'right', padding: '6px 4px' }}>
                {li.lineDiscountPercent ?? '—'}
              </td>
              <td style={{ textAlign: 'right', padding: '6px 4px' }}>
                {formatINR(li.lineTotal)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Summary — right-aligned */}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <table style={{ fontSize: 11, minWidth: 260 }}>
          <tbody>
            <tr>
              <td style={{ color: '#666', paddingRight: 16 }}>Subtotal</td>
              <td style={{ textAlign: 'right' }}>{formatINR(bid.subtotal)}</td>
            </tr>
            <tr>
              <td style={{ color: '#666', paddingRight: 16 }}>
                Discount ({bid.discountPercent}%)
              </td>
              <td style={{ textAlign: 'right' }}>
                −{formatINR(bid.discountAmount)}
              </td>
            </tr>
            <tr>
              <td style={{ color: '#666', paddingRight: 16 }}>
                Tax
                {bid.taxType
                  ? ` (${prettyEnum(bid.taxType)} ${bid.taxRate}%)`
                  : ''}
              </td>
              <td style={{ textAlign: 'right' }}>{formatINR(bid.taxAmount)}</td>
            </tr>
            <tr style={{ borderTop: '1px solid #000' }}>
              <td style={{ fontWeight: 700, paddingTop: 4 }}>Total</td>
              <td
                style={{
                  textAlign: 'right',
                  fontWeight: 700,
                  fontSize: 13,
                  paddingTop: 4,
                }}
              >
                {formatINR(bid.totalAmount)}
              </td>
            </tr>
          </tbody>
        </table>
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
