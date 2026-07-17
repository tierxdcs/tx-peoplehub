import { Prisma } from '@prisma/client';
import {
  baseRequirement,
  classifyAvailability,
  grossRequirement,
  round,
  wastageQuantity,
} from './stock-calc';

const D = (n: number | string) => new Prisma.Decimal(n);

describe('stock-calc requirement math', () => {
  it('computes base = quantityPerUnit * orderedQuantity', () => {
    expect(baseRequirement(D('2.5'), D('10')).toString()).toBe('25');
  });

  it('computes wastage = base * (percent/100)', () => {
    // 25 * 10% = 2.5
    expect(wastageQuantity(D('25'), D('10')).toString()).toBe('2.5');
  });

  it('computes gross = base + wastage', () => {
    expect(grossRequirement(D('25'), D('2.5')).toString()).toBe('27.5');
  });

  it('rounds to 4 decimal places, half-up', () => {
    // 1/3 * 1 = 0.3333..., wastage 0% → base 0.3333
    expect(baseRequirement(D('0.333333'), D('1')).toString()).toBe('0.3333');
    expect(round(D('0.12345')).toString()).toBe('0.1235');
  });

  it('full worked example: 3 per unit, 100 ordered, 5% wastage → 315', () => {
    const base = baseRequirement(D('3'), D('100')); // 300
    const w = wastageQuantity(base, D('5')); // 15
    const gross = grossRequirement(base, w); // 315
    expect(base.toString()).toBe('300');
    expect(w.toString()).toBe('15');
    expect(gross.toString()).toBe('315');
  });
});

describe('classifyAvailability', () => {
  const zero = D(0);

  it('UNKNOWN when there is no stock record', () => {
    const r = classifyAvailability({
      hasStockRecord: false,
      gross: D('10'),
      effectiveAvailable: zero,
      expectedReceiptQuantity: zero,
      expectedInTime: false,
    });
    expect(r.status).toBe('UNKNOWN');
    expect(r.shortage.toString()).toBe('10');
  });

  it('AVAILABLE when effective available covers gross (with surplus)', () => {
    const r = classifyAvailability({
      hasStockRecord: true,
      gross: D('10'),
      effectiveAvailable: D('15'),
      expectedReceiptQuantity: zero,
      expectedInTime: false,
    });
    expect(r.status).toBe('AVAILABLE');
    expect(r.surplus.toString()).toBe('5');
    expect(r.shortage.toString()).toBe('0');
  });

  it('AVAILABLE at the exact boundary (available == gross)', () => {
    const r = classifyAvailability({
      hasStockRecord: true,
      gross: D('10'),
      effectiveAvailable: D('10'),
      expectedReceiptQuantity: zero,
      expectedInTime: false,
    });
    expect(r.status).toBe('AVAILABLE');
    expect(r.surplus.toString()).toBe('0');
  });

  it('EXPECTED when receipts cover the deficit and arrive in time', () => {
    const r = classifyAvailability({
      hasStockRecord: true,
      gross: D('10'),
      effectiveAvailable: D('4'),
      expectedReceiptQuantity: D('6'),
      expectedInTime: true,
    });
    expect(r.status).toBe('EXPECTED_BEFORE_REQUIRED_DATE');
    expect(r.shortage.toString()).toBe('6');
  });

  it('SHORTAGE when receipts are enough but NOT in time', () => {
    const r = classifyAvailability({
      hasStockRecord: true,
      gross: D('10'),
      effectiveAvailable: D('4'),
      expectedReceiptQuantity: D('6'),
      expectedInTime: false,
    });
    expect(r.status).toBe('SHORTAGE');
    expect(r.shortage.toString()).toBe('6');
  });

  it('SHORTAGE when receipts are insufficient', () => {
    const r = classifyAvailability({
      hasStockRecord: true,
      gross: D('10'),
      effectiveAvailable: D('4'),
      expectedReceiptQuantity: D('3'),
      expectedInTime: true,
    });
    expect(r.status).toBe('SHORTAGE');
    expect(r.shortage.toString()).toBe('6');
  });
});
