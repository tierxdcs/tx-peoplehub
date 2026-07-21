'use client';

import { useEffect, useMemo, useState } from 'react';
import { IndianRupee } from 'lucide-react';
import { apiFetch, ApiError } from '../../../lib/api';
import { Employee, PaginatedResult, SalaryStructure } from '../../../lib/types';
import { formatINR } from '../../../lib/sales';
import { PageContainer } from '../../../components/ui/page-container';
import { PageHeader } from '../../../components/ui/page-header';
import { Card, CardContent } from '../../../components/ui/card';
import { Input } from '../../../components/ui/input';
import { Select } from '../../../components/ui/select';
import { Field } from '../../../components/ui/field';
import { Button } from '../../../components/ui/button';
import { Skeleton } from '../../../components/ui/skeleton';
import { EmptyState } from '../../../components/ui/empty-state';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '../../../components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../components/ui/table';

export default function SalaryStructuresPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [search, setSearch] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [current, setCurrent] = useState<SalaryStructure | null>(null);
  const [history, setHistory] = useState<SalaryStructure[]>([]);
  const [loadingRecord, setLoadingRecord] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

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

  async function loadFor(id: string) {
    if (!id) {
      setCurrent(null);
      setHistory([]);
      return;
    }
    setLoadingRecord(true);
    setError(null);
    try {
      const [currentRes, historyRes] = await Promise.all([
        apiFetch<SalaryStructure | null>(`/salary-structures/${id}/current`),
        apiFetch<SalaryStructure[]>(`/salary-structures/${id}/history`),
      ]);
      setCurrent(currentRes);
      setHistory(historyRes);
    } catch {
      setError('Failed to load salary structure');
    } finally {
      setLoadingRecord(false);
    }
  }

  useEffect(() => {
    loadFor(employeeId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employeeId]);

  const selectedEmployee = employees.find((e) => e.id === employeeId);

  return (
    <PageContainer className="max-w-4xl">
      <PageHeader
        title="Salary Structures"
        description="View an employee's current CTC breakdown and its effective-dated history. Updates never overwrite history."
      />

      <Card className="mb-4">
        <CardContent className="grid gap-4 p-4 sm:grid-cols-2">
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
        </CardContent>
      </Card>

      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

      {!employeeId ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center text-muted-foreground">
            <IndianRupee className="size-8" />
            <p className="text-sm">
              Select an employee to view their salary structure.
            </p>
          </CardContent>
        </Card>
      ) : loadingRecord ? (
        <Card>
          <CardContent className="space-y-3 p-6">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-24 w-full" />
          </CardContent>
        </Card>
      ) : (
        <>
          <Card className="mb-6">
            <CardContent className="p-6">
              <div className="mb-4 flex items-center justify-between gap-3">
                <h2 className="text-lg font-semibold">Current structure</h2>
                <Button size="sm" onClick={() => setShowForm(true)}>
                  Update structure
                </Button>
              </div>
              {current ? (
                <dl className="grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-3">
                  <StatItem label="Effective from" value={current.effectiveFrom.slice(0, 10)} />
                  <StatItem label="Basic" value={formatINR(current.basic)} />
                  <StatItem label="HRA" value={formatINR(current.hra)} />
                  <StatItem label="Special allowance" value={formatINR(current.specialAllowance)} />
                  <StatItem label="Other allowances" value={current.otherAllowances ? formatINR(current.otherAllowances) : '—'} />
                  <StatItem label="Annual CTC" value={formatINR(current.ctcAnnual)} emphasize />
                </dl>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No salary structure on file for this employee yet.
                </p>
              )}
            </CardContent>
          </Card>

          <h2 className="mb-3 text-lg font-semibold">History</h2>
          <Card>
            <CardContent className="p-0">
              {history.length === 0 ? (
                <EmptyState
                  icon={IndianRupee}
                  title="No history yet"
                  description="Salary revisions will appear here, newest first."
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Effective From</TableHead>
                      <TableHead className="text-right">Basic</TableHead>
                      <TableHead className="text-right">HRA</TableHead>
                      <TableHead className="text-right">Special</TableHead>
                      <TableHead className="text-right">Other</TableHead>
                      <TableHead className="text-right">Annual CTC</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {history.map((h) => (
                      <TableRow key={h.id}>
                        <TableCell>{h.effectiveFrom.slice(0, 10)}</TableCell>
                        <TableCell className="text-right">{formatINR(h.basic)}</TableCell>
                        <TableCell className="text-right">{formatINR(h.hra)}</TableCell>
                        <TableCell className="text-right">{formatINR(h.specialAllowance)}</TableCell>
                        <TableCell className="text-right">{h.otherAllowances ? formatINR(h.otherAllowances) : '—'}</TableCell>
                        <TableCell className="text-right font-medium">{formatINR(h.ctcAnnual)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {showForm && selectedEmployee && (
        <UpdateStructureForm
          employeeName={`${selectedEmployee.firstName} ${selectedEmployee.lastName}`}
          employeeId={employeeId}
          onClose={() => setShowForm(false)}
          onSaved={() => {
            setShowForm(false);
            loadFor(employeeId);
          }}
        />
      )}
    </PageContainer>
  );
}

function StatItem({
  label,
  value,
  emphasize,
}: {
  label: string;
  value: string;
  emphasize?: boolean;
}) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className={emphasize ? 'text-lg font-semibold' : 'font-medium'}>
        {value}
      </dd>
    </div>
  );
}

function UpdateStructureForm({
  employeeName,
  employeeId,
  onClose,
  onSaved,
}: {
  employeeName: string;
  employeeId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [basic, setBasic] = useState('');
  const [hra, setHra] = useState('');
  const [specialAllowance, setSpecialAllowance] = useState('');
  const [otherAllowances, setOtherAllowances] = useState('');
  const [ctcAnnual, setCtcAnnual] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!effectiveFrom || !basic || !hra || !ctcAnnual) {
      setError('Effective date, basic, HRA, and annual CTC are required');
      return;
    }
    setSubmitting(true);
    try {
      await apiFetch('/salary-structures', {
        method: 'POST',
        body: JSON.stringify({
          employeeId,
          effectiveFrom,
          basic: Number(basic),
          hra: Number(hra),
          specialAllowance: specialAllowance ? Number(specialAllowance) : 0,
          otherAllowances: otherAllowances ? Number(otherAllowances) : undefined,
          ctcAnnual: Number(ctcAnnual),
        }),
      });
      onSaved();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Failed to save structure',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Update structure — {employeeName}</DialogTitle>
          <DialogDescription>
            Creates a new effective-dated entry; it does not overwrite existing
            history.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Field label="Effective from" required>
            <Input type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Basic" required>
              <Input type="number" min={0} value={basic} onChange={(e) => setBasic(e.target.value)} />
            </Field>
            <Field label="HRA" required>
              <Input type="number" min={0} value={hra} onChange={(e) => setHra(e.target.value)} />
            </Field>
            <Field label="Special allowance">
              <Input type="number" min={0} value={specialAllowance} onChange={(e) => setSpecialAllowance(e.target.value)} />
            </Field>
            <Field label="Other allowances">
              <Input type="number" min={0} value={otherAllowances} onChange={(e) => setOtherAllowances(e.target.value)} />
            </Field>
          </div>
          <Field label="Annual CTC" required>
            <Input type="number" min={0} value={ctcAnnual} onChange={(e) => setCtcAnnual(e.target.value)} />
          </Field>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
