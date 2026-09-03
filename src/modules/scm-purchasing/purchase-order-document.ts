import { escapeHtml } from '../../core/email/email-content';
import {
  LETTERHEAD,
  LETTERHEAD_LOGO_FILENAME,
} from '../../core/documents/letterhead';
import {
  amountToIndianWords,
  formatIndianAmount,
  trimDecimal,
} from '../../common/utils/indian-money.util';
import { PURCHASE_ORDER_TERMS } from './purchase-order-terms';

/**
 * Server-side HTML for the supplier-facing Purchase Order, rendered to PDF by
 * PdfService (Gotenberg/Chromium) and attached to the "Email to Supplier" send.
 *
 * ── Keep in step with the browser-print twin ──
 * web/app/(protected)/stores/purchase-orders/_components/po-print-document.tsx
 * renders the same document for Save-as-PDF from the detail page. Same palette,
 * same section order, same wording, and the same outer-table trick for running
 * headers/footers. They are separate files because the two halves of the app are
 * deployed separately and share no bundle — a layout change is two edits.
 *
 * A pure function over a plain snapshot: no Prisma, no Nest, so the layout is
 * unit-testable and the email service owns all the I/O (same shape as
 * rfq-quote-pdf.ts).
 */

/** Palette — shared with the Techno-Commercial Proposal for a consistent look. */
const NAVY = '#16283b';
const ACCENT = '#e0a83d';
const RULE = '#dfe3e8';
const MUTED = '#6b7280';

export interface PurchaseOrderDocumentLine {
  itemCode: string | null;
  itemName: string;
  adHocDescription: string | null;
  notes: string | null;
  /** Decimal strings, exactly as the entity serializes them. */
  orderedQuantity: string;
  unitOfMeasure: string;
  unitPrice: string;
  lineTotal: string;
}

export interface PurchaseOrderDocumentData {
  poNumber: string;
  orderDate: Date;
  expectedDeliveryDate: Date | null;
  partyKind: 'Supplier' | 'Vendor' | 'Ad-hoc Party';
  partyName: string;
  /** Free-text contact/address block, shown for an ad-hoc party. */
  partyContactInfo: string | null;
  partyAddress: string | null;
  /** GST registration from the Vendor/Supplier master. */
  partyGstin?: string | null;
  notes: string | null;
  raisedByName: string | null;
  /** Sum of the line totals — the taxable value, before GST. */
  totalAmount: string;
  /**
   * GST on the order, as decimal strings. Zero rates mean the order carries no
   * tax line and the summary collapses back to a single total, which is how every
   * order raised before GST was added to the PO prints.
   */
  gst: {
    stateName: string;
    igstRate: string;
    cgstRate: string;
    sgstRate: string;
    igstAmount: string;
    cgstAmount: string;
    sgstAmount: string;
    totalTax: string;
  };
  /** totalAmount + GST — the figure the party will invoice for. */
  grandTotal: string;
  /**
   * The advance the buyer commits to paying before delivery. Null when the order
   * carries none. It is printed because this document is where the commitment is
   * made to the party — a percentage agreed only in the ERP is not a term of the
   * order. Both figures are pre-tax, matching `totalAmount`.
   */
  advance: { percent: string; amount: string } | null;
  lines: PurchaseOrderDocumentLine[];
  /**
   * Buyer identity from FinanceCompanySettings — authoritative for the legal
   * name and GSTIN, which a supplier needs to raise a compliant invoice.
   */
  buyer: { legalName: string; gstin: string | null };
  /** Injected so the same PO always renders the same bytes in a test. */
  generatedOn: Date;
  /** Whether the logo asset is being uploaded alongside this HTML. */
  hasLogo: boolean;
}

/** ISO `YYYY-MM-DD` — the same rendering `dateOnlyStr` gives the printed twin. */
function day(date: Date | null): string {
  return date ? date.toISOString().slice(0, 10) : '—';
}

/**
 * Filename for the attachment: `PO-2026-0001_Acme-Precision.pdf`. PO number
 * first so a supplier's mailbox sorts by order, party second so it is obvious at
 * a glance the file is theirs and not a mis-send.
 */
