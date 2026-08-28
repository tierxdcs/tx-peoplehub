import { Prisma } from '@prisma/client';
import {
  averageNumber,
  completionPercent,
  dispatchFacilitySegment,
  premiumOverLowest,
} from './operations-dashboard.math';

const d = (n: string | number) => new Prisma.Decimal(n);

describe('dispatchFacilitySegment', () => {
  it('is IN_HOUSE only when every split on the challan was made in-house', () => {
    expect(dispatchFacilitySegment(['IN_HOUSE', 'IN_HOUSE'])).toBe('IN_HOUSE');
  });

  it('is OTHER when no split was made in-house', () => {
    expect(dispatchFacilitySegment(['VENDOR', 'NPD'])).toBe('OTHER');
  });

  it('is MIXED when the challan carries both — so it is credited to neither', () => {
    expect(dispatchFacilitySegment(['IN_HOUSE', 'VENDOR'])).toBe('MIXED');
  });

  it('ignores unclassified splits rather than treating them as vendor work', () => {
    expect(dispatchFacilitySegment(['IN_HOUSE', null])).toBe('IN_HOUSE');
    expect(dispatchFacilitySegment([null, 'VENDOR'])).toBe('OTHER');
  });

  it('is UNCLASSIFIED when nothing on the challan was ever classified', () => {
    expect(dispatchFacilitySegment([])).toBe('UNCLASSIFIED');
    expect(dispatchFacilitySegment([null, null])).toBe('UNCLASSIFIED');
  });
});

describe('averageNumber', () => {
  it('averages to one decimal', () => {
    expect(averageNumber([1, 2, 4])).toBe(2.3);
  });

  it('is null for an empty set, never 0', () => {
    expect(averageNumber([])).toBeNull();
  });

  it('keeps a genuine zero average', () => {
    expect(averageNumber([0, 0])).toBe(0);
  });
});

describe('completionPercent', () => {
  it('rounds to whole percent', () => {
    expect(completionPercent(1, 3)).toBe(33);
    expect(completionPercent(2, 3)).toBe(67);
  });

  it('is null when there are no cards — unmeasured, not 0% done', () => {
    expect(completionPercent(0, 0)).toBeNull();
  });

  it('is 0 when cards exist but none are done', () => {
    expect(completionPercent(0, 8)).toBe(0);
  });
});

describe('premiumOverLowest', () => {
  it('is zero when the lowest quote won', () => {
    const result = premiumOverLowest(d('1000'), d('1000'));
    expect(result.amount.toFixed(2)).toBe('0.00');
    expect(result.percent?.toFixed(2)).toBe('0.00');
  });

  it('reports the amount and share paid above the lowest quote', () => {
    const result = premiumOverLowest(d('1200'), d('1000'));
    expect(result.amount.toFixed(2)).toBe('200.00');
    expect(result.percent?.toFixed(2)).toBe('20.00');
  });

  it('has no percentage when the lowest quote was zero', () => {
    const result = premiumOverLowest(d('500'), d('0'));
    expect(result.amount.toFixed(2)).toBe('500.00');
    expect(result.percent).toBeNull();
  });
});
