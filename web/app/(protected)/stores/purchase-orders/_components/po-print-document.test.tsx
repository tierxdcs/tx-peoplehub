import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PurchaseOrderPrintDocument } from './po-print-document';
import { PURCHASE_ORDER_TERMS } from '../../../../lib/purchase-order-terms';
import type {
  PurchaseOrder,
  PurchaseOrderAdvance,
  PurchaseOrderGst,
} from '../../../../lib/stores';

/** An order with no tax line — how every PO raised before GST reads. */
const noGst: PurchaseOrderGst = {
  stateCode: '29',
  stateName: 'Karnataka',
  intraState: true,
  igstRate: '0.00',
  cgstRate: '0.00',
  sgstRate: '0.00',
  igstAmount: '0.00',
  cgstAmount: '0.00',
  sgstAmount: '0.00',
  totalTax: '0.00',
};

/** 18% from a Karnataka supplier: halved into CGST + SGST. */
const intraStateGst: PurchaseOrderGst = {
  ...noGst,
  cgstRate: '9.00',
  sgstRate: '9.00',
  cgstAmount: '12330.00',
  sgstAmount: '12330.00',
  totalTax: '24660.00',
};

/** The same 18% from a Tamil Nadu supplier: all of it on IGST. */
const interStateGst: PurchaseOrderGst = {
  ...noGst,
  stateCode: '33',
  stateName: 'Tamil Nadu',
  intraState: false,
  igstRate: '18.00',
  igstAmount: '24660.00',
  totalTax: '24660.00',
};

/**
 * The browser-print twin of the server-rendered PDF
 * (src/modules/scm-purchasing/purchase-order-document.ts). What matters here is
 * the advance: it is a commercial term the party is being asked to agree to, so
 * a PO that carries one must print it, and a PO that does not must not imply one.
 */
function po(
  advance: PurchaseOrderAdvance | null,
  overrides: Partial<PurchaseOrder> = {},
): PurchaseOrder {
  return {
    id: 'po-1',
    poNumber: 'PO-2026-0001',
    status: 'ISSUED',
    supplierId: 'sup-1',
    supplierName: 'Acme Precision Pvt Ltd',
    vendorId: null,
    vendorName: null,
    adHocPartyName: null,
    adHocContactInfo: null,
    adHocPartyAddress: null,
    partyAddress: '1 Supplier Road, Bengaluru 560001',
    partyContactInfo: 'buyer@supplier.test · 9999999999',
    partyGstin: '29ABCDE1234F1Z5',
    ceoApprovedById: null,
    ceoApprovedAt: null,
    rejectedById: null,
    rejectedAt: null,
    rejectionComment: null,
    orderDate: '2026-08-22T00:00:00.000Z',
    expectedDeliveryDate: null,
    notes: null,
    createdById: 'scm-1',
    createdByName: 'SCM User',
    issuedAt: '2026-09-02T00:00:00.000Z',
    cancelledAt: null,
    lastEmailedAt: null,
    lastEmailedTo: null,
    partyEmail: null,
    totalAmount: '137000.00',
    gst: noGst,
    grandTotal: '137000.00',
    approvalAmount: '137000.00',
    advance,
    approvals: [],
    lines: [
      {
        id: 'pol-1',
        itemId: null,
        itemCode: 'RM-0001',
        itemName: 'MS Sheet 2mm',
        adHocDescription: null,
        orderedQuantity: '212',
        unitPrice: '500',
        unitOfMeasure: 'NOS',
        lineTotal: '137000.00',
        notes: null,
        sequence: 0,
      },
    ],
    createdAt: '2026-08-22T00:00:00.000Z',
    updatedAt: '2026-09-02T00:00:00.000Z',
    ...overrides,
  };
}

const advance: PurchaseOrderAdvance = {
  percent: '30.00',
  amount: '41100.00',
  indicativeAmount: null,
  paymentId: 'pay-1',
  paymentNumber: 'PAY-2026-00001',
  status: 'DRAFT',
  plannedDate: '2026-09-02T00:00:00.000Z',
  executedDate: null,
  bankReference: null,
  rejectionComment: null,
};

describe('PurchaseOrderPrintDocument buyer identity', () => {
  it('prints the registered supplier address, contact and GSTIN', () => {
    const { container } = render(
      <PurchaseOrderPrintDocument po={po(null)} generatedOn="2026-09-02" />,
    );
    const text = container.textContent ?? '';
    expect(text).toContain('1 Supplier Road, Bengaluru 560001');
    expect(text).toContain('buyer@supplier.test');
    expect(text).toContain('GSTIN: 29ABCDE1234F1Z5');
  });

  it('states our GSTIN so the supplier can invoice against the order', () => {
    const { container } = render(
      <PurchaseOrderPrintDocument po={po(null)} generatedOn="2026-09-02" />,
    );
    const text = container.textContent ?? '';
    expect(text).toContain('Phaze Dynamics India Pvt Ltd');
    expect(text).toContain('GSTIN: 29AARCP3898H1ZG');
  });
});