export function purchaseOrderPdfFileName(
  poNumber: string,
  partyName: string,
): string {
  return `${slug(poNumber)}_${slug(partyName)}.pdf`;
}

/** Filename-safe token: punctuation and runs of whitespace collapse to hyphens. */
function slug(value: string): string {
  const cleaned = value
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  // A party named entirely in non-Latin characters would slug to nothing; the
  // name must never collapse the filename to `PO-2026-0001_.pdf`.
  return cleaned || 'Unnamed';
}

/**
 * Chromium's footer template, drawn in the bottom margin of every page. Chromium
 * ignores the `@bottom-right` margin box the browser-print stylesheet uses, so
 * the emailed PDF is actually the only one of the two that gets page numbers.
 * Explicit font-size is required: the default inside these templates is ~7pt of
 * unstyled text.
 */
export function purchaseOrderFooterHtml(): string {
  return [
    '<html><head><style>body{margin:0;}</style></head><body>',
    `<div style="width:100%;padding:0 14mm;box-sizing:border-box;text-align:right;font-size:9px;color:${MUTED};font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">`,
    'Page <span class="pageNumber"></span> of <span class="totalPages"></span>',
    '</div></body></html>',
  ].join('');
}

/** A small uppercase kicker/label with the amber square. */
function kicker(label: string): string {
  return (
    `<div style="font-size:10px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:${NAVY};">` +
    `<span style="display:inline-block;width:8px;height:8px;background:${ACCENT};margin-right:6px;"></span>` +
    `${escapeHtml(label)}</div>`
  );
}

/** Multi-line free text (contact blocks, notes) with line breaks preserved. */
function multiline(value: string): string {
  return escapeHtml(value).replace(/\r?\n/g, '<br />');
}

function addressBlock(
  label: string,
  lines: readonly string[],
  align: 'left' | 'right',
): string {
  return (
    `<td style="font-size:9px;color:${MUTED};text-align:${align};vertical-align:top;width:50%;">` +
    `<div style="font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${NAVY};">${escapeHtml(label)}</div>` +
    lines.map((l) => `<div>${escapeHtml(l)}</div>`).join('') +
    '</td>'
  );
}

/** The repeating page header: logo/wordmark left, "Get in touch" right. */
function pageHeader(hasLogo: boolean): string {
  const mark = hasLogo
    ? `<img src="${LETTERHEAD_LOGO_FILENAME}" alt="${escapeHtml(LETTERHEAD.name)}" style="height:52px;width:auto;" />`
    : `<span style="font-size:22px;font-weight:800;">${escapeHtml(LETTERHEAD.name)}</span>`;
  return [
    '<table style="width:100%;border-collapse:collapse;"><tr>',
    `<td style="vertical-align:top;padding:0 0 10px;">${mark}</td>`,
    `<td style="vertical-align:top;padding:0 0 10px;text-align:right;font-size:11px;color:${MUTED};">`,
    `<div style="font-size:9px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:${NAVY};">`,
    `Get in touch <span style="display:inline-block;width:8px;height:8px;background:${ACCENT};margin-left:6px;"></span>`,
    '</div>',
    `<div style="margin-top:3px;">${escapeHtml(LETTERHEAD.contactEmail)}</div>`,
    `<div>${escapeHtml(LETTERHEAD.website)}</div>`,
    '</td></tr></table>',
    // Navy rule with an amber segment on the left. Borders (not backgrounds) so
    // it survives a viewer that strips background graphics.
    `<div style="border-top:2px solid ${NAVY};font-size:0;line-height:0;">`,
    `<div style="width:14%;border-top:2px solid ${ACCENT};margin-top:-2px;"></div>`,
    '</div>',
  ].join('');
}

