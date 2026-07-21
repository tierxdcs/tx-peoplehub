'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, CalendarClock } from 'lucide-react';
import { apiFetch, ApiError } from '../../../lib/api';
import { todayDateStr } from '../../../lib/date';
import { Attendance, Employee, PaginatedResult } from '../../../lib/types';
import { PageContainer } from '../../../components/ui/page-container';
import { PageHeader } from '../../../components/ui/page-header';
import { Card, CardContent } from '../../../components/ui/card';
import { Input } from '../../../components/ui/input';
import { Select } from '../../../components/ui/select';
import { Field } from '../../../components/ui/field';
import { Button } from '../../../components/ui/button';
import { Skeleton } from '../../../components/ui/skeleton';
import { StatusBadge } from '../../../components/ui/status-badge';
import { useConfirm } from '../../../components/ui/confirm';

function toLocalInputValue(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

export default function AttendanceCorrectionsPage() {
  const confirm = useConfirm();
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
    const ok = await confirm({
      title: 'Save attendance correction?',
      description: 'This will be recorded as an admin correction and audited.',
      confirmLabel: 'Save correction',
    });
    if (!ok) return;
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

  const selectedEmployee = employees.find((e) => e.id === employeeId);

  return (
    <PageContainer className="max-w-2xl">
      <PageHeader
        title="Attendance Corrections"
        description="Manually create or correct an employee's attendance for a specific date. Every change is audited."
      />

      {/* Selection card — pick who and which day. */}
      <Card className="mb-4">
        <CardContent className="grid gap-4 p-4 sm:grid-cols-3">
          <Field label="Search employee">
            <Input
              placeholder="Name, ID, or email"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </Field>
          <Field label="Employee">
            <Select
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
            >
              <option value="">Select an employee…</option>
              {options.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.firstName} {e.lastName} ({e.employeeId})
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Date">
            <Input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </Field>
        </CardContent>
      </Card>

      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

      {!employeeId ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center text-muted-foreground">
            <CalendarClock className="size-8" />
            <p className="text-sm">
              Select an employee and date to view or correct their attendance.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-6">
            {loadingRecord ? (
              <div className="space-y-4">
                <Skeleton className="h-4 w-64" />
                <Skeleton className="h-9 w-full" />
                <Skeleton className="h-9 w-full" />
              </div>
            ) : (
              <>
                {/* Context line: who, and the current state for that date. */}
                <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
                  {selectedEmployee && (
                    <span className="font-medium">
                      {selectedEmployee.firstName} {selectedEmployee.lastName}
                    </span>
                  )}
                  <span className="text-muted-foreground">· {date} ·</span>
                  {existing ? (
                    <>
                      <span className="text-muted-foreground">current:</span>
                      <StatusBadge value={existing.status} />
                    </>
                  ) : (
                    <span className="text-muted-foreground">
                      No existing record — this will create one.
                    </span>
                  )}
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Check-in time">
                    <Input
                      type="datetime-local"
                      value={checkIn}
                      onChange={(e) => setCheckIn(e.target.value)}
                    />
                  </Field>
                  <Field label="Check-out time">
                    <Input
                      type="datetime-local"
                      value={checkOut}
                      onChange={(e) => setCheckOut(e.target.value)}
                    />
                  </Field>
                </div>

                <div className="mt-4 flex items-start gap-2 rounded-md bg-warning/10 p-3 text-sm text-warning">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                  <span>
                    This will be recorded as an admin correction and audited.
                  </span>
                </div>

                <div className="mt-4 flex items-center gap-3 border-t pt-4">
                  <Button onClick={handleSave} disabled={saving}>
                    {saving ? 'Saving…' : 'Save Correction'}
                  </Button>
                  {saved && (
                    <span className="inline-flex items-center gap-1.5 text-sm font-medium text-success">
                      <CheckCircle2 className="size-4" />
                      Saved — status: {saved.status}
                    </span>
                  )}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}
    </PageContainer>
  );
}
