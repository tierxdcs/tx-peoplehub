import { escapeHtml } from '../../core/email/email-content';
import {
  purchaseOrderFooterHtml,
  purchaseOrderPdfFileName,
  renderPurchaseOrderDocumentHtml,
  type PurchaseOrderDocumentData,
} from './purchase-order-document';
import { PURCHASE_ORDER_TERMS } from './purchase-order-terms';

/**
 * The supplier-facing PO document. What is worth locking down is not the styling
 * but the facts a supplier acts on — the order number, the quantities, the money
 * and the amount in words — plus the two ways HTML generation goes wrong:
 * unescaped party/item names, and a filename that collapses to nothing.
 */
const noGst: PurchaseOrderDocumentData['gst'] = {
  stateName: 'Karnataka',
  igstRate: '0.00',
  cgstRate: '0.00',
  sgstRate: '0.00',
  igstAmount: '0.00',
  cgstAmount: '0.00',
  sgstAmount: '0.00',
  totalTax: '0.00',
};

/** 18% on 1,37,000 — 9 + 9 within Karnataka, all 18 on IGST outside it. */
const intraStateGst: PurchaseOrderDocumentData['gst'] = {
  ...noGst,
  cgstRate: '9.00',
  sgstRate: '9.00',
  cgstAmount: '12330.00',
  sgstAmount: '12330.00',
  totalTax: '24660.00',
};
const interStateGst: PurchaseOrderDocumentData['gst'] = {
  ...noGst,
  stateName: 'Tamil Nadu',
  igstRate: '18.00',
  igstAmount: '24660.00',
  totalTax: '24660.00',
};