/** The repeating page footer: the two addresses + the confidentiality line. */
function pageFooter(): string {
  return [
    '<div style="padding-top:8px;">',
    `<div style="border-top:2px solid ${NAVY};font-size:0;line-height:0;margin-bottom:8px;">`,
    `<div style="width:18%;border-top:2px solid ${ACCENT};margin-top:-2px;margin-left:auto;"></div>`,
    '</div>',
    '<table style="width:100%;border-collapse:collapse;"><tr>',
    addressBlock(
      LETTERHEAD.manufacturingCenter.label,
      LETTERHEAD.manufacturingCenter.lines,
      'left',
    ),
    addressBlock(
      LETTERHEAD.headquarters.label,
      LETTERHEAD.headquarters.lines,
      'right',
    ),
    '</tr></table>',
    `<div style="margin-top:6px;font-size:8px;color:${MUTED};text-align:center;">${escapeHtml(LETTERHEAD.confidentialityLine)}</div>`,
    '</div>',
  ].join('');
}

/** PO No. / Order Date / Expected Delivery, as a right-aligned mini table. */
function metaTable(data: PurchaseOrderDocumentData): string {
  const rows: [string, string, boolean][] = [
    ['PO No.', data.poNumber, true],
    ['Order Date', day(data.orderDate), false],
    ['Expected Delivery', day(data.expectedDeliveryDate), false],
  ];
  return (
    '<table style="width:250px;margin-left:auto;font-size:11px;border-collapse:collapse;">' +
    rows
      .map(
        ([label, value, navy]) =>
          `<tr><td style="color:${MUTED};padding:2px 14px 2px 0;white-space:nowrap;">${escapeHtml(label)}</td>` +
          `<td style="font-weight:700;text-align:right;padding:2px 0;${navy ? `color:${NAVY};` : ''}">${escapeHtml(value)}</td></tr>`,
      )
      .join('') +
    '</table>'
  );
}

/** Addressee (them) / Ship To (us), side by side. */
function partiesTable(data: PurchaseOrderDocumentData): string {
  const heading = (text: string, align: 'left' | 'right') =>
    `<div style="color:${ACCENT};font-weight:700;font-size:10px;letter-spacing:0.1em;text-transform:uppercase;margin-bottom:6px;text-align:${align};">${escapeHtml(text)}</div>`;
  const them = [
    heading(data.partyKind, 'left'),
    `<div style="font-weight:700;">M/s. ${escapeHtml(data.partyName)}</div>`,
    data.partyContactInfo
      ? `<div style="margin-top:3px;color:#333;">${multiline(data.partyContactInfo)}</div>`
      : '',
    data.partyAddress
      ? `<div style="margin-top:3px;color:#333;">${multiline(data.partyAddress)}</div>`
      : '',
    data.partyGstin
      ? `<div style="margin-top:3px;color:${MUTED};">GSTIN: ${escapeHtml(data.partyGstin)}</div>`
      : '',
  ].join('');
  const us = [
    heading('Ship To', 'right'),
    `<div style="font-weight:700;">${escapeHtml(data.buyer.legalName)}</div>`,
    LETTERHEAD.manufacturingCenter.lines
      .map((l) => `<div style="color:#333;">${escapeHtml(l)}</div>`)
      .join(''),
    // A supplier cannot raise a compliant tax invoice without the buyer's GSTIN,
    // so it belongs on the order rather than in a follow-up email.
    data.buyer.gstin
      ? `<div style="margin-top:3px;color:${MUTED};">GSTIN: ${escapeHtml(data.buyer.gstin)}</div>`
      : '',
  ].join('');
  return (
    '<table style="width:100%;border-collapse:collapse;margin-bottom:24px;"><tr>' +
    `<td style="font-size:12px;vertical-align:top;width:50%;padding-right:20px;">${them}</td>` +
    `<td style="font-size:12px;vertical-align:top;width:50%;text-align:right;">${us}</td>` +
    '</tr></table>'
  );
}

