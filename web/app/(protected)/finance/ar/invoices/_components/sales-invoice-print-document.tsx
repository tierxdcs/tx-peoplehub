'use client';

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { amountToIndianWords } from '../../../../../lib/indian-number-words';
import { formatINR } from '../../../../../lib/sales';
import { COMPANY } from '../../../../../lib/theme';

const NAVY = '#16283b';
const ACCENT = '#e0a83d';
const RULE = '#dfe3e8';
const MUTED = '#6b7280';

interface PrintLine {
  id: string;
  description: string;
  hsnSacCode: string;
  quantity: string;
  unitOfMeasure: string;
  unitPrice: string;
  discountPercent: string;
  taxableAmount: string;
  lineTotal: string;
  product: { name: string; sku: string } | null;
}

/**
 * The supplier's registered identity, from the Statutory Config the Finance
 * Head maintains. CGST Rule 46(a)-(b) requires all three on the face of a tax
 * invoice, and this is the same record that goes to the IRP.
 */
export interface PrintableSupplier {
  legalName: string;
  gstin: string;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  state: string;
  stateCode: string;
  postalCode: string;
}

interface PrintableSalesInvoice {
  supplier: PrintableSupplier | null;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  customerPoReference: string | null;
  customerGstinSnapshot: string | null;
  placeOfSupplyState: string;
  placeOfSupplyStateCode: string;
  billingAddressSnapshot: unknown;
  shippingAddressSnapshot: unknown;
  subtotal: string;
  discountAmount: string;
  taxableAmount: string;
  cgstAmount: string;
  sgstAmount: string;
  igstAmount: string;
  otherCharges: string;
  roundOff: string;
  totalAmount: string;
  paymentTerms: string | null;
  irn: string | null;
  irnAcknowledgementNumber: string | null;
  irnAcknowledgementDate: string | null;
  signedQrCode: string | null;
  eWayBillNumber: string | null;
  customer: { name: string };
  order: { orderNumber: string } | null;
  lines: PrintLine[];
  approvedBy: { firstName: string; lastName: string } | null;
}

function addressText(value: unknown): string {
  if (!value) return '—';
  if (typeof value === 'string') return value;
  if (typeof value !== 'object') return String(value);
  return (
    Object.values(value as Record<string, unknown>)
      .filter((part) => part != null && String(part).trim())
      .map(String)
      .join(', ') || '—'
  );
}

function dateOnly(value: string): string {
  return value.slice(0, 10);
}

export function supplierAddressText(supplier: PrintableSupplier): string {
  return [
    supplier.addressLine1,
    supplier.addressLine2,
    supplier.city,
    supplier.state,
    supplier.postalCode,
  ]
    .filter((part) => part && part.trim())
    .join(', ');
}

function Kicker({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        alignItems: 'center',
        color: NAVY,
        display: 'flex',
        fontSize: 10,
        fontWeight: 700,
        gap: 6,
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
      }}
    >
      <span
        style={{
          background: ACCENT,
          display: 'inline-block',
          height: 8,
          width: 8,
        }}
      />
      {children}
    </div>
  );
}

function PageHeader() {
  return (
    <div>
      <div
        style={{
          alignItems: 'flex-start',
          display: 'flex',
          justifyContent: 'space-between',
          paddingBottom: 10,
        }}
      >
        {COMPANY.logoPath ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            alt={`${COMPANY.name} logo`}
            src={COMPANY.logoPath}
            style={{ height: 52, objectFit: 'contain', width: 'auto' }}
          />
        ) : (
          <span style={{ fontSize: 22, fontWeight: 800 }}>{COMPANY.name}</span>
        )}
        <div style={{ color: MUTED, fontSize: 11, textAlign: 'right' }}>
          <Kicker>Get in touch</Kicker>
          <div style={{ marginTop: 3 }}>{COMPANY.contactEmail}</div>
          <div>{COMPANY.website}</div>
        </div>
      </div>
      <div style={{ borderTop: `2px solid ${NAVY}`, position: 'relative' }}>
        <div
          style={{
            borderTop: `2px solid ${ACCENT}`,
            left: 0,
            position: 'absolute',
            top: -2,
            width: '14%',
          }}
        />
      </div>
    </div>
  );
}

