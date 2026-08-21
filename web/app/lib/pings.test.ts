import { describe, expect, it } from 'vitest';
import { DASHBOARD_RESOLVED_TTL_MS, orderReceivedForDashboard, type PingStatus, type ReceivedPing } from './pings';

const NOW = Date.parse('2026-08-21T12:00:00.000Z');
const HOUR = 3_600_000;

function ping(id: string, status: PingStatus, opts: { createdHoursAgo?: number; resolvedHoursAgo?: number } = {}): ReceivedPing {
  const createdAt = new Date(NOW - (opts.createdHoursAgo ?? 1) * HOUR).toISOString();
  const respondedAt = opts.resolvedHoursAgo === undefined ? null : new Date(NOW - opts.resolvedHoursAgo * HOUR).toISOString();
  return {
    id,
    status,
    respondedAt,
    ping: { id: `p-${id}`, message: id, linkedRecordType: null, linkedRecordId: null, createdAt, fromEmployee: { id: 'e1', fullName: 'Sender', email: 's@t.com', employeeId: 'EMP-1' } },
  };
}

describe('orderReceivedForDashboard', () => {
  it('orders pending, then acknowledged, then resolved', () => {
    const rows = [ping('resolved', 'RESOLVED', { resolvedHoursAgo: 1 }), ping('pending', 'PENDING'), ping('ack', 'ACKNOWLEDGED', { resolvedHoursAgo: 1 })];
    expect(orderReceivedForDashboard(rows, NOW).map((r) => r.id)).toEqual(['pending', 'ack', 'resolved']);
  });

  it('surfaces the oldest pending ping first (most overdue on top)', () => {
    const rows = [ping('newer', 'PENDING', { createdHoursAgo: 2 }), ping('older', 'PENDING', { createdHoursAgo: 30 })];
    expect(orderReceivedForDashboard(rows, NOW).map((r) => r.id)).toEqual(['older', 'newer']);
  });

  it('shows the most recently handled ping first within acknowledged/resolved', () => {
    const rows = [ping('stale', 'ACKNOWLEDGED', { createdHoursAgo: 10 }), ping('fresh', 'ACKNOWLEDGED', { createdHoursAgo: 1 })];
    expect(orderReceivedForDashboard(rows, NOW).map((r) => r.id)).toEqual(['fresh', 'stale']);
  });

  it('keeps resolved pings resolved within the last two days', () => {
    const rows = [ping('recent', 'RESOLVED', { resolvedHoursAgo: 47 })];
    expect(orderReceivedForDashboard(rows, NOW).map((r) => r.id)).toEqual(['recent']);
  });

  it('drops resolved pings older than two days but keeps pending/acknowledged of any age', () => {
    const rows = [
      ping('old-resolved', 'RESOLVED', { resolvedHoursAgo: 49 }),
      ping('old-pending', 'PENDING', { createdHoursAgo: 500 }),
      ping('old-ack', 'ACKNOWLEDGED', { resolvedHoursAgo: 500 }),
    ];
    expect(orderReceivedForDashboard(rows, NOW).map((r) => r.id)).toEqual(['old-pending', 'old-ack']);
  });

  it('treats the two-day boundary as exclusive', () => {
    const exactly = [ping('boundary', 'RESOLVED', { resolvedHoursAgo: DASHBOARD_RESOLVED_TTL_MS / HOUR })];
    expect(orderReceivedForDashboard(exactly, NOW)).toHaveLength(0);
  });

  it('does not mutate the input array', () => {
    const rows = [ping('resolved', 'RESOLVED', { resolvedHoursAgo: 1 }), ping('pending', 'PENDING')];
    const snapshot = rows.map((r) => r.id);
    orderReceivedForDashboard(rows, NOW);
    expect(rows.map((r) => r.id)).toEqual(snapshot);
  });
});