describe('PurchaseOrderPrintDocument terms annexure', () => {
  it('prints every clause, numbered, against the PO number', () => {
    const { container } = render(
      <PurchaseOrderPrintDocument po={po(null)} generatedOn="2026-09-02" />,
    );
    const text = container.textContent ?? '';

    expect(text).toContain('Terms and Conditions');
    expect(text).not.toContain('Fabrication & Supply of Racks / PDUs');
    expect(text).toContain('Annexure to PO-2026-0001');
    for (const [i, clause] of PURCHASE_ORDER_TERMS.entries()) {
      expect(text).toContain(`${i + 1}.`);
      expect(text).toContain(`${clause.label}:`);
      expect(text).toContain(clause.text);
    }
    expect(text).toContain('constitutes acceptance of the terms');
  });

  it('forces the annexure onto its own sheet', () => {
    const { container } = render(
      <PurchaseOrderPrintDocument po={po(null)} generatedOn="2026-09-02" />,
    );
    // Without the break the terms crowd onto the commercial page. React emits
    // `break-before` from breakBefore; pageBreakBefore is the legacy alias
    // Chromium still honours, so both must reach the DOM.
    const broken = container.querySelector<HTMLElement>(
      '[style*="break-before"]',
    );
    expect(broken).not.toBeNull();
    expect(broken?.style.breakBefore || broken?.style.pageBreakBefore).toBe(
      'page',
    );
  });
});

describe('PurchaseOrderPrintDocument GST', () => {
  const printed = (gst: PurchaseOrderGst, grandTotal: string) => {
    const { container } = render(
      <PurchaseOrderPrintDocument
        po={po(null, { gst, grandTotal })}
        generatedOn="2026-09-02"
      />,
    );
    return container.textContent ?? '';
  };

  it('breaks GST out as CGST + SGST and totals the payable figure', () => {
    const text = printed(intraStateGst, '161660.00');
    expect(text).toContain('Taxable Value (INR)');
    expect(text).toContain('1,37,000.00');
    expect(text).toContain('CGST @ 9%');
    expect(text).toContain('SGST @ 9%');
    expect(text).toContain('12,330.00');
    // The payable total, and the words that follow it, are the grand total —
    // printing the pre-tax figure here is what the supplier would invoice against.
    expect(text).toContain('1,61,660.00');
    expect(text).toContain(
      'Rupees One Lakh Sixty-One Thousand Six Hundred Sixty Only',
    );
    expect(text).toContain('Inclusive of GST as shown above');
    expect(text).toContain('Place of supply: Karnataka');
    expect(text).not.toContain('IGST');
  });

  it('puts the whole rate on IGST for a supplier outside the state', () => {
    const text = printed(interStateGst, '161660.00');
    expect(text).toContain('IGST @ 18%');
    expect(text).toContain('24,660.00');
    expect(text).toContain('Place of supply: Tamil Nadu');
    expect(text).not.toContain('CGST');
    expect(text).not.toContain('SGST');
  });

  it('keeps the tax-exclusive caption when the order carries no GST', () => {
    // An order raised before GST reached the PO must print exactly as it did.
    const text = printed(noGst, '137000.00');
    expect(text).toContain(
      'Prices are exclusive of applicable taxes and duties',
    );
    expect(text).not.toContain('Taxable Value (INR)');
    expect(text).not.toContain('CGST');
    expect(text).toContain('1,37,000.00');
  });
});

describe('PurchaseOrderPrintDocument advance terms', () => {
  it('prints the advance as a payment term with its rupee value', () => {
    const { container } = render(
      <PurchaseOrderPrintDocument po={po(advance)} generatedOn="2026-09-02" />,
    );
    const text = container.textContent ?? '';
    expect(text).toContain('Payment terms');
    expect(text).toContain('30.00%');
    expect(text).toContain('41,100.00');
    expect(text).toContain('before delivery');
  });

  it('falls back to the indicative value before the PO is issued', () => {
    const { container } = render(
      <PurchaseOrderPrintDocument
        po={po({ ...advance, amount: null, indicativeAmount: '41100.00' })}
        generatedOn="2026-09-02"
      />,
    );
    expect(container.textContent).toContain('41,100.00');
  });

  it('says nothing about payment terms when there is no advance', () => {
    const { container } = render(
      <PurchaseOrderPrintDocument po={po(null)} generatedOn="2026-09-02" />,
    );
    expect(container.textContent).not.toContain('Payment terms');
  });
});
