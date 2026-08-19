'use client';

import { useEffect, useMemo, useState } from 'react';
import { IndianRupee } from 'lucide-react';
import { apiFetch, ApiError } from '../../../lib/api';
import {
  CtcBreakdown,
  CtcBreakdownRow,
  Employee,
  PaginatedResult,
  SalaryStructure,
} from '../../../lib/types';
import { formatINR } from '../../../lib/sales';
import {
  NumberFormatStyle,
  useNumberFormat,
} from '../../../lib/number-format-context';
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
  const { style: numberFormatStyle } = useNumberFormat();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [search, setSearch] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [history, setHistory] = useState<SalaryStructure[]>([]);
  const [loadingRecord, setLoadingRecord] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [showBreakdown, setShowBreakdown] = useState(false);

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
      setHistory([]);
      return;
    }
    setLoadingRecord(true);
    setError(null);
    try {
      const historyRes = await apiFetch<SalaryStructure[]>(
        `/salary-structures/${id}/history`,
      );
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
  // History is ordered newest-first, so the latest revision is the one to show
  // as the "current" structure. A revision effective in the future (e.g. comp
  // dated to a future joining date) is still shown here, flagged as upcoming,
  // rather than leaving the card reading "none on file".
  const latest = history[0] ?? null;
  const todayStr = new Date().toISOString().slice(0, 10);
  const latestIsUpcoming = !!latest && latest.effectiveFrom.slice(0, 10) > todayStr;

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
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-semibold">Current structure</h2>
                  {latestIsUpcoming && (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-950/60 dark:text-amber-200">
                      Upcoming
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {latest && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setShowBreakdown(true)}
                    >
                      View CTC breakdown
                    </Button>
                  )}
                  <Button size="sm" onClick={() => setShowForm(true)}>
                    Update structure
                  </Button>
                </div>
              </div>
              {latest ? (
                <>
                  {latestIsUpcoming && (
                    <p className="mb-3 text-sm text-muted-foreground">
                      This revision takes effect on{' '}
                      {latest.effectiveFrom.slice(0, 10)} and isn&apos;t in
                      effect for payroll yet.
                    </p>
                  )}
                  <dl className="grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-3">
                    <StatItem label="Effective from" value={latest.effectiveFrom.slice(0, 10)} />
                    <StatItem label="Basic" value={formatINR(latest.basic, numberFormatStyle)} />
                    <StatItem label="HRA" value={formatINR(latest.hra, numberFormatStyle)} />
                    <StatItem label="Special allowance" value={formatINR(latest.specialAllowance, numberFormatStyle)} />
                    <StatItem label="Other allowances" value={latest.otherAllowances ? formatINR(latest.otherAllowances, numberFormatStyle) : '—'} />
                    <StatItem label="Variable pay (annual)" value={latest.variablePay ? formatINR(latest.variablePay, numberFormatStyle) : '—'} />
                    <StatItem label="Annual CTC" value={formatINR(latest.ctcAnnual, numberFormatStyle)} emphasize />
                  </dl>
                </>
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
                      <TableHead className="text-right">Variable</TableHead>
                      <TableHead className="text-right">Annual CTC</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {history.map((h) => (
                      <TableRow key={h.id}>
                        <TableCell>{h.effectiveFrom.slice(0, 10)}</TableCell>
                        <TableCell className="text-right">{formatINR(h.basic, numberFormatStyle)}</TableCell>
                        <TableCell className="text-right">{formatINR(h.hra, numberFormatStyle)}</TableCell>
                        <TableCell className="text-right">{formatINR(h.specialAllowance, numberFormatStyle)}</TableCell>
                        <TableCell className="text-right">{h.otherAllowances ? formatINR(h.otherAllowances, numberFormatStyle) : '—'}</TableCell>
                        <TableCell className="text-right">{h.variablePay ? formatINR(h.variablePay, numberFormatStyle) : '—'}</TableCell>
                        <TableCell className="text-right font-medium">{formatINR(h.ctcAnnual, numberFormatStyle)}</TableCell>
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

      {showBreakdown && selectedEmployee && (
        <CtcBreakdownDialog
          employeeName={`${selectedEmployee.firstName} ${selectedEmployee.lastName}`}
          employeeId={employeeId}
          asOf={latest?.effectiveFrom.slice(0, 10)}
          onClose={() => setShowBreakdown(false)}
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

function CtcBreakdownDialog({
  employeeName,
  employeeId,
  asOf,
  onClose,
}: {
  employeeName: string;
  employeeId: string;
  asOf?: string;
  onClose: () => void;
}) {
  const { style: numberFormatStyle } = useNumberFormat();
  const [data, setData] = useState<CtcBreakdown | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    const url = asOf
      ? `/salary-structures/${employeeId}/ctc-breakdown?asOf=${asOf}`
      : `/salary-structures/${employeeId}/ctc-breakdown`;
    apiFetch<CtcBreakdown>(url)
      .then((res) => {
        if (active) setData(res);
      })
      .catch((err) => {
        if (active) {
          setError(
            err instanceof ApiError ? err.message : 'Failed to load breakdown',
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [employeeId, asOf]);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>CTC breakdown — {employeeName}</DialogTitle>
          <DialogDescription>
            Fully derived from the current salary structure. Statutory rows
            (PF/ESI/PT and employer contributions) are computed the same way
            payroll computes them — nothing here is stored. TDS is not computed;
            Net Take Home is shown before TDS.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="space-y-3 py-2">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : error ? (
          <p className="py-4 text-sm text-destructive">{error}</p>
        ) : data ? (
          <div className="space-y-6">
            {data.warnings.length > 0 && (
              <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/40 dark:text-amber-200">
                <p className="font-medium">
                  Some statutory rates aren&apos;t configured yet
                </p>
                <p className="mt-1">
                  These rows show &ldquo;—&rdquo; and are excluded from the CTC
                  until set up in Statutory Config: {data.warnings.join(', ')}.
                </p>
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              Effective from {data.effectiveFrom.slice(0, 10)}
            </p>

            <BreakdownSection
              title="Direct Components"
              rows={data.directComponents}
              numberFormatStyle={numberFormatStyle}
            />
            <BreakdownSection
              title="Deductions from Employee Side"
              rows={data.employeeDeductions}
              numberFormatStyle={numberFormatStyle}
            />
            <BreakdownSection
              title="Other Indirect Benefits"
              rows={data.indirectBenefits}
              numberFormatStyle={numberFormatStyle}
            />
            <BreakdownSection
              title="Grand Total CTC"
              rows={[data.grandTotal]}
              numberFormatStyle={numberFormatStyle}
            />
          </div>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BreakdownSection({
  title,
  rows,
  numberFormatStyle,
}: {
  title: string;
  rows: CtcBreakdownRow[];
  numberFormatStyle: NumberFormatStyle;
}) {
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Component</TableHead>
            <TableHead className="text-right">Per Month</TableHead>
            <TableHead className="text-right">Per Annum</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, i) => (
            <TableRow key={`${row.label}-${i}`}>
              <TableCell className={row.emphasize ? 'font-semibold' : undefined}>
                {row.label}
              </TableCell>
              {row.note ? (
                <TableCell
                  colSpan={2}
                  className="text-right text-muted-foreground"
                >
                  {row.note}
                </TableCell>
              ) : (
                <>
                  <TableCell
                    className={
                      row.emphasize
                        ? 'text-right font-semibold'
                        : 'text-right'
                    }
                  >
                    {row.perMonth
                      ? formatINR(row.perMonth, numberFormatStyle)
                      : '—'}
                  </TableCell>
                  <TableCell
                    className={
                      row.emphasize
                        ? 'text-right font-semibold'
                        : 'text-right'
                    }
                  >
                    {row.perAnnum
                      ? formatINR(row.perAnnum, numberFormatStyle)
                      : '—'}
                  </TableCell>
                </>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/** Reverse-solved breakdown from POST /salary-structures/preview-ctc. */
type CompensationPreview = {
  branch: 'PF_CAPPED' | 'PF_UNCAPPED';
  monthlyCtc: string;
  annualCtc: string;
  grossMonthly: string;
  basicMonthly: string;
  hraMonthly: string;
  conveyanceMonthly: string;
  otherAllowanceMonthly: string;
  professionalTaxMonthly: string;
  employeePfMonthly: string;
  employeeEsiMonthly: string | null;
  employerPfAnnual: string;
  totalDeductionsMonthly: string;
  netSalaryMonthly: string;
  totalAnnualisedSalary: string;
  insuranceAnnual: string;
  incentiveAnnual: string;
  totalCompanyContributionsAnnual: string;
  totalEmolumentsAnnual: string;
};

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
  const { style: numberFormatStyle } = useNumberFormat();
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [monthlyCtc, setMonthlyCtc] = useState('');
  const [preview, setPreview] = useState<CompensationPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Live reverse-solve preview — the exact same calculation the server runs on
  // save, so what's shown is what gets stored.
  useEffect(() => {
    if (!monthlyCtc || Number(monthlyCtc) <= 0 || !effectiveFrom) {
      setPreview(null);
      setPreviewError(null);
      return;
    }
    let active = true;
    const handle = setTimeout(() => {
      apiFetch<CompensationPreview>('/salary-structures/preview-ctc', {
        method: 'POST',
        body: JSON.stringify({
          monthlyCtc: Number(monthlyCtc),
          effectiveDate: effectiveFrom,
        }),
      })
        .then((res) => {
          if (!active) return;
          setPreview(res);
          setPreviewError(null);
        })
        .catch((err) => {
          if (!active) return;
          setPreview(null);
          setPreviewError(
            err instanceof ApiError ? err.message : 'Failed to calculate',
          );
        });
    }, 350);
    return () => {
      active = false;
      clearTimeout(handle);
    };
  }, [monthlyCtc, effectiveFrom]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!effectiveFrom || !monthlyCtc || Number(monthlyCtc) <= 0) {
      setError('Effective date and a positive monthly CTC are required');
      return;
    }
    if (!preview) {
      setError('Wait for the calculated breakdown before saving');
      return;
    }
    setSubmitting(true);
    try {
      await apiFetch('/salary-structures/from-ctc', {
        method: 'POST',
        body: JSON.stringify({
          employeeId,
          monthlyCtc: Number(monthlyCtc),
          effectiveDate: effectiveFrom,
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
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Update structure — {employeeName}</DialogTitle>
          <DialogDescription>
            Enter the new monthly CTC — the full breakdown is recalculated
            automatically (same engine as onboarding). Saving appends a new
            effective-dated entry; it never overwrites history.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Effective from" required>
              <Input
                type="date"
                value={effectiveFrom}
                onChange={(e) => setEffectiveFrom(e.target.value)}
              />
            </Field>
            <Field label="Monthly CTC" required>
              <Input
                type="number"
                min={0}
                value={monthlyCtc}
                onChange={(e) => setMonthlyCtc(e.target.value)}
              />
            </Field>
          </div>

          {previewError && (
            <p className="text-sm text-destructive">{previewError}</p>
          )}

          {preview && (
            <div className="space-y-4 rounded-md border bg-muted/40 p-4">
              <div className="flex items-center justify-between">
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  System-calculated salary structure
                </div>
                <div className="font-semibold">
                  Annual CTC{' '}
                  {formatINR(Number(preview.annualCtc), numberFormatStyle)}
                </div>
              </div>
              <PreviewSection
                title="Monthly earnings"
                rows={[
                  ['Basic', preview.basicMonthly],
                  ['HRA', preview.hraMonthly],
                  ['Conveyance', preview.conveyanceMonthly],
                  ['Other Allowance', preview.otherAllowanceMonthly],
                  ['Total Monthly Salary', preview.grossMonthly],
                ]}
                numberFormatStyle={numberFormatStyle}
              />
              <PreviewSection
                title="Monthly deductions"
                rows={[
                  ['Professional Tax (PT)', preview.professionalTaxMonthly],
                  ['Employee PF', preview.employeePfMonthly],
                  ['Employee ESI', preview.employeeEsiMonthly],
                  ['Total Deductions', preview.totalDeductionsMonthly],
                  ['Net Salary', preview.netSalaryMonthly],
                ]}
                numberFormatStyle={numberFormatStyle}
              />
              <PreviewSection
                title="Annual company contributions"
                rows={[
                  ['Total Annualised Salary', preview.totalAnnualisedSalary],
                  ['Employer PF', preview.employerPfAnnual],
                  ['Insurance (PA)', preview.insuranceAnnual],
                  ['Incentive', preview.incentiveAnnual],
                  [
                    'Total Company Contributions',
                    preview.totalCompanyContributionsAnnual,
                  ],
                  ['Total Emoluments per Annum', preview.totalEmolumentsAnnual],
                ]}
                numberFormatStyle={numberFormatStyle}
              />
              <p className="text-xs text-muted-foreground">
                ESI is shown only when applicable. TDS remains “as applicable”
                and is calculated during payroll.
              </p>
            </div>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting || !preview}>
              {submitting ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PreviewSection({
  title,
  rows,
  numberFormatStyle,
}: {
  title: string;
  rows: Array<[string, string | null]>;
  numberFormatStyle: NumberFormatStyle;
}) {
  return (
    <div>
      <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      <dl className="space-y-1">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-center justify-between text-sm">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="font-medium">
              {value ? formatINR(Number(value), numberFormatStyle) : '—'}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