/** The line-item table, ending in the highlighted grand-total row. */
function linesTable(data: PurchaseOrderDocumentData): string {
  const th = (label: string, width: string | null, right: boolean) =>
    `<th style="padding:8px;font-size:10px;font-weight:700;color:#fff;text-align:${right ? 'right' : 'left'};${width ? `width:${width};` : ''}">${escapeHtml(label)}</th>`;
  const td = (content: string, right: boolean) =>
    `<td style="padding:8px;font-size:10.5px;vertical-align:top;border-bottom:1px solid ${RULE};overflow-wrap:anywhere;${right ? 'text-align:right;white-space:nowrap;' : ''}">${content}</td>`;

  const body = data.lines
    .map((line, i) => {
      const detail = [line.adHocDescription, line.notes]
        .filter((s): s is string => !!s && s.trim().length > 0)
        .map(
          (s) =>
            `<div style="color:${MUTED};margin-top:2px;">${multiline(s)}</div>`,
        )
        .join('');
      return (
        `<tr style="background:${i % 2 ? '#f6f8fa' : '#fff'};page-break-inside:avoid;break-inside:avoid;">` +
        td(String(i + 1), false) +
        td(escapeHtml(line.itemCode ?? '—'), false) +
        td(
          `<span style="font-weight:600;">${escapeHtml(line.itemName)}</span>${detail}`,
          false,
        ) +
        td(escapeHtml(trimDecimal(line.orderedQuantity)), true) +
        td(escapeHtml(line.unitOfMeasure), false) +
        td(escapeHtml(formatIndianAmount(line.unitPrice)), true) +
        td(escapeHtml(formatIndianAmount(line.lineTotal)), true) +
        '</tr>'
      );
    })
    .join('');

  // Subtotal, each applicable tax, then the payable total. A zero-rated tax is
  // omitted rather than printed as 0.00: a supplier reading "IGST 0.00" on an
  // intra-state order would reasonably ask which of the two lines is the mistake.
  const taxRow = (label: string, rate: string, amount: string) =>
    Number(rate) === 0
      ? ''
      : '<tr style="page-break-inside:avoid;break-inside:avoid;">' +
        `<td colspan="6" style="padding:6px 8px;text-align:right;color:${MUTED};font-size:10.5px;white-space:nowrap;">${escapeHtml(label)} @ ${escapeHtml(trimDecimal(rate))}%</td>` +
        `<td style="padding:6px 8px;text-align:right;font-size:10.5px;white-space:nowrap;">${escapeHtml(formatIndianAmount(amount))}</td>` +
        '</tr>';
  const taxes =
    taxRow('CGST', data.gst.cgstRate, data.gst.cgstAmount) +
    taxRow('SGST', data.gst.sgstRate, data.gst.sgstAmount) +
    taxRow('IGST', data.gst.igstRate, data.gst.igstAmount);
  const taxable = taxes
    ? '<tr style="page-break-inside:avoid;break-inside:avoid;">' +
      `<td colspan="6" style="padding:9px 8px 6px;text-align:right;font-weight:700;color:${NAVY};font-size:10.5px;white-space:nowrap;">Taxable Value (INR)</td>` +
      `<td style="padding:9px 8px 6px;text-align:right;font-weight:700;font-size:10.5px;white-space:nowrap;">${escapeHtml(formatIndianAmount(data.totalAmount))}</td>` +
      '</tr>'
    : '';
  const total =
    '<tr style="background:#eef1f4;page-break-inside:avoid;break-inside:avoid;">' +
    `<td colspan="6" style="padding:9px 8px;text-align:right;font-weight:700;color:${NAVY};font-size:11px;letter-spacing:0.04em;white-space:nowrap;">TOTAL VALUE (INR)</td>` +
    `<td style="padding:9px 8px;text-align:right;font-weight:800;color:${NAVY};font-size:12px;white-space:nowrap;">${escapeHtml(formatIndianAmount(data.grandTotal))}</td>` +
    '</tr>';

  return [
    '<table style="width:100%;table-layout:fixed;border-collapse:collapse;margin:10px 0 8px;">',
    `<thead><tr style="background:${NAVY};">`,
    th('Sl.', '5%', false),
    th('Item Code', '16%', false),
    th('Description', null, false),
    th('Qty', '8%', true),
    th('Units', '9%', false),
    th('Unit Price (INR)', '14%', true),
    th('Total (INR)', '16%', true),
    '</tr></thead>',
    `<tbody>${body}${taxable}${taxes}${total}</tbody>`,
    '</table>',
  ].join('');
}

