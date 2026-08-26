import PDFDocument from 'pdfkit';
import { Prisma } from '@prisma/client';

/**
 * Server-side PDF rendering for a submitted vendor/supplier RFQ quote.
 *
 * Vendors quote through the public token portal, where there is no browser
 * session we can drive `window.print()` from (that is how every other document
 * in this app becomes a PDF). The quote therefore has to be rendered by the
 * backend at submit time, so pdfkit — pure JS, no headless browser — draws it.
 *
 * Kept as free functions over a plain data snapshot: no Prisma, no Nest, so the
 * layout is unit-testable and the filing service owns all the I/O.
 */

/** Amounts print as "INR 1,23,456.00": Helvetica has no rupee glyph. */
function money(value: string): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return `INR ${value}`;
  return `INR ${n.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Trailing zeros off a Decimal string: quantities read "10", not "10.0000". */
function quantity(value: string): string {
  return value.includes('.') ? value.replace(/\.?0+$/, '') : value;
}

function day(date: Date | null): string {
  return date ? date.toISOString().slice(0, 10) : '—';
}

export interface RfqQuotePdfLine {
  itemCode: string | null;
  itemName: string;
  quantity: string;
  unitOfMeasure: string;
  specificationNotes: string | null;
  targetPrice: Prisma.Decimal | null;
  unitPrice: string;
  lineTotal: string;
  deliveryLeadTimeDays: number | null;
  remarks: string | null;
}

export interface RfqQuotePdfData {
  rfqNumber: string;
  submissionDeadline: Date;
  requiredByDate: Date | null;
  deliveryLocation: string | null;
  paymentTermsRequested: string | null;
  /** Whether the quote came from a Vendor or a Supplier invitee. */
  partnerKind: 'Vendor' | 'Supplier';
  partnerName: string;
  submittedAt: Date;
  quotedLeadTimeDays: number | null;
  paymentTermsOffered: string | null;
  validityDays: number | null;
  notes: string | null;
  totalQuotedValue: string;
  lines: RfqQuotePdfLine[];
  /** Count of the vendor's own uploaded files; they stay in RfqQuote, not Vault. */
  attachmentCount: number;
}

/**
 * Filename for the Vault copy: `RFQ-2026-0007_Vigyanlabs-Innovations_Quote.pdf`
 * — RFQ number first so a flat folder sorts by RFQ, partner second so competing
 * quotes on one RFQ sit next to each other. No date: a resubmission becomes a
 * new *version* of this same file, and a date would fork it into two files.
 */
export function rfqQuoteFileName(
  rfqNumber: string,
  partnerName: string,
): string {
  return `${slug(rfqNumber)}_${slug(partnerName)}_Quote.pdf`;
}

/** Filename-safe token: punctuation and runs of whitespace collapse to hyphens. */
function slug(value: string): string {
  const cleaned = value
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  // A partner named entirely in non-Latin characters would slug to nothing;
  // the name must never collapse into `RFQ-2026-0007__Quote.pdf`.
  return cleaned || 'Unnamed';
}

const PAGE_MARGIN = 44;
const HAIRLINE = '#D4D4D4';
const MUTED = '#5A5A5A';
const INK = '#1B1B1B';

/** Renders the quote to a PDF buffer. */
export function renderRfqQuotePdf(data: RfqQuotePdfData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: PAGE_MARGIN,
      info: {
        Title: `${data.rfqNumber} — ${data.partnerName} quote`,
        Author: 'TX PeopleHub',
        Subject: 'RFQ quotation received',
      },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    try {
      draw(doc, data);
      doc.end();
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  });
}

function draw(doc: PDFKit.PDFDocument, data: RfqQuotePdfData): void {
  const left = PAGE_MARGIN;
  const width = doc.page.width - PAGE_MARGIN * 2;

  doc
    .fillColor(MUTED)
    .font('Helvetica')
    .fontSize(8.5)
    .text('QUOTATION RECEIVED', left, PAGE_MARGIN, { characterSpacing: 1.2 });
  doc
    .fillColor(INK)
    .font('Helvetica-Bold')
    .fontSize(17)
    .text(data.rfqNumber, { continued: false });
  doc
    .fillColor(MUTED)
    .font('Helvetica')
    .fontSize(9.5)
    .text(
      `${data.partnerKind}: ${data.partnerName}  ·  Submitted ${day(data.submittedAt)}`,
    );
  doc.moveDown(0.9);
  rule(doc, left, width);
  doc.moveDown(0.7);

  // Two columns: what the RFQ asked for, and what the partner offered back.
  const columnGap = 18;
  const columnWidth = (width - columnGap) / 2;
  const columnTop = doc.y;
  definitions(doc, left, columnWidth, 'RFQ terms requested', [
    ['Submission deadline', day(data.submissionDeadline)],
    ['Required by', day(data.requiredByDate)],
    ['Delivery location', data.deliveryLocation ?? '—'],
    ['Payment terms', data.paymentTermsRequested ?? '—'],
  ]);
  const leftBottom = doc.y;
  doc.y = columnTop;
  definitions(
    doc,
    left + columnWidth + columnGap,
    columnWidth,
    'Quote offered',
    [
      [
        'Lead time',
        data.quotedLeadTimeDays === null
          ? '—'
          : `${data.quotedLeadTimeDays} days`,
      ],
      ['Payment terms', data.paymentTermsOffered ?? '—'],
      [
        'Validity',
        data.validityDays === null ? '—' : `${data.validityDays} days`,
      ],
      [
        'Attachments',
        data.attachmentCount === 0
          ? 'None'
          : `${data.attachmentCount} file(s) held against the quote`,
      ],
    ],
  );
  doc.y = Math.max(leftBottom, doc.y) + 14;

  linesTable(doc, left, width, data.lines);

  doc.moveDown(0.6);
  const totalTop = doc.y;
  doc.font('Helvetica-Bold').fontSize(10.5).fillColor(INK);
  doc.text('Total quoted value', left, totalTop, {
    width: width - 140,
    align: 'right',
  });
  doc.text(money(data.totalQuotedValue), left + width - 140, totalTop, {
    width: 140,
    align: 'right',
  });

  if (data.notes) {
    doc.moveDown(1.2);
    doc.font('Helvetica-Bold').fontSize(9).fillColor(INK).text('Notes', left);
    doc
      .font('Helvetica')
      .fontSize(9)
      .fillColor(MUTED)
      .text(data.notes, left, doc.y + 2, { width });
  }

  doc.moveDown(1.4);
  rule(doc, left, width);
  doc
    .font('Helvetica')
    .fontSize(7.5)
    .fillColor(MUTED)
    .text(
      'Filed automatically to Vault when the partner submitted this quote through the RFQ portal. ' +
        'This is a system record of the submission, not a purchase commitment.',
      left,
      doc.y + 6,
      { width },
    );
}

function rule(doc: PDFKit.PDFDocument, left: number, width: number): void {
  doc
    .moveTo(left, doc.y)
    .lineTo(left + width, doc.y)
    .lineWidth(0.5)
    .strokeColor(HAIRLINE)
    .stroke();
}

function definitions(
  doc: PDFKit.PDFDocument,
  x: number,
  width: number,
  heading: string,
  rows: [string, string][],
): void {
  doc
    .font('Helvetica-Bold')
    .fontSize(8.5)
    .fillColor(INK)
    .text(heading, x, doc.y, { width });
  doc.moveDown(0.35);
  for (const [label, value] of rows) {
    const y = doc.y;
    doc
      .font('Helvetica')
      .fontSize(9)
      .fillColor(MUTED)
      .text(label, x, y, { width: width * 0.45 });
    const labelBottom = doc.y;
    doc.y = y;
    doc.fillColor(INK).text(value, x + width * 0.45, y, {
      width: width * 0.55,
      align: 'right',
    });
    doc.y = Math.max(labelBottom, doc.y) + 1.5;
  }
}

/** Item table. Columns mirror the vendor's own quote form, left to right. */
function linesTable(
  doc: PDFKit.PDFDocument,
  left: number,
  width: number,
  lines: RfqQuotePdfLine[],
): void {
  const columns: { label: string; w: number; right: boolean }[] = [
    { label: 'Item', w: 0.4, right: false },
    { label: 'Qty', w: 0.13, right: true },
    { label: 'Unit price', w: 0.17, right: true },
    { label: 'Lead', w: 0.1, right: true },
    { label: 'Line total', w: 0.2, right: true },
  ];
  const xs: number[] = [];
  let cursor = left;
  for (const c of columns) {
    xs.push(cursor);
    cursor += c.w * width;
  }

  doc.font('Helvetica-Bold').fontSize(8).fillColor(MUTED);
  const headTop = doc.y;
  columns.forEach((c, i) => {
    doc.text(c.label.toUpperCase(), xs[i], headTop, {
      width: c.w * width - 6,
      align: c.right ? 'right' : 'left',
    });
  });
  doc.y = headTop + 12;
  rule(doc, left, width);
  doc.y += 5;

  for (const line of lines) {
    // A row near the bottom would straddle the page break; start it fresh.
    if (doc.y > doc.page.height - PAGE_MARGIN - 70) {
      doc.addPage();
      doc.y = PAGE_MARGIN;
    }
    const top = doc.y;
    doc.font('Helvetica').fontSize(9).fillColor(INK);
    const itemLabel = line.itemCode
      ? `${line.itemName}  (${line.itemCode})`
      : line.itemName;
    doc.text(itemLabel, xs[0], top, { width: columns[0].w * width - 6 });
    const detail = [
      line.targetPrice
        ? `Target price: ${money(line.targetPrice.toString())}`
        : null,
      line.specificationNotes,
      line.remarks,
    ]
      .filter((s): s is string => !!s && s.trim().length > 0)
      .join(' · ');
    if (detail) {
      doc
        .font('Helvetica')
        .fontSize(7.5)
        .fillColor(MUTED)
        .text(detail, xs[0], doc.y + 1, { width: columns[0].w * width - 6 });
    }
    const itemBottom = doc.y;

    doc.font('Helvetica').fontSize(9).fillColor(INK);
    const cells: string[] = [
      `${quantity(line.quantity)} ${line.unitOfMeasure}`,
      money(line.unitPrice),
      line.deliveryLeadTimeDays === null
        ? '—'
        : `${line.deliveryLeadTimeDays}d`,
      money(line.lineTotal),
    ];
    cells.forEach((text, i) => {
      const c = columns[i + 1];
      doc.text(text, xs[i + 1], top, {
        width: c.w * width - 6,
        align: 'right',
      });
    });

    doc.y = Math.max(itemBottom, top + 12) + 6;
    rule(doc, left, width);
    doc.y += 5;
  }

  if (lines.length === 0) {
    doc
      .font('Helvetica')
      .fontSize(9)
      .fillColor(MUTED)
      .text('No priced lines on this quote.', left, doc.y, { width });
    doc.y += 6;
  }
}
