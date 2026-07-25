import { describe, expect, it } from 'vitest';
import { plmTrackerHref } from './plm';

describe('plmTrackerHref', () => {
  it('opens a tracker through the PLM-authorized route, not the Sales order route', () => {
    expect(plmTrackerHref('tracker-1')).toBe('/plm/trackers/tracker-1');
    expect(plmTrackerHref('tracker/unsafe')).toBe(
      '/plm/trackers/tracker%2Funsafe',
    );
  });
});