/**
 * The sentence after the amount in words. A GST-bearing order says so and names
 * the state the split was decided by, so a supplier can see at a glance whether
 * the order treats them as intra- or inter-state. An order with no GST keeps the
 * long-standing tax-exclusive caveat.
 */
function taxCaption(data: PurchaseOrderDocumentData): string {
  if (Number(data.gst.totalTax) === 0) {
    return 'Prices are exclusive of applicable taxes and duties unless stated otherwise.';
  }
  const state = data.gst.stateName
    ? ` Place of supply: ${data.gst.stateName}.`
    : '';
  return `Inclusive of GST as shown above.${state} Other taxes and duties, if any, are excluded unless stated otherwise.`;
}

/** Authorised-signatory / supplier-acknowledgement blocks, side by side. */
function signatures(data: PurchaseOrderDocumentData): string {
  const block = (
    heading: string,
    l1: string,
    l2: string,
    align: 'left' | 'right',
  ) =>
    `<td style="font-size:11px;vertical-align:top;width:50%;${align === 'right' ? 'padding-left:24px;' : 'padding-right:24px;'}">` +
    `<div style="font-weight:700;color:${NAVY};margin-bottom:44px;">${escapeHtml(heading)}</div>` +
    `<div style="border-top:1px solid ${NAVY};padding-top:6px;">${escapeHtml(l1)}</div>` +
    `<div style="color:${MUTED};">${escapeHtml(l2)}</div>` +
    '</td>';
  return (
    '<table style="width:100%;border-collapse:collapse;margin:8px 0 28px;page-break-inside:avoid;break-inside:avoid;"><tr>' +
    block(
      `For ${LETTERHEAD.name}`,
      'Authorised Signatory',
      data.raisedByName
        ? `Raised by ${data.raisedByName}`
        : 'Name & Designation',
      'left',
    ) +
    block(
      'Supplier Acknowledgement',
      'Signature & Company Seal',
      'Name, Designation & Date',
      'right',
    ) +
    '</tr></table>'
  );
}

/**
 * The terms and conditions annexure, forced onto a fresh sheet.
 *
 * It lives inside the same `<tbody>` cell as the rest of the body, which is what
 * makes it inherit the running letterhead, the address footer and the page
 * counter — a detached annexure with no letterhead is not obviously part of the
 * order. The PO number is repeated in the heading for the same reason: a page
 * that gets separated from the order must still say which order it belongs to.
 *
 * Each clause is break-inside:avoid so a clause never splits across the page
 * boundary, while the list as a whole is free to flow onto a third sheet.
 */
function termsPage(data: PurchaseOrderDocumentData): string {
  if (PURCHASE_ORDER_TERMS.length === 0) return '';
  const clauses = PURCHASE_ORDER_TERMS.map(
    (clause, index) =>
      '<tr style="page-break-inside:avoid;break-inside:avoid;">' +
      `<td style="width:22px;vertical-align:top;padding:0 0 9px;font-size:11px;font-weight:700;color:${NAVY};">${index + 1}.</td>` +
      '<td style="vertical-align:top;padding:0 0 9px;font-size:11px;color:#111;">' +
      `<span style="font-weight:700;color:${NAVY};">${escapeHtml(clause.label)}:</span> ` +
      escapeHtml(clause.text) +
      '</td></tr>',
  ).join('');
  return [
    '<div style="page-break-before:always;break-before:page;padding-top:18px;">',
    kicker('Terms and Conditions'),
    `<div style="font-size:11px;color:${MUTED};margin:8px 0 16px;">Annexure to ${escapeHtml(data.poNumber)} — these terms form an integral part of this purchase order.</div>`,
    '<table style="width:100%;border-collapse:collapse;">',
    `<tbody>${clauses}</tbody>`,
    '</table>',
    `<div style="border-top:1px solid ${RULE};margin-top:14px;padding-top:8px;font-size:10.5px;color:${MUTED};">`,
    'Acceptance of this purchase order, or commencement of supply against it, ',
    'constitutes acceptance of the terms and conditions stated above.',
    '</div>',
    '</div>',
  ].join('');
}

