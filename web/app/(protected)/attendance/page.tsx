'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiFetch, ApiError } from '../../lib/api';
import { todayDateStr } from '../../lib/date';
import { Attendance, PaginatedResult } from '../../lib/types';

export default function MyAttendancePage() {
  const [history, setHistory] = useState<Attendance[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState(false);
  const limit = 20;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<PaginatedResult<Attendance>>(
        `/attendance/me?page=${page}&limit=${limit}`,
      );
      setHistory(res.items);
      setTotal(res.total);
    } catch {
      setError('Failed to load attendance history');
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    load();
  }, [load]);

  const today = todayDateStr();
  const todayRecord = history.find((a) => a.date.slice(0, 10) === today);

  async function handleCheckIn() {
    setActing(true);
    try {
      await apiFetch('/attendance/check-in', { method: 'POST' });
      await load();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Check-in failed');
    } finally {
      setActing(false);
    }
  }

  async function handleCheckOut() {
    setActing(true);
    try {
      await apiFetch('/attendance/check-out', { method: 'POST' });
      await load();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Check-out failed');
    } finally {
      setActing(false);
    }
  }

  return (
    <div>
      <h1>My Attendance</h1>

      {error && <p style={{ color: 'crimson' }}>{error}</p>}
      {loading ? (
        <p>Loading…</p>
      ) : (
        <>
          <div style={{ marginBottom: 24 }}>
            {todayRecord?.status === 'ON_LEAVE' ? (
              <p style={{ fontSize: 18 }}>
                You are on approved leave today — no check-in required.
              </p>
            ) : !todayRecord?.checkInTime ? (
              <button
                onClick={handleCheckIn}
                disabled={acting}
                style={{ padding: '16px 32px', fontSize: 18 }}
              >
                Check In
              </button>
            ) : !todayRecord?.checkOutTime ? (
              <button
                onClick={handleCheckOut}
                disabled={acting}
                style={{ padding: '16px 32px', fontSize: 18 }}
              >
                Check Out
              </button>
            ) : (
              <button disabled style={{ padding: '16px 32px', fontSize: 18 }}>
                Done for today
              </button>
            )}
          </div>

          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid #ccc' }}>
                <th>Date</th>
                <th>Check In</th>
                <th>Check Out</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {history.map((a) => (
                <tr key={a.id} style={{ borderBottom: '1px solid #eee' }}>
                  <td>{a.date.slice(0, 10)}</td>
                  <td>
                    {a.checkInTime
                      ? new Date(a.checkInTime).toLocaleTimeString()
                      : '—'}
                  </td>
                  <td>
                    {a.checkOutTime
                      ? new Date(a.checkOutTime).toLocaleTimeString()
                      : '—'}
                  </td>
                  <td>{a.status}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
            <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Prev
            </button>
            <span>
              Page {page} of {Math.max(1, Math.ceil(total / limit))}
            </span>
            <button
              disabled={page * limit >= total}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </button>
          </div>
        </>
      )}
    </div>
  );
}
