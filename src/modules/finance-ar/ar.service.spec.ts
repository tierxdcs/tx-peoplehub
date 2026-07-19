import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ArService } from './ar.service';

describe('ArService invoice calculations', () => {
  const service = new ArService({} as any, {} as any, {} as any, {} as any, {} as any);
  const calculate = (line: Record<string, unknown>) =>
    (service as any).calculateLine(line, 0);

  it('calculates discounted taxable value and IGST using Decimal arithmetic', () => {
    const line = calculate({
      description: 'Machine', hsnSacCode: '8479', quantity: 2,
      unitOfMeasure: 'NOS', unitPrice: 1000, discountPercent: 10,
      igstRate: 18,
    });
    expect(line.taxableAmount.toString()).toBe('1800');
    expect(line.igstAmount.toString()).toBe('324');
    expect(line.lineTotal.toString()).toBe('2124');
  });

  it('calculates equal CGST and SGST for intra-state supply', () => {
    const line = calculate({
      description: 'Service', hsnSacCode: '9983', quantity: 1,
      unitOfMeasure: 'EA', unitPrice: 1000, cgstRate: 9, sgstRate: 9,
    });
    expect(line.cgstAmount.toString()).toBe('90');
    expect(line.sgstAmount.toString()).toBe('90');
    expect(line.lineTotal.toString()).toBe('1180');
  });

  it('rejects simultaneous IGST and CGST/SGST', () => {
    expect(() => calculate({
      description: 'Invalid', hsnSacCode: '1', quantity: 1,
      unitOfMeasure: 'EA', unitPrice: 100, igstRate: 18,
      cgstRate: 9, sgstRate: 9,
    })).toThrow(BadRequestException);
  });

  it('rejects unequal CGST and SGST rates', () => {
    expect(() => calculate({
      description: 'Invalid', hsnSacCode: '1', quantity: 1,
      unitOfMeasure: 'EA', unitPrice: 100, cgstRate: 9, sgstRate: 8,
    })).toThrow(BadRequestException);
  });
});