/**
 * The whole document. Layout uses a single outer `<table>` so the letterhead
 * (`<thead>`) and address footer (`<tfoot>`) repeat on every page, with the body
 * in one `<tbody>` cell — the reliable way to get running headers/footers out of
 * a print engine, and the same structure the browser-print twin uses.
 */
export function renderPurchaseOrderDocumentHtml(
  data: PurchaseOrderDocumentData,
): string {
  const notes = data.notes
    ? `<div style="margin-bottom:24px;">${kicker('Notes')}<div style="font-size:11px;color:#333;margin-top:10px;">${multiline(data.notes)}</div></div>`
    : '';

  // Accent-ruled so it reads as a term of the order rather than a remark. Stated
  // as pre-tax because that is the basis it was computed on; the party's invoice
  // will carry the tax and Accounts settles the difference.
  const paymentTerms = data.advance
    ? `<div style="border-left:3px solid ${ACCENT};padding:8px 0 8px 10px;margin:0 0 24px;font-size:11.5px;color:#111;">` +
      `<span style="font-weight:700;color:${NAVY};">Payment terms — advance:</span> ` +
      `${escapeHtml(data.advance.percent)}% of the order value, ` +
      `₹${escapeHtml(formatIndianAmount(data.advance.amount))} (exclusive of taxes), ` +
      'payable against this purchase order before delivery. The balance is payable ' +
      'against your tax invoice on receipt and acceptance of the goods.' +
      '</div>'
    : '';

  return [
    '<!doctype html><html><head><meta charset="utf-8" />',
    `<title>${escapeHtml(data.poNumber)}</title>`,
    '<style>',
    // No @page rule: PdfService states the paper size and margins to Gotenberg,
    // which also has to know them to reserve the footer band.
    'html,body{margin:0;padding:0;}',
    'body{color:#111;line-height:1.5;font-size:12px;-webkit-print-color-adjust:exact;print-color-adjust:exact;',
    'font-family:-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;}',
    '*{box-sizing:border-box;}',
    'thead{display:table-header-group;}',
    'tfoot{display:table-footer-group;}',
    'td,th,p{overflow-wrap:anywhere;word-break:normal;}',
    '</style></head><body>',
    '<table style="width:100%;border-collapse:collapse;">',
    `<thead><tr><td style="padding:0;">${pageHeader(data.hasLogo)}</td></tr></thead>`,
    `<tfoot><tr><td style="padding:0;">${pageFooter()}</td></tr></tfoot>`,
    '<tbody><tr><td style="padding:18px 0 0;">',

    // Title + PO metadata
    '<table style="width:100%;border-collapse:collapse;margin-bottom:26px;"><tr>',
    '<td style="vertical-align:top;">',
    kicker('Procurement'),
    `<div style="font-size:22px;font-weight:800;color:${NAVY};letter-spacing:-0.01em;margin-top:8px;">PURCHASE ORDER</div>`,
    '</td>',
    `<td style="vertical-align:top;">${metaTable(data)}</td>`,
    '</tr></table>',

    partiesTable(data),

    '<p style="font-size:12px;margin:0 0 24px;">Dear Sir/Madam, please supply the following goods in accordance with the terms and conditions of this purchase order.</p>',

    kicker('Order Details'),
    linesTable(data),

    // Words spell out the payable total, and the tax caption states what the
    // figure already includes. Keeping the old "exclusive of applicable taxes"
    // line on a GST-bearing order would contradict the table above it.
    `<p style="font-size:10.5px;color:${MUTED};margin:0 0 24px;">Amount in words: ${escapeHtml(amountToIndianWords(data.grandTotal))}. ${escapeHtml(taxCaption(data))}</p>`,

    paymentTerms,
    notes,
    signatures(data),

    `<div style="font-size:11px;color:${MUTED};">This purchase order was generated on ${escapeHtml(day(data.generatedOn))} by ${escapeHtml(data.buyer.legalName)}.</div>`,

    // Last, so page 1 stays the commercial order exactly as before and the terms
    // are a clearly separate annexure.
    termsPage(data),

    '</td></tr></tbody></table></body></html>',
  ].join('');
}
