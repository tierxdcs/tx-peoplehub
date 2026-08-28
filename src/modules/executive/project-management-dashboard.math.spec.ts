import {
  average,
  breachRate,
  bucketAges,
  countHealth,
  imbalancePercent,
  ratePercent,
  relativeLoadPercent,
} from './project-management-dashboard.math';

describe('project management dashboard math', () => {
  describe('ratePercent', () => {
    it('returns a fixed-2 share', () => {
      expect(ratePercent(1, 3)).toBe('33.33');
      expect(ratePercent(3, 4)).toBe('75.00');
    });

    it('returns null rather than 0 when there is no whole to divide by', () => {
      expect(ratePercent(0, 0)).toBeNull();
      expect(ratePercent(5, -1)).toBeNull();
    });

    it('reports a genuine zero as zero', () => {
      expect(ratePercent(0, 8)).toBe('0.00');
    });
  });

  describe('average', () => {
    it('rounds to one decimal', () => {
      expect(average([1, 2, 2])).toBe(1.7);
      expect(average([10])).toBe(10);
    });

    it('is null for an empty set, never 0', () => {
      expect(average([])).toBeNull();
    });
  });

  describe('countHealth', () => {
    it('counts each health state and the total', () => {
      expect(
        countHealth(['ON_TRACK', 'BLOCKED', 'AT_RISK', 'BLOCKED']),
      ).toEqual({ onTrack: 1, atRisk: 1, blocked: 2, total: 4 });
    });

    it('returns zeros with a zero total for no projects', () => {
      expect(countHealth([])).toEqual({
        onTrack: 0,
        atRisk: 0,
        blocked: 0,
        total: 0,
      });
    });
  });

  describe('relativeLoadPercent', () => {
    it('scales against the busiest carrier, so the peak reads 100', () => {
      expect(relativeLoadPercent(40, 40)).toBe('100.00');
      expect(relativeLoadPercent(10, 40)).toBe('25.00');
    });

    it('is null when nobody carries anything', () => {
      expect(relativeLoadPercent(0, 0)).toBeNull();
    });
  });

  describe('imbalancePercent', () => {
    it('is 0 when the load is spread evenly', () => {
      expect(imbalancePercent([20, 20, 20])).toBe('0.00');
    });

    it('is 100 when one carrier holds everything', () => {
      expect(imbalancePercent([60, 0, 0])).toBe('100.00');
      expect(imbalancePercent([5, 0])).toBe('100.00');
    });

    it('reads the same for an uneven split regardless of the total size', () => {
      expect(imbalancePercent([30, 10])).toBe(imbalancePercent([300, 100]));
    });

    it('needs at least two carriers to mean anything', () => {
      expect(imbalancePercent([40])).toBeNull();
      expect(imbalancePercent([])).toBeNull();
    });

    it('is null when there is no load at all', () => {
      expect(imbalancePercent([0, 0, 0])).toBeNull();
    });
  });

  describe('bucketAges', () => {
    it('places each age in exactly one bucket, including the boundaries', () => {
      const buckets = bucketAges([0, 7, 8, 30, 31, 90, 91, 400]);
      expect(buckets.map((bucket) => bucket.count)).toEqual([2, 2, 2, 2]);
      expect(buckets.map((bucket) => bucket.key)).toEqual([
        '0-7',
        '8-30',
        '31-90',
        '90+',
      ]);
    });

    it('returns every bucket at zero for an empty set, keeping the chart shape', () => {
      expect(bucketAges([]).map((bucket) => bucket.count)).toEqual([
        0, 0, 0, 0,
      ]);
    });
  });

  describe('breachRate', () => {
    it('counts values at or beyond the threshold', () => {
      expect(breachRate([1, 24, 100], 24)).toBe('66.67');
    });

    it('is null with nothing to measure', () => {
      expect(breachRate([], 24)).toBeNull();
    });
  });
});
