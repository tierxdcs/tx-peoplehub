'use client';

import { useEffect, useMemo, useState } from 'react';
import { apiFetch, ApiError } from '../../../lib/api';
import { todayDateStr } from '../../../lib/date';
import { Attendance, Employee, PaginatedResult } from '../../../lib/types';

function toLocalInputValue(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

export default function AttendanceCorrectionsPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [search, setSearch] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [date, setDate] = useState(todayDateStr());
  const [existing, setExisting] = useState<Attendance | null>(null);
  const [checkIn, setCheckIn] = useState('');
  const [checkOut, setCheckOut] = useState('');
  const [loadingRecord, setLoadingRecord] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<Attendance | null>(null);

  useEffect(() => {
    apiFetch<PaginatedResult<Employee>>('/employees?page=1&limit=100').then(
      (res) => setEmployees(res.items),
    );
  }, []);

  const options = useMemo(() => {
    if (!search) return employees;
    const q = search.toLowerCase();
    return employees.filter((e) =>
      `${e.firstName} ${e.lastName} ${e.employeeId} ${e.email}`
        .toLowerCase()
        .includes(q),
    );
  }, [employees, search]);

  useEffect(() => {
    if (!employeeId || !date) {
      setExisting(null);
      setCheckIn('');
      setCheckOut('');
      return;
    }
    setLoadingRecord(true);
    setError(null);
    setSaved(null);
    apiFetch<Attendance | null>(`/attendance/${employeeId}/${date}`)
      .then((record) => {
        setExisting(record);
        setCheckIn(toLocalInputValue(record?.checkInTime ?? null));
        setCheckOut(toLocalInputValue(record?.checkOutTime ?? null));
      })
      .catch(() => setError('Failed to load existing record'))
      .finally(() => setLoadingRecord(false));
  }, [employeeId, date]);

  async function handleSave() {
    if (!employeeId || !date) return;
    if (
      !confirm(
        'This will be recorded as an admin correction and audited. Continue?',
      )
    ) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const result = await apiFetch<Attendance>(
        `/attendance/${employeeId}/${date}`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            checkInTime: checkIn ? new Date(checkIn).toISOString() : null,
            checkOutTime: checkOut ? new Date(checkOut).toISOString() : null,
          }),
        },
      );
      setExisting(result);
      setSaved(result);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Failed to save correction',
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <h1>Attendance Corrections</h1>

      <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
        <div>
          <label style={{ display: 'block', marginBottom: 4 }}>
            Search employee
          </label>
          <input
            placeholder="Name, ID, or email"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ padding: 6, width: 220 }}
          />
        </div>
        <div>
          <label style={{ display: 'block', marginBottom: 4 }}>Employee</label>
          <select
            value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}
            style={{ padding: 6, width: 220 }}
          >
            <option value="">Select an employee…</option>
            {options.map((e) => (
              <option key={e.id} value={e.id}>
                {e.firstName} {e.lastName} ({e.employeeId})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label style={{ display: 'block', marginBottom: 4 }}>Date</label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            style={{ padding: 6 }}
          />
        </div>
      </div>

      {error && <p style={{ color: 'crimson' }}>{error}</p>}

      {employeeId && date && (
        <div
          style={{
            border: '1px solid #ccc',
            borderRadius: 6,
            padding: 16,
            maxWidth: 420,
          }}
        >
          {loadingRecord ? (
            <p>Loading existing record…</p>
          ) : (
            <>
              <p style={{ color: '#666' }}>
                {existing
                  ? `Existing record found — current status: ${existing.status}`
                  : 'No existing record for this employee/date.'}
              </p>

              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', marginBottom: 4 }}>
                  Check-in time
                </label>
                <input
                  type="datetime-local"
                  value={checkIn}
                  onChange={(e) => setCheckIn(e.target.value)}
                  style={{ padding: 6, width: '100%', boxSizing: 'border-box' }}
                />
              </div>

              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', marginBottom: 4 }}>
                  Check-out time
                </label>
                <input
                  type="datetime-local"
                  value={checkOut}
                  onChange={(e) => setCheckOut(e.target.value)}
                  style={{ padding: 6, width: '100%', boxSizing: 'border-box' }}
                />
              </div>

              <p style={{ color: '#a00', fontSize: 14 }}>
                ⚠ This will be recorded as an admin correction and audited.
              </p>

              <button onClick={handleSave} disabled={saving} style={{ padding: 8 }}>
                {saving ? 'Saving…' : 'Save Correction'}
              </button>

              {saved && (
                <p style={{ marginTop: 12, fontWeight: 'bold' }}>
                  Saved — resulting status: {saved.status}
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