function PageFooter() {
  return (
    <div style={{ paddingTop: 8 }}>
      <div
        style={{
          borderTop: `2px solid ${NAVY}`,
          marginBottom: 8,
          position: 'relative',
        }}
      >
        <div
          style={{
            borderTop: `2px solid ${ACCENT}`,
            position: 'absolute',
            right: 0,
            top: -2,
            width: '18%',
          }}
        />
      </div>
      <div
        style={{ display: 'flex', gap: 24, justifyContent: 'space-between' }}
      >
        <div style={{ color: MUTED, fontSize: 9, maxWidth: '55%' }}>
          <div
            style={{
              color: NAVY,
              fontWeight: 700,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
            }}
          >
            {COMPANY.manufacturingCenter.label}
          </div>
          {COMPANY.manufacturingCenter.lines.map((line) => (
            <div key={line}>{line}</div>
          ))}
        </div>
        <div style={{ color: MUTED, fontSize: 9, textAlign: 'right' }}>
          <div
            style={{
              color: NAVY,
              fontWeight: 700,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
            }}
          >
            {COMPANY.headquarters.label}
          </div>
          {COMPANY.headquarters.lines.map((line) => (
            <div key={line}>{line}</div>
          ))}
        </div>
      </div>
      <div
        style={{ color: MUTED, fontSize: 8, marginTop: 6, textAlign: 'center' }}
      >
        {COMPANY.confidentialityLine}
      </div>
    </div>
  );
}

