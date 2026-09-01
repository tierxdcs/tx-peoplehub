import {
  purchaseOrderIssuedEmail,
  type PurchaseOrderIssuedInput,
} from './purchase-order-issued';

/**
 * The covering note for an issued PO. The properties that matter: it names the
 * attachment (so a stripped attachment is obvious), it never restates the order
 * lines, and a re-send reads as a repeat rather than a second order — a supplier
 * double-shipping 212 units is the expensive failure here.
 */
describe('purchaseOrderIssuedEmail', () => {
  const input = (
    overrides: Partial<PurchaseOrderIssuedInput> = {},
  ): PurchaseOrderIssuedInput => ({
    poNumber: 'PO-2026-0001',
    partyName: 'Acme Precision Pvt Ltd',
    orderDate: new Date('2026-08-22T00:00:00.000Z'),
    expectedDeliveryDate: new Date('2026-09-15T00:00:00.000Z'),
    lineCount: 2,
    totalAmountFormatted: '1,37,000.00',
    attachmentFileName: 'PO-2026-0001_Acme-Precision-Pvt-Ltd.pdf',
    organisationName: 'Phaze Dynamics Pvt Ltd',
    ...overrides,
  });

  it('states the order, the value and the attachment name', () => {
    const mail = purchaseOrderIssuedEmail(input());

    expect(mail.subject).toBe(
      'Purchase Order PO-2026-0001 from Phaze Dynamics Pvt Ltd',
    );
    expect(mail.text).toContain('Hello Acme Precision Pvt Ltd,');
    expect(mail.text).toContain('has issued purchase order PO-2026-0001');
    expect(mail.text).toContain('2 line items');
    expect(mail.text).toContain('INR 1,37,000.00');
    expect(mail.text).toContain('PO-2026-0001_Acme-Precision-Pvt-Ltd.pdf');
    expect(mail.text).toContain('quote the PO number');
  });

  it('does not restate the order lines — the PDF is the document of record', () => {
    const mail = purchaseOrderIssuedEmail(input());
    // Only the summary numbers appear; nothing item-level can drift from the PDF.
    expect(mail.text).not.toMatch(/Item Code|Unit Price|Sl\./);
  });

  it('reads as a repeat, not a new order, on a re-send', () => {
    const mail = purchaseOrderIssuedEmail(input({ resend: true }));

    expect(mail.subject).toContain('(resent)');
    expect(mail.html).toContain('Purchase Order PO-2026-0001 (resent)');
    expect(mail.text).toContain('This is a repeat of purchase order');
    expect(mail.text).toContain('not a new order');
    expect(mail.text).not.toContain('has issued purchase order');
  });

  it('mentions the delivery date only when the order carries one', () => {
    // ICU spells September "Sept" in en-IN; the other months are three letters.
    expect(purchaseOrderIssuedEmail(input()).text).toMatch(
      /Delivery is expected by 15 Sept? 2026/,
    );
    expect(
      purchaseOrderIssuedEmail(input({ expectedDeliveryDate: null })).text,
    ).not.toContain('Delivery is expected');
  });

  it('states dates as calendar days in the buyer timezone', () => {
    // Late-evening IST is the next UTC day; a delivery date is a day, not an
    // instant, so it must not slide by one on either side.
    const mail = purchaseOrderIssuedEmail(
      input({
        orderDate: new Date('2026-08-22T19:30:00.000Z'), // 23 Aug in IST
      }),
    );
    expect(mail.text).toContain('23 Aug 2026');
  });

  it('agrees on singular/plural for a one-line order', () => {
    expect(purchaseOrderIssuedEmail(input({ lineCount: 1 })).text).toContain(
      '1 line item for',
    );
  });

  it('passes the buyer note through, and omits an empty one', () => {
    expect(
      purchaseOrderIssuedEmail(input({ note: 'Freight is to our account.' }))
        .text,
    ).toContain('Freight is to our account.');
    const blank = purchaseOrderIssuedEmail(input({ note: '   ' }));
    expect(blank.text).not.toMatch(/\n\s{3,}\n/);
  });

  it('always offers a plain-text alternative with no markup left in it', () => {
    const mail = purchaseOrderIssuedEmail(input());
    expect(mail.text.length).toBeGreaterThan(0);
    expect(mail.text).not.toContain('<');
    expect(mail.html).toContain('<');
  });
});
