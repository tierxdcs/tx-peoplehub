import { Prisma } from '@prisma/client';
import {
  computePurchaseOrderGst,
  gstStateCodeFromGstin,
  normaliseGstStateCode,
} from './purchase-order-gst';

const d = (v: string | number) => new Prisma.Decimal(v);
const rates = (igst: string, cgst: string, sgst: string) => ({
  igstRate: d(igst),
  cgstRate: d(cgst),
  sgstRate: d(sgst),
});

/**
 * The tax arithmetic behind a purchase order. What matters here is not the
 * percentages but the three things a supplier's invoice will be matched against:
 * the split follows the supplier's registration, each tax rounds to paise on its
 * own, and the taxable value is never touched by any of it.
 */
describe('gstStateCodeFromGstin', () => {
  it('reads the state from the first two digits', () => {
    expect(gstStateCodeFromGstin('29AARCP3898H1ZG')).toBe('29');
    expect(gstStateCodeFromGstin('  33GSPTN0000A1Z5 ')).toBe('33');
  });

  it('returns null rather than guessing for a party with no usable GSTIN', () => {
    // An unregistered supplier is a real case; inventing a state for one would
    // put the wrong tax on the order.
    expect(gstStateCodeFromGstin(null)).toBeNull();
    expect(gstStateCodeFromGstin(undefined)).toBeNull();
    expect(gstStateCodeFromGstin('')).toBeNull();
    expect(gstStateCodeFromGstin('9')).toBeNull();
    // 99 is not a state code, so the prefix is not trusted just for being two
    // characters long.
    expect(gstStateCodeFromGstin('99AARCP3898H1ZG')).toBeNull();
  });
});

describe('normaliseGstStateCode', () => {
  it('keeps a code the state table knows', () => {
    expect(normaliseGstStateCode('33')).toBe('33');
    expect(normaliseGstStateCode(' 29 ')).toBe('29');
  });

  it("falls back to the company's own state for anything else", () => {
    expect(normaliseGstStateCode(null)).toBe('29');
    expect(normaliseGstStateCode('')).toBe('29');
    expect(normaliseGstStateCode('99')).toBe('29');
  });
});

describe('computePurchaseOrderGst', () => {
  it('splits 18% as CGST + SGST for a supplier in our own state', () => {
    const gst = computePurchaseOrderGst(
      d('137000'),
      '29',
      rates('0', '9', '9'),
    );

    expect(gst.intraState).toBe(true);
    expect(gst.stateName).toBe('Karnataka');
    expect(gst.cgstAmount.toFixed(2)).toBe('12330.00');
    expect(gst.sgstAmount.toFixed(2)).toBe('12330.00');
    expect(gst.igstAmount.toFixed(2)).toBe('0.00');
    expect(gst.totalTax.toFixed(2)).toBe('24660.00');
    expect(gst.grandTotal.toFixed(2)).toBe('161660.00');
  });

  it('puts the whole rate on IGST for a supplier outside it', () => {
    const gst = computePurchaseOrderGst(
      d('137000'),
      '33',
      rates('18', '0', '0'),
    );

    expect(gst.intraState).toBe(false);
    expect(gst.stateName).toBe('Tamil Nadu');
    expect(gst.igstAmount.toFixed(2)).toBe('24660.00');
    expect(gst.totalTax.toFixed(2)).toBe('24660.00');
    expect(gst.grandTotal.toFixed(2)).toBe('161660.00');
  });

  it('rounds each tax to paise on its own', () => {
    // 9% of 1,111.11 is 99.9999. Rounding the halves separately is what the
    // supplier's invoice does, so the order has to agree with it rather than
    // rounding one combined figure and landing a paisa off.
    const gst = computePurchaseOrderGst(
      d('1111.11'),
      '29',
      rates('0', '9', '9'),
    );
    expect(gst.cgstAmount.toFixed(2)).toBe('100.00');
    expect(gst.sgstAmount.toFixed(2)).toBe('100.00');
    expect(gst.totalTax.toFixed(2)).toBe('200.00');
    expect(gst.grandTotal.toFixed(2)).toBe('1311.11');
  });

  it('leaves the taxable value alone when there are no rates', () => {
    // Every order raised before GST reached the PO reads this way, and must keep
    // reading this way: a zero-rated order is a tax-exclusive commitment.
    const gst = computePurchaseOrderGst(
      d('137000'),
      '29',
      rates('0', '0', '0'),
    );
    expect(gst.totalTax.toFixed(2)).toBe('0.00');
    expect(gst.grandTotal.toFixed(2)).toBe('137000.00');
  });

  it('falls back to our own state for a code it does not recognise', () => {
    const gst = computePurchaseOrderGst(d('100'), '99', rates('0', '9', '9'));
    expect(gst.stateCode).toBe('29');
    expect(gst.stateName).toBe('Karnataka');
    expect(gst.intraState).toBe(true);
  });

  it('reports the rates back unchanged, for the printed order', () => {
    const gst = computePurchaseOrderGst(
      d('100'),
      '29',
      rates('0', '2.5', '2.5'),
    );
    expect(gst.cgstRate.toFixed(2)).toBe('2.50');
    expect(gst.sgstRate.toFixed(2)).toBe('2.50');
    expect(gst.totalTax.toFixed(2)).toBe('5.00');
  });
});
