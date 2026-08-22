import { combinedEfficiency, pingSla, taskSla } from './efficiency-score';

describe('efficiency score', () => {
  it('counts acknowledgements and resolutions within 24 hours equally', () => {
    const createdAt = new Date('2026-08-01T10:00:00Z');
    const result = pingSla([
      { createdAt, respondedAt: new Date('2026-08-02T10:00:00Z'), status: 'ACKNOWLEDGED' },
      { createdAt, respondedAt: new Date('2026-08-01T10:10:00Z'), status: 'RESOLVED' },
      { createdAt, respondedAt: new Date('2026-08-02T10:00:01Z'), status: 'RESOLVED' },
      { createdAt, respondedAt: null, status: 'PENDING' },
    ]);
    expect(result).toEqual({ percentage: 50, onTime: 2, total: 4 });
  });

  it('scores only decided due-date outcomes supplied by the service', () => {
    const result = taskSla([
      { dueDate: new Date('2026-08-10T00:00:00Z'), completedAt: new Date('2026-08-10T23:59:59Z') },
      { dueDate: new Date('2026-08-10T00:00:00Z'), completedAt: new Date('2026-08-11T00:00:00Z') },
      { dueDate: new Date('2026-08-09T00:00:00Z'), completedAt: null },
    ]);
    expect(result).toEqual({ percentage: 33, onTime: 1, total: 3 });
  });

  it('requires both comparable inputs for the 50/50 headline score', () => {
    expect(combinedEfficiency(
      { percentage: 90, onTime: 9, total: 10 },
      { percentage: 74, onTime: 14, total: 19 },
    )).toBe(82);
    expect(combinedEfficiency(
      { percentage: null, onTime: 0, total: 0 },
      { percentage: 100, onTime: 1, total: 1 },
    )).toBeNull();
  });
});