describe('renderPurchaseOrderDocumentHtml', () => {
  const data = (
    overrides: Partial<PurchaseOrderDocumentData> = {},
  ): PurchaseOrderDocumentData => ({
    poNumber: 'PO-2026-0001',
    orderDate: new Date('2026-08-22T00:00:00.000Z'),
    expectedDeliveryDate: new Date('2026-09-15T00:00:00.000Z'),
    partyKind: 'Supplier',
    partyName: 'Acme Precision Pvt Ltd',
    partyContactInfo: null,
    partyAddress: null,
    notes: null,
    raisedByName: 'SCM User',
    totalAmount: '137000.00',
    // Zero-rated by default: the document's own behaviour without GST is what
    // every order raised before GST existed on the PO still has to print.
    gst: noGst,
    grandTotal: '137000.00',
    advance: null,
    lines: [
      {
        itemCode: 'RM-0001',
        itemName: 'MS Sheet 2mm',
        adHocDescription: null,
        notes: null,
        orderedQuantity: '212.0000',
        unitOfMeasure: 'NOS',
        unitPrice: '500.0000',
        lineTotal: '106000.0000',
      },
      {
        itemCode: null,
        itemName: 'Powder coating',
        adHocDescription: 'RAL 7035, matte',
        notes: null,
        orderedQuantity: '212.0000',
        unitOfMeasure: 'NOS',
        unitPrice: '146.2264',
        lineTotal: '31000.0000',
      },
    ],
    buyer: { legalName: 'Phaze Dynamics Pvt Ltd', gstin: '29ABCDE1234F1Z5' },
    generatedOn: new Date('2026-08-27T06:30:00.000Z'),
    hasLogo: true,
    ...overrides,
  });

  it('states the order number, dates, party and every line', () => {
    const html = renderPurchaseOrderDocumentHtml(data());

    expect(html).toContain('PURCHASE ORDER');
    expect(html).toContain('PO-2026-0001');
    // Plain ISO dates, matching the browser-print twin's dateOnlyStr().
    expect(html).toContain('2026-08-22');
    expect(html).toContain('2026-09-15');
    expect(html).toContain('M/s. Acme Precision Pvt Ltd');
    expect(html).toContain('RM-0001');
    expect(html).toContain('MS Sheet 2mm');
    expect(html).toContain('RAL 7035, matte');
  });

  it('prints the registered party address, contact details and GSTIN', () => {
    const html = renderPurchaseOrderDocumentHtml(
      data({
        partyAddress: '1 Supplier Road\nBengaluru 560001',
        partyContactInfo: 'buyer@supplier.test · 9999999999',
        partyGstin: '29AAAAA0000A1Z5',
      }),
    );
    expect(html).toContain('1 Supplier Road<br />Bengaluru 560001');
    expect(html).toContain('buyer@supplier.test');
    expect(html).toContain('GSTIN: 29AAAAA0000A1Z5');
  });

  it('formats money the Indian way and spells the total out in words', () => {
    const html = renderPurchaseOrderDocumentHtml(data());

    expect(html).toContain('1,37,000.00');
    expect(html).toContain('1,06,000.00');
    expect(html).toContain('Rupees One Lakh Thirty-Seven Thousand Only');
    // Quantity padding from the Decimal column is trimmed, not printed.
    expect(html).toContain('>212<');
    expect(html).not.toContain('212.0000');
  });

  it('breaks GST out as CGST + SGST and totals the payable figure', () => {
    const html = renderPurchaseOrderDocumentHtml(
      data({ gst: intraStateGst, grandTotal: '161660.00' }),
    );

    // The supplier is being asked to invoice the tax-inclusive figure, so that is
    // what the highlighted total and the words have to say.
    expect(html).toContain('Taxable Value (INR)');
    expect(html).toContain('1,37,000.00');
    expect(html).toContain('CGST @ 9%');
    expect(html).toContain('SGST @ 9%');
    expect(html).toContain('12,330.00');
    expect(html).toContain('1,61,660.00');
    expect(html).toContain(
      'Rupees One Lakh Sixty-One Thousand Six Hundred Sixty Only',
    );
    expect(html).toContain('Inclusive of GST as shown above');
    expect(html).toContain('Place of supply: Karnataka');
    // A zero-rated tax is omitted rather than printed as 0.00.
    expect(html).not.toContain('IGST');
  });

  it('puts the whole rate on IGST for a supplier outside the state', () => {
    const html = renderPurchaseOrderDocumentHtml(
      data({ gst: interStateGst, grandTotal: '161660.00' }),
    );
    expect(html).toContain('IGST @ 18%');
    expect(html).toContain('24,660.00');
    expect(html).toContain('Place of supply: Tamil Nadu');
    expect(html).not.toContain('CGST');
    expect(html).not.toContain('SGST');
  });

  it('keeps the tax-exclusive caption when the order carries no GST', () => {
    const html = renderPurchaseOrderDocumentHtml(data());
    // An order raised before GST reached the PO must print exactly as it did.
    expect(html).toContain(
      'Prices are exclusive of applicable taxes and duties',
    );
    expect(html).not.toContain('Taxable Value (INR)');
    expect(html).not.toContain('CGST');
    expect(html).toContain('1,37,000.00');
  });

  it('prints the advance as a payment term, and says nothing when there is none', () => {
    const html = renderPurchaseOrderDocumentHtml(
      data({ advance: { percent: '30.00', amount: '41100.00' } }),
    );

    // The percentage alone is not a term a supplier can act on — the rupee
    // figure has to be on the document they are agreeing to.
    expect(html).toContain('Payment terms');
    expect(html).toContain('30.00%');
    expect(html).toContain('41,100.00');
    expect(html).toContain('before delivery');

    expect(renderPurchaseOrderDocumentHtml(data())).not.toContain(
      'Payment terms',
    );
  });

  it('prints the terms as a numbered annexure on a fresh page', () => {
    const html = renderPurchaseOrderDocumentHtml(data());

    // A forced break is the whole point: the terms must not crowd onto the
    // commercial page, and both property spellings are needed for Chromium.
    expect(html).toContain('page-break-before:always');
    expect(html).toContain('break-before:page');
    expect(html).toContain('Terms and Conditions');
    expect(html).not.toContain('Fabrication &amp; Supply of Racks / PDUs');
    // A page that gets separated from the order must still name its order.
    expect(html).toContain('Annexure to PO-2026-0001');

    // Every clause, numbered, with its bold lead-in.
    for (const [index, clause] of PURCHASE_ORDER_TERMS.entries()) {
      expect(html).toContain(`>${index + 1}.</td>`);
      expect(html).toContain(`${escapeHtml(clause.label)}:`);
    }
    expect(html).toContain(
      '0.5% of the value of the delayed material per week',
    );
    expect(html).toContain('constitutes acceptance of the terms');
  });

  it('escapes clause text rather than trusting it as markup', () => {
    const html = renderPurchaseOrderDocumentHtml(data());
    // "Material & Quality" and "Rejection / Rework" both round-trip; an
    // unescaped ampersand in a clause label would be invalid markup.
    expect(html).toContain('Material &amp; Quality:');
    expect(html).not.toContain('Material & Quality:');
    expect(html).toContain('Supplier&#39;s premises');
  });

  it("carries the buyer's GSTIN — a supplier cannot invoice without it", () => {
    expect(renderPurchaseOrderDocumentHtml(data())).toContain(
      'GSTIN: 29ABCDE1234F1Z5',
    );
    // …and simply omits the label when GST registration is not on record.
    expect(
      renderPurchaseOrderDocumentHtml(
        data({ buyer: { legalName: 'Phaze Dynamics', gstin: null } }),
      ),
    ).not.toContain('GSTIN:');
  });

  it('escapes party, item and note text instead of letting it become markup', () => {
    const html = renderPurchaseOrderDocumentHtml(
      data({
        partyName: 'Acme <script>alert(1)</script> & Co',
        notes: 'Deliver to gate 2 <b>only</b>',
        lines: [
          {
            ...data().lines[0],
            itemName: 'Bracket "L" <type-2>',
          },
        ],
      }),
    );

    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('Acme &lt;script&gt;');
    expect(html).toContain('&amp; Co');
    expect(html).toContain('Bracket &quot;L&quot; &lt;type-2&gt;');
    expect(html).toContain('Deliver to gate 2 &lt;b&gt;only&lt;/b&gt;');
  });

  it('keeps free-text line breaks as breaks in the contact block', () => {
    const html = renderPurchaseOrderDocumentHtml(
      data({
        partyKind: 'Ad-hoc Party',
        partyContactInfo: 'Ravi Kumar\n+91 90000 00000',
      }),
    );

    expect(html).toContain('Ravi Kumar<br />+91 90000 00000');
  });

  it('references the logo asset only when one is being uploaded with it', () => {
    expect(renderPurchaseOrderDocumentHtml(data())).toContain(
      'src="letterhead-logo.png"',
    );
    // Without the asset the letterhead falls back to the wordmark rather than
    // rendering a broken image — a missing PNG must not spoil a supplier's PDF.
    const noLogo = renderPurchaseOrderDocumentHtml(data({ hasLogo: false }));
    expect(noLogo).not.toContain('letterhead-logo.png');
    expect(noLogo).toContain('Phaze Dynamics');
  });

  it('repeats the letterhead and addresses on every page', () => {
    const html = renderPurchaseOrderDocumentHtml(data());

    // The outer-table trick: thead/tfoot as running header/footer.
    expect(html).toContain('thead{display:table-header-group;}');
    expect(html).toContain('tfoot{display:table-footer-group;}');
    expect(html).toContain('<thead>');
    expect(html).toContain('<tfoot>');
    // Backgrounds must survive Chromium's default of dropping them.
    expect(html).toContain('print-color-adjust:exact');
    // Geometry is Gotenberg's business, so the document states no @page rule.
    expect(html).not.toContain('@page');
  });

  it('renders the same bytes for the same order (no hidden clock)', () => {
    const first = renderPurchaseOrderDocumentHtml(data());
    const second = renderPurchaseOrderDocumentHtml(data());
    expect(first).toBe(second);
    expect(first).toContain('generated on 2026-08-27');
  });

  it('shows an em dash rather than "null" for a missing delivery date', () => {
    const html = renderPurchaseOrderDocumentHtml(
      data({ expectedDeliveryDate: null }),
    );
    expect(html).toContain('Expected Delivery');
    expect(html).not.toContain('null');
  });
});

