import { Prisma } from '@prisma/client';
import {
  awardWasLowest,
  monthlyAverage,
  monthlyCount,
  ratePercent,
  trendDirection,
} from './scm-dashboard.math';

const d = (value: string) => new Prisma.Decimal(value);

describe('scm-dashboard.math', () => {
  describe('ratePercent', () => {
    it('is a percentage of the whole', () => {
      expect(ratePercent(3, 4)?.toFixed(2)).toBe('75.00');
    });

    it('is null when nobody was asked, never 0%', () => {
      // 0% would read as "nobody responded"; the truth is "nobody was invited".
      expect(ratePercent(0, 0)).toBeNull();
      expect(ratePercent(5, -1)).toBeNull();
    });

    it('is 0 when people were asked and nobody answered', () => {
      expect(ratePercent(0, 7)?.toFixed(2)).toBe('0.00');
    });
  });

  describe('trendDirection', () => {
    it('has no direction from a single measured month', () => {
      expect(trendDirection([12])).toBeNull();
      expect(trendDirection([null, 12, null])).toBeNull();
      expect(trendDirection([])).toBeNull();
    });

    it('reads a sustained increase as rising', () => {
      expect(trendDirection([10, 12, 20, 24])).toBe('RISING');
    });

    it('reads a sustained decrease as falling', () => {
      expect(trendDirection([30, 28, 12, 10])).toBe('FALLING');
    });

    it('treats a move under 5% of the earlier mean as flat', () => {
      // 100 → 102 is 2%: noise, not a supply-stress signal.
      expect(trendDirection([100, 100, 102, 102])).toBe('FLAT');
      expect(trendDirection([100, 100, 120, 120])).toBe('RISING');
    });

    it('ignores months with no data rather than reading them as zero', () => {
      // A quiet month must not drag the mean down into a false FALLING.
      expect(trendDirection([10, null, null, 20])).toBe('RISING');
    });

    it('compares halves, so one outlier month does not flip the verdict', () => {
      // Last point is lower than the first, but the second half is still higher.
      expect(trendDirection([10, 10, 40, 11])).toBe('RISING');
    });
  });

  describe('monthlyAverage', () => {
    const rows = [
      { monthKey: '2026-04', value: 10 },
      { monthKey: '2026-04', value: 20 },
      { monthKey: '2026-06', value: 7 },
    ];

    it('averages the values falling in each bucket, to one decimal', () => {
      expect(monthlyAverage(rows, ['2026-04'])).toEqual([
        { key: '2026-04', value: 15 },
      ]);
      expect(
        monthlyAverage(
          [
            { monthKey: '2026-04', value: 10 },
            { monthKey: '2026-04', value: 11 },
            { monthKey: '2026-04', value: 11 },
          ],
          ['2026-04'],
        ),
      ).toEqual([{ key: '2026-04', value: 10.7 }]);
    });

    it('leaves an empty bucket null so the line breaks instead of collapsing', () => {
      expect(monthlyAverage(rows, ['2026-04', '2026-05', '2026-06'])).toEqual([
        { key: '2026-04', value: 15 },
        { key: '2026-05', value: null },
        { key: '2026-06', value: 7 },
      ]);
    });

    it('ignores values outside the requested buckets', () => {
      expect(monthlyAverage(rows, ['2026-05'])).toEqual([
        { key: '2026-05', value: null },
      ]);
    });
  });

  describe('monthlyCount', () => {
    it('counts occurrences per bucket', () => {
      expect(
        monthlyCount(
          ['2026-04', '2026-04', '2026-06'],
          ['2026-04', '2026-05', '2026-06'],
        ),
      ).toEqual([
        { key: '2026-04', value: 2 },
        // Zero, not null: "no NCR was raised in May" is a fact, not a gap.
        { key: '2026-05', value: 0 },
        { key: '2026-06', value: 1 },
      ]);
    });

    it('returns a zero for every bucket when nothing happened', () => {
      expect(monthlyCount([], ['2026-04', '2026-05'])).toEqual([
        { key: '2026-04', value: 0 },
        { key: '2026-05', value: 0 },
      ]);
    });
  });

  describe('awardWasLowest', () => {
    it('is true when the awarded total is the lowest received', () => {
      expect(awardWasLowest(d('100.00'), [d('100.00'), d('120.00')])).toBe(
        true,
      );
    });

    it('is false when a cheaper quote was on the table', () => {
      expect(awardWasLowest(d('120.00'), [d('100.00'), d('120.00')])).toBe(
        false,
      );
    });

    it('is true for a tie — the award needed no justification either', () => {
      expect(awardWasLowest(d('100.00'), [d('100.00'), d('100.00')])).toBe(
        true,
      );
    });

    it('uses exact decimal equality, matching the award gate', () => {
      // 100.00 and 100.001 are different totals: the award gate would have
      // demanded a justification, so this must not round them together.
      expect(awardWasLowest(d('100.001'), [d('100.00')])).toBe(false);
    });

    it('is null when there is nothing to compare against', () => {
      expect(awardWasLowest(d('100.00'), [])).toBeNull();
    });

    it('is true for a single quote that is also the award', () => {
      expect(awardWasLowest(d('100.00'), [d('100.00')])).toBe(true);
    });
  });
});
