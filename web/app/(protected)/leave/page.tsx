'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch, ApiError } from '../../lib/api';
import { addDaysStr, inclusiveDaySpan, todayDateStr } from '../../lib/date';
import {
  Employee,
  LeaveBalance,
  LeaveRequest,
  LeaveType,
  PaginatedResult,
} from '../../lib/types';

const fieldStyle: React.CSSProperties = {
  width: '100%',
  padding: 8,
  boxSizing: 'border-box',
};

export default function MyLeavePage() {
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([]);
  const [balances, setBalances] = useState<LeaveBalance[]>([]);
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [approverNames, setApproverNames] = useState<Record<string, string>>(
    {},
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const limit = 20;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [typesRes, balancesRes, requestsRes] = await Promise.all([
        apiFetch<LeaveType[]>('/leave-types'),
        apiFetch<LeaveBalance[]>('/leave-balances/me'),
        apiFetch<PaginatedResult<LeaveRequest>>(
          `/leave-requests/me?page=${page}&limit=${limit}`,
        ),
      ]);
      setLeaveTypes(typesRes);
      setBalances(balancesRes);
      setRequests(requestsRes.items);
      setTotal(requestsRes.total);

      const approverIds = [
        ...new Set(
          requestsRes.items
            .map((r) => r.approverId)
            .filter((id): id is string => !!id),
        ),
      ];
      const resolved: Record<string, string> = {};
      await Promise.all(
        approverIds.map(async (id) => {
          try {
            const emp = await apiFetch<Employee>(`/employees/${id}`);
            resolved[id] = `${emp.firstName} ${emp.lastName}`;
          } catch {
            resolved[id] = 'Admin';
          }
        }),
      );
      setApproverNames(resolved);
    } catch {
      setError('Failed to load leave data');
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    load();
  }, [load]);

  const leaveTypeName = (id: string) =>
    leaveTypes.find((t) => t.id === id)?.name ?? '—';

  const today = todayDateStr();

  async function handleCancel(id: string) {
    if (!confirm('Cancel this leave request?')) return;
    try {
      await apiFetch(`/leave-requests/${id}/cancel`, { method: 'PATCH' });
      await load();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Failed to cancel');
    }
  }

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          marginBottom: 16,
        }}
      >
        <h1>My Leave</h1>
        <button style={{ padding: '8px 16px' }} onClick={() => setShowForm(true)}>
          Request Leave
        </button>
      </div>

      {error && <p style={{ color: 'crimson' }}>{error}</p>}
      {loading ? (
        <p>Loading…</p>
      ) : (
        <>
          <div
            style={{
              display: 'flex',
              gap: 12,
              marginBottom: 24,
              flexWrap: 'wrap',
            }}
          >
            {leaveTypes.map((t) => {
              const balance = balances.find((b) => b.leaveTypeId === t.id);
              const unlimited = t.accrualType === 'UNTRACKED';
              return (
                <div
                  key={t.id}
                  style={{
                    border: '1px solid #ccc',
                    borderRadius: 6,
                    padding: 12,
                    minWidth: 160,
                  }}
                >
                  <div style={{ fontWeight: 'bold' }}>
                    {t.name} ({t.code})
                  </div>
                  {unlimited ? (
                    <div style={{ marginTop: 8, color: '#666' }}>
                      Unlimited
                    </div>
                  ) : balance ? (
                    <div style={{ marginTop: 8 }}>
                      <div>Allocated: {balance.allocated}</div>
                      <div>Used: {balance.used}</div>
                      <div style={{ fontWeight: 'bold' }}>
                        Remaining: {balance.remaining}
                      </div>
                    </div>
                  ) : (
                    <div style={{ marginTop: 8, color: '#666' }}>—</div>
                  )}
                </div>
              );
            })}
          </div>

          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid #ccc' }}>
                <th>Type</th>
                <th>Dates</th>
                <th>Days</th>
                <th>Status</th>
                <th>Approver</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {requests.map((r) => {
                const canCancel =
                  r.status === 'PENDING' ||
                  (r.status === 'APPROVED' && r.startDate.slice(0, 10) > today);
                return (
                  <tr key={r.id} style={{ borderBottom: '1px solid #eee' }}>
                    <td>{leaveTypeName(r.leaveTypeId)}</td>
                    <td>
                      {r.startDate.slice(0, 10)} → {r.endDate.slice(0, 10)}
                    </td>
                    <td>{r.numberOfDays}</td>
                    <td>{r.status}</td>
                    <td>
                      {r.approverId
                        ? approverNames[r.approverId] ?? '…'
                        : '—'}
                    </td>
                    <td>
                      {canCancel && (
                        <button onClick={() => handleCancel(r.id)}>
                          Cancel
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
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

      {showForm && (
        <RequestLeaveForm
          leaveTypes={leaveTypes.filter((t) => t.isActive)}
          onClose={() => setShowForm(false)}
          onSubmitted={() => {
            setShowForm(false);
            load();
          }}
        />
      )}
    </div>
  );
}

function RequestLeaveForm({
  leaveTypes,
  onClose,
  onSubmitted,
}: {
  leaveTypes: LeaveType[];
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const today = todayDateStr();
  const [leaveTypeId, setLeaveTypeId] = useState(leaveTypes[0]?.id ?? '');
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [halfDay, setHalfDay] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const numberOfDays = useMemo(() => {
    if (halfDay) return 0.5;
    if (endDate < startDate) return 0;
    return inclusiveDaySpan(startDate, endDate);
  }, [halfDay, startDate, endDate]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!leaveTypeId) {
      setError('Leave type is required');
      return;
    }
    if (endDate < startDate) {
      setError('End date cannot be before start date');
      return;
    }
    if (!reason.trim()) {
      setError('Reason is required');
      return;
    }

    setSubmitting(true);
    try {
      await apiFetch('/leave-requests', {
        method: 'POST',
        body: JSON.stringify({
          leaveTypeId,
          startDate,
          endDate: halfDay ? startDate : endDate,
          numberOfDays,
          reason,
        }),
      });
      onSubmitted();
    } catch (err) {
      // Surface the backend's specific message verbatim (e.g. the overlap
      // conflict) rather than a generic failure string.
      setError(
        err instanceof ApiError ? err.message : 'Failed to submit request',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      onClick={onClose}
    >
      <form
        onSubmit={handleSubmit}
        style={{ background: '#fff', padding: 24, borderRadius: 6, width: 400 }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2>Request Leave</h2>

        <div style={{ marginBottom: 12 }}>
          <label style={{ display: 'block', marginBottom: 4 }}>
            Leave type
          </label>
          <select
            value={leaveTypeId}
            onChange={(e) => setLeaveTypeId(e.target.value)}
            style={fieldStyle}
          >
            {leaveTypes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.code})
              </option>
            ))}
          </select>
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={{ display: 'block', marginBottom: 4 }}>
            Start date
          </label>
          <input
            type="date"
            value={startDate}
            onChange={(e) => {
              setStartDate(e.target.value);
              if (e.target.value > endDate) setEndDate(e.target.value);
            }}
            style={fieldStyle}
          />
        </div>

        {!halfDay && (
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', marginBottom: 4 }}>
              End date
            </label>
            <input
              type="date"
              value={endDate}
              min={startDate}
              onChange={(e) => setEndDate(e.target.value)}
              style={fieldStyle}
            />
          </div>
        )}

        <div style={{ marginBottom: 12 }}>
          <label>
            <input
              type="checkbox"
              checked={halfDay}
              onChange={(e) => setHalfDay(e.target.checked)}
            />{' '}
            Half day
          </label>
        </div>

        <div style={{ marginBottom: 12, color: '#666' }}>
          Number of days: {numberOfDays}
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={{ display: 'block', marginBottom: 4 }}>Reason</label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            style={{ ...fieldStyle, minHeight: 60 }}
          />
        </div>

        {error && <p style={{ color: 'crimson' }}>{error}</p>}

        <div style={{ display: 'flex', gap: 8 }}>
          <button type="submit" disabled={submitting} style={{ padding: 8 }}>
            {submitting ? 'Submitting…' : 'Submit'}
          </button>
          <button type="button" onClick={onClose} style={{ padding: 8 }}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