describe('purchaseOrderPdfFileName', () => {
  it('names the file by order then party', () => {
    expect(
      purchaseOrderPdfFileName('PO-2026-0001', 'Acme Precision Pvt Ltd'),
    ).toBe('PO-2026-0001_Acme-Precision-Pvt-Ltd.pdf');
  });

  it('collapses punctuation and whitespace to single hyphens', () => {
    expect(purchaseOrderPdfFileName('PO-2026-0002', 'Sri  Ram & Co.')).toBe(
      'PO-2026-0002_Sri-Ram-Co.pdf',
    );
  });

  it('falls back to a name rather than an empty token', () => {
    // A party named entirely in non-Latin script must not yield `PO-…_.pdf`.
    expect(purchaseOrderPdfFileName('PO-2026-0003', 'श्री राम')).toBe(
      'PO-2026-0003_Unnamed.pdf',
    );
  });
});

describe('purchaseOrderFooterHtml', () => {
  it('uses Chromium page-number classes with an explicit font size', () => {
    const footer = purchaseOrderFooterHtml();
    expect(footer).toContain('class="pageNumber"');
    expect(footer).toContain('class="totalPages"');
    // Without an explicit size Chromium renders these templates at ~7pt.
    expect(footer).toMatch(/font-size:\s*9px/);
  });
});
