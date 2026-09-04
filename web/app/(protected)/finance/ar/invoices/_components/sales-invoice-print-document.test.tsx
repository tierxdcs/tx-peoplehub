import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { COMPANY } from '../../../../../lib/theme';
import {
  SalesInvoicePrintDocument,
  supplierAddressText,
} from './sales-invoice-print-document';

const supplier = {
  legalName: 'Phaze Dynamics India Private Limited',
  gstin: '29AARCP3898H1ZG',
  addressLine1: '173, Industrial Suburb, 2nd Stage',
  addressLine2: null,
  city: 'Bengaluru',
  state: 'Karnataka',
  stateCode: '29',
  postalCode: '560022',
};

const invoice = {
  supplier,
  invoiceNumber: 'INV-2026-0002',
  invoiceDate: '2026-09-02T00:00:00.000Z',
  dueDate: '2026-10-02T00:00:00.000Z',
  customerPoReference: null,
  customerGstinSnapshot: null,
  placeOfSupplyState: 'Karnataka',
  placeOfSupplyStateCode: '29',
  billingAddressSnapshot: { line1: '123 TEST', state: 'KA' },
  shippingAddressSnapshot: { line1: '123 TEST', state: 'KA' },
  subtotal: '694864.29',
  discountAmount: '0',
  taxableAmount: '694864.29',
  cgstAmount: '62537.79',
  sgstAmount: '62537.79',
  igstAmount: '0',
  otherCharges: '0',
  roundOff: '0',
  totalAmount: '819939.87',
  paymentTerms: null,
  irn: null,
  irnAcknowledgementNumber: null,
  irnAcknowledgementDate: null,
  signedQrCode: null,
  eWayBillNumber: null,
  customer: { name: 'Company Liquid Cooling' },
  order: { orderNumber: 'ORD-2026-0001' },
  lines: [
    {
      id: 'line-1',
      description: 'Cooling unit with Manifold',
      hsnSacCode: 'HDS892',
      quantity: '3',
      unitOfMeasure: 'each',
      unitPrice: '231621.43',
      discountPercent: '0',
      taxableAmount: '694864.29',
      lineTotal: '819939.87',
      product: { name: 'Cooling unit with Manifold', sku: 'FG-00004' },
    },
  ],
  approvedBy: null,
};

describe('SalesInvoicePrintDocument supplier block', () => {
  it('prints the supplier’s GSTIN, registered name and address', () => {
    render(
      <SalesInvoicePrintDocument invoice={invoice} generatedOn="2026-09-02" />,
    );

    expect(screen.getByText('GSTIN: 29AARCP3898H1ZG')).toBeTruthy();
    // Registered name appears twice: the Rule 46 block and the signatory line.
    expect(
      screen.getAllByText(/Phaze Dynamics India Private Limited/).length,
    ).toBeGreaterThanOrEqual(2);
    // Full single-line address — the footer prints the same street on its own
    // line, so match through the city to stay unambiguous.
    expect(
      screen.getByText(
        '173, Industrial Suburb, 2nd Stage, Bengaluru, Karnataka, 560022',
      ),
    ).toBeTruthy();
  });

  it('prints the company bank details for customer payment', () => {
    render(
      <SalesInvoicePrintDocument invoice={invoice} generatedOn="2026-09-02" />,
    );

    expect(screen.getByText("Company's Bank Details")).toBeTruthy();
    expect(screen.getByText("A/c Holder's Name")).toBeTruthy();
    expect(
      screen.getByText('PHAZE DYNAMICS INDIA PRIVATE LIMITED'),
    ).toBeTruthy();
    expect(screen.getByText('ICICI BANK')).toBeTruthy();
    expect(screen.getByText('777705031248')).toBeTruthy();
    expect(screen.getByText('MALLESWARAM & ICIC0000078')).toBeTruthy();
  });

  it('names one legal entity only, preferring the statutory record', () => {
    const renamed = {
      ...invoice,
      supplier: { ...supplier, legalName: 'Phaze Dynamics Pvt Ltd' },
    };
    render(
      <SalesInvoicePrintDocument invoice={renamed} generatedOn="2026-09-02" />,
    );

    expect(screen.getByText(/^For /).textContent).toBe(
      'For Phaze Dynamics Pvt Ltd',
    );
  });

  it('falls back to the letterhead entity when settings are unset', () => {
    render(
      <SalesInvoicePrintDocument
        invoice={{ ...invoice, supplier: null }}
        generatedOn="2026-09-02"
      />,
    );

    expect(screen.queryByText(/^GSTIN: 29/)).toBeNull();
    expect(screen.getByText(/^For /).textContent).toBe(
      `For ${COMPANY.legalEntityName}`,
    );
  });
});

describe('supplierAddressText', () => {
  it('joins the parts that are present, skipping a blank second line', () => {
    expect(supplierAddressText(supplier)).toBe(
      '173, Industrial Suburb, 2nd Stage, Bengaluru, Karnataka, 560022',
    );
  });

  it('includes the second address line when it is set', () => {
    expect(
      supplierAddressText({ ...supplier, addressLine2: 'Yeshwanthpur' }),
    ).toContain('2nd Stage, Yeshwanthpur, Bengaluru');
  });
});