export function SalesInvoicePrintDocument({
  invoice,
  generatedOn,
}: {
  invoice: PrintableSalesInvoice;
  generatedOn: string;
}) {
  const [qrImage, setQrImage] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    const value = invoice.signedQrCode;
    if (!value) {
      setQrImage(null);
      return () => {
        active = false;
      };
    }
    if (value.startsWith('data:image/')) {
      setQrImage(value);
      return () => {
        active = false;
      };
    }
    QRCode.toDataURL(value, {
      errorCorrectionLevel: 'M',
      margin: 0,
      width: 144,
    })
      .then((dataUrl) => active && setQrImage(dataUrl))
      .catch(() => active && setQrImage(null));
    return () => {
      active = false;
    };
  }, [invoice.signedQrCode]);
  const th: React.CSSProperties = {
    color: '#fff',
    fontSize: 9.5,
    fontWeight: 700,
    padding: '8px 6px',
    textAlign: 'left',
  };
  const td: React.CSSProperties = {
    borderBottom: `1px solid ${RULE}`,
    fontSize: 10,
    overflowWrap: 'break-word',
    padding: '8px 6px',
    verticalAlign: 'top',
  };
  const right = {
    ...td,
    textAlign: 'right' as const,
    whiteSpace: 'nowrap' as const,
  };
  const summaryRows = [
    ['Subtotal', invoice.subtotal],
    ['Discount', invoice.discountAmount],
    ['Taxable amount', invoice.taxableAmount],
    ['CGST', invoice.cgstAmount],
    ['SGST', invoice.sgstAmount],
    ['IGST', invoice.igstAmount],
    ['Other charges', invoice.otherCharges],
    ['Round off', invoice.roundOff],
  ].filter(([, value], index) => index < 3 || Number(value) !== 0);

  return (
    <div
      className="print-document"
      style={{ background: '#fff', color: '#111', lineHeight: 1.5 }}
    >
      <table style={{ borderCollapse: 'collapse', width: '100%' }}>
        <thead className="print-running-head">
          <tr>
            <td style={{ padding: 0 }}>
              <PageHeader />
            </td>
          </tr>
        </thead>
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
              <div
                style={{
                  alignItems: 'flex-start',
                  display: 'flex',
                  justifyContent: 'space-between',
                  marginBottom: 24,
                }}
              >
                <div>
                  <Kicker>Finance &amp; Accounts</Kicker>
                  <div
                    style={{
                      color: NAVY,
                      fontSize: 24,
                      fontWeight: 800,
                      marginTop: 8,
                    }}
                  >
                    TAX INVOICE
                  </div>
                  {/* Supplier identity on the face of the invoice — Rule 46
                      requires the name, address and GSTIN of the supplier, and
                      the customer's AP team needs the GSTIN to claim ITC. */}
                  {invoice.supplier && (
                    <div
                      style={{
                        color: '#333',
                        fontSize: 10.5,
                        marginTop: 10,
                        maxWidth: 300,
                      }}
                    >
                      <div style={{ fontWeight: 700 }}>
                        {invoice.supplier.legalName}
                      </div>
                      <div style={{ marginTop: 2 }}>
                        {supplierAddressText(invoice.supplier)}
                      </div>
                      <div
                        style={{ color: NAVY, fontWeight: 700, marginTop: 3 }}
                      >
                        GSTIN: {invoice.supplier.gstin}
                      </div>
                    </div>
                  )}
                </div>
                <table
                  style={{
                    borderCollapse: 'collapse',
                    fontSize: 11,
                    marginLeft: 'auto',
                    width: 270,
                  }}
                >
                  <tbody>
                    {[
                      ['Invoice No.', invoice.invoiceNumber],
                      ['Invoice Date', dateOnly(invoice.invoiceDate)],
                      ['Due Date', dateOnly(invoice.dueDate)],
                      ['Order Ref.', invoice.order?.orderNumber ?? '—'],
                      ['Customer PO', invoice.customerPoReference ?? '—'],
                    ].map(([label, value]) => (
                      <tr key={label}>
                        <td style={{ color: MUTED, padding: '2px 12px 2px 0' }}>
                          {label}
                        </td>
                        <td
                          style={{
                            color: NAVY,
                            fontWeight: 700,
                            padding: '2px 0',
                            textAlign: 'right',
                          }}
                        >
                          {value}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div
                className="print-avoid-break"
                style={{ display: 'flex', gap: 36, marginBottom: 24 }}
              >
                <div style={{ flex: 1 }}>
                  <Kicker>Bill to</Kicker>
                  <div style={{ fontSize: 12, fontWeight: 700, marginTop: 7 }}>
                    {invoice.customer.name}
                  </div>
                  <div style={{ color: '#333', fontSize: 10.5, marginTop: 3 }}>
                    {addressText(invoice.billingAddressSnapshot)}
                  </div>
                  <div style={{ color: '#333', fontSize: 10.5, marginTop: 3 }}>
                    GSTIN: {invoice.customerGstinSnapshot || '—'}
                  </div>
                </div>
                <div style={{ flex: 1 }}>
                  <Kicker>Ship to</Kicker>
                  <div style={{ color: '#333', fontSize: 10.5, marginTop: 7 }}>
                    {addressText(invoice.shippingAddressSnapshot)}
                  </div>
                  <div style={{ color: '#333', fontSize: 10.5, marginTop: 3 }}>
                    Place of supply: {invoice.placeOfSupplyState} (
                    {invoice.placeOfSupplyStateCode})
                  </div>
                </div>
              </div>

              <Kicker>Invoice details</Kicker>
              <table
                style={{
                  borderCollapse: 'collapse',
                  marginTop: 10,
                  tableLayout: 'fixed',
                  width: '100%',
                }}
              >
                <thead>
                  <tr style={{ background: NAVY }}>
                    <th style={{ ...th, width: '5%' }}>Sl.</th>
                    <th style={th}>Description</th>
                    <th style={{ ...th, width: '12%' }}>HSN/SAC</th>
                    <th style={{ ...th, textAlign: 'right', width: '10%' }}>
                      Qty
                    </th>
                    <th style={{ ...th, textAlign: 'right', width: '14%' }}>
                      Rate (INR)
                    </th>
                    <th style={{ ...th, textAlign: 'right', width: '10%' }}>
                      Disc.
                    </th>
                    <th style={{ ...th, textAlign: 'right', width: '16%' }}>
                      Taxable (INR)
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {invoice.lines.map((line, index) => (
                    <tr
                      className="print-avoid-break"
                      key={line.id}
                      style={{ background: index % 2 ? '#f6f8fa' : '#fff' }}
                    >
                      <td style={td}>{index + 1}</td>
                      <td style={td}>
                        {/* pre-line: the customer-facing description sits on
                            its own line under the name in the saved text. */}
                        <div
                          style={{ fontWeight: 600, whiteSpace: 'pre-line' }}
                        >
                          {line.description}
                        </div>
                        {/* This prints on the customer's tax invoice: when the
                            preparer wrote customer-facing wording (it differs
                            from the Product Master name), keep the internal
                            name off the document and print the SKU alone. */}
                        {line.product && (
                          <div style={{ color: MUTED, marginTop: 2 }}>
                            {line.description === line.product.name
                              ? `${line.product.sku} · ${line.product.name}`
                              : line.product.sku}
                          </div>
                        )}
                      </td>
                      <td style={td}>{line.hsnSacCode}</td>
                      <td style={right}>
                        {line.quantity} {line.unitOfMeasure}
                      </td>
                      <td style={right}>{formatINR(line.unitPrice)}</td>
                      <td style={right}>
                        {Number(line.discountPercent)
                          ? `${line.discountPercent}%`
                          : '—'}
                      </td>
                      <td style={right}>{formatINR(line.taxableAmount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div
                className="print-avoid-break"
                style={{
                  display: 'flex',
                  gap: 36,
                  justifyContent: 'space-between',
                  marginTop: 16,
                }}
              >
                <div style={{ flex: 1, fontSize: 10.5 }}>
                  <div style={{ color: MUTED }}>Amount in words</div>
                  <div style={{ fontWeight: 600, marginTop: 3 }}>
                    {amountToIndianWords(invoice.totalAmount)}
                  </div>
                  {invoice.paymentTerms && (
                    <div style={{ marginTop: 18 }}>
                      <div style={{ color: MUTED }}>Payment terms</div>
                      <div style={{ marginTop: 3, whiteSpace: 'pre-wrap' }}>
                        {invoice.paymentTerms}
                      </div>
                    </div>
                  )}
                  <div className="print-avoid-break" style={{ marginTop: 18 }}>
                    <div style={{ color: NAVY, fontWeight: 700 }}>
                      Company&apos;s Bank Details
                    </div>
                    <table style={{ borderCollapse: 'collapse', marginTop: 3 }}>
                      <tbody>
                        {[
                          [
                            "A/c Holder's Name",
                            COMPANY.bankDetails.accountHolderName,
                          ],
                          ['Bank Name', COMPANY.bankDetails.bankName],
                          ['A/c No.', COMPANY.bankDetails.accountNumber],
                          [
                            'Branch & IFS Code',
                            `${COMPANY.bankDetails.branch} & ${COMPANY.bankDetails.ifscCode}`,
                          ],
                        ].map(([label, value]) => (
                          <tr key={label}>
                            <td style={{ padding: '0 8px 0 0' }}>{label}</td>
                            <td style={{ padding: '0 8px 0 0' }}>:</td>
                            <td style={{ fontWeight: 700 }}>{value}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {(invoice.irn || invoice.eWayBillNumber) && (
                    <div
                      className="print-avoid-break"
                      style={{ color: MUTED, marginTop: 18 }}
                    >
                      {qrImage && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          alt="GST e-invoice signed QR code"
                          src={qrImage}
                          style={{ height: 112, marginBottom: 8, width: 112 }}
                        />
                      )}
                      {invoice.irn && (
                        <div style={{ overflowWrap: 'anywhere' }}>
                          IRN: {invoice.irn}
                        </div>
                      )}
                      {invoice.irnAcknowledgementNumber && (
                        <div>Ack No.: {invoice.irnAcknowledgementNumber}</div>
                      )}
                      {invoice.irnAcknowledgementDate && (
                        <div>
                          Ack Date:{' '}
                          {new Date(
                            invoice.irnAcknowledgementDate,
                          ).toLocaleString('en-IN')}
                        </div>
                      )}
                      {invoice.eWayBillNumber && (
                        <div>E-way bill: {invoice.eWayBillNumber}</div>
                      )}
                    </div>
                  )}
                </div>
                <table
                  style={{
                    borderCollapse: 'collapse',
                    fontSize: 10.5,
                    width: 300,
                  }}
                >
                  <tbody>
                    {summaryRows.map(([label, value]) => (
                      <tr key={label}>
                        <td
                          style={{
                            borderBottom: `1px solid ${RULE}`,
                            color: MUTED,
                            padding: '5px 8px',
                          }}
                        >
                          {label}
                        </td>
                        <td
                          style={{
                            borderBottom: `1px solid ${RULE}`,
                            padding: '5px 8px',
                            textAlign: 'right',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {formatINR(value)}
                        </td>
                      </tr>
                    ))}
                    <tr style={{ background: '#eef1f4' }}>
                      <td
                        style={{
                          color: NAVY,
                          fontSize: 11,
                          fontWeight: 800,
                          padding: '8px',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        GRAND TOTAL (INR)
                      </td>
                      <td
                        style={{
                          color: NAVY,
                          fontSize: 12,
                          fontWeight: 800,
                          padding: '8px',
                          textAlign: 'right',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {formatINR(invoice.totalAmount)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div
                className="print-avoid-break"
                style={{ display: 'flex', gap: 48, marginTop: 54 }}
              >
                <div style={{ flex: 1, fontSize: 10.5 }}>
                  <div style={{ fontWeight: 700, marginBottom: 38 }}>
                    Customer acknowledgement
                  </div>
                  <div
                    style={{ borderTop: `1px solid ${NAVY}`, paddingTop: 6 }}
                  >
                    Signature, name &amp; date
                  </div>
                </div>
                <div style={{ flex: 1, fontSize: 10.5 }}>
                  <div
                    style={{ color: NAVY, fontWeight: 700, marginBottom: 38 }}
                  >
                    {/* The statutory record wins over the letterhead constant,
                        so the signature block and the GSTIN block above can
                        never name two different legal entities. */}
                    For {invoice.supplier?.legalName ?? COMPANY.legalEntityName}
                  </div>
                  <div
                    style={{ borderTop: `1px solid ${NAVY}`, paddingTop: 6 }}
                  >
                    Authorised Signatory
                  </div>
                  {invoice.approvedBy && (
                    <div style={{ color: MUTED }}>
                      {invoice.approvedBy.firstName}{' '}
                      {invoice.approvedBy.lastName}
                    </div>
                  )}
                </div>
              </div>

              <div style={{ color: MUTED, fontSize: 9, marginTop: 26 }}>
                System generated on {generatedOn}. This document is valid
                subject to approval and applicable statutory requirements.
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
