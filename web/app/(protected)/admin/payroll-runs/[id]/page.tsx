'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Send } from 'lucide-react';
import { apiFetch, ApiError } from '../../../../lib/api';
import { Employee, PayrollRun, Payslip } from '../../../../lib/types';
import { formatINR } from '../../../../lib/sales';
import { useNumberFormat } from '../../../../lib/number-format-context';
import {
  SCard,
  SIGNAL_EYEBROW,
  SignalHeader,
  SignalPage,
} from '../../../../components/ui/signal';
import { Button } from '../../../../components/ui/button';
import { Skeleton } from '../../../../components/ui/skeleton';
import { EmptyState } from '../../../../components/ui/empty-state';
import { StatusBadge } from '../../../../components/ui/status-badge';
import { useConfirm } from '../../../../components/ui/confirm';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../../components/ui/table';

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export default function PayrollRunDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const confirm = useConfirm();
  const { style: numberFormatStyle } = useNumberFormat();
  const [run, setRun] = useState<PayrollRun | null>(null);
  const [payslips, setPayslips] = useState<Payslip[]>([]);
  const [employeeNames, setEmployeeNames] = useState<Record<string, string>>(
    {},
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [processError, setProcessError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const runRes = await apiFetch<PayrollRun>(`/payroll-runs/${id}`);
      setRun(runRes);

      if (!['DRAFT', 'PROCESSING'].includes(runRes.status)) {
        const payslipsRes = await apiFetch<Payslip[]>(
          `/payroll-runs/${id}/payslips`,
        );
        setPayslips(payslipsRes);

        const ids = [...new Set(payslipsRes.map((p) => p.employeeId))];
        const resolved: Record<string, string> = {};
        await Promise.all(
          ids.map(async (empId) => {
            try {
              const emp = await apiFetch<Employee>(`/employees/${empId}`);
              resolved[empId] = `${emp.firstName} ${emp.lastName}`;
            } catch {
              resolved[empId] = empId;
            }
          }),
        );
        setEmployeeNames(resolved);
      }
    } catch {
      setError('Failed to load payroll run');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleProcess() {
    const ok = await confirm({
      title: 'Process this payroll run?',
      description:
        'This generates payslips for all active employees using the current statutory config.',
      confirmLabel: 'Process',
    });
    if (!ok) return;
    setProcessing(true);
    setProcessError(null);
    try {
      await apiFetch(`/payroll-runs/${id}/process`, { method: 'POST' });
      await load();
    } catch (err) {
      if (err instanceof ApiError && /StatutoryConfig/i.test(err.message)) {
        setProcessError(
          `Statutory configuration incomplete — cannot process payroll. ${err.message}`,
        );
      } else {
        setProcessError(
          err instanceof ApiError ? err.message : 'Failed to process run',
        );
      }
    } finally {
      setProcessing(false);
    }
  }

  async function handleSubmit() {
    const ok = await confirm({
      title: 'Send payroll to Accounts?',
      description:
        'Accounts will review the control totals. The Finance Head must approve it before salary payment.',
      confirmLabel: 'Send to Accounts',
    });
    if (!ok) return;
    setSubmitting(true);
    try {
      await apiFetch(`/payroll-runs/${id}/submit`, { method: 'POST' });
      await load();
    } catch (err) {
      setProcessError(
        err instanceof ApiError ? err.message : 'Failed to submit payroll',
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <SignalPage>
        <div className="px-5 pb-7 pt-[18px] lg:px-7">
          <Skeleton className="mb-4 h-6 w-24" />
          <Skeleton className="mb-6 h-9 w-64" />
          <Skeleton className="h-40 w-full" />
        </div>
      </SignalPage>
    );
  }
  if (error || !run) {
    return (
      <SignalPage>
        <div className="px-5 pb-7 pt-[18px] lg:px-7">
          <p className="text-destructive">
            {error ?? 'Payroll run not found.'}
          </p>
        </div>
      </SignalPage>
    );
  }

  return (
    <SignalPage>
      <SignalHeader
        backHref="/admin/payroll-runs"
        backLabel="Payroll Runs"
        title={`${MONTH_NAMES[run.month - 1]} ${run.year}`}
        chip={<StatusBadge value={run.status} />}
      />
      <div className="space-y-4 px-5 pb-7 pt-[18px] lg:px-7">
        <SCard className="px-5 py-[18px]">
          <div className="grid gap-6 sm:grid-cols-3">
            <div>
              <div className={SIGNAL_EYEBROW}>Status</div>
              <div className="mt-1">
                <StatusBadge value={run.status} />
              </div>
            </div>
            <div>
              <div className={SIGNAL_EYEBROW}>Processed at</div>
              <div className="mt-1 text-sm font-medium tabular-nums">
                {run.processedAt
                  ? new Date(run.processedAt).toLocaleString()
                  : '—'}
              </div>
            </div>
            <div>
              <div className={SIGNAL_EYEBROW}>Locked at</div>
              <div className="mt-1 text-sm font-medium tabular-nums">
                {run.lockedAt ? new Date(run.lockedAt).toLocaleString() : '—'}
              </div>
            </div>
          </div>
        </SCard>

        {run.status === 'DRAFT' && (
          <SCard className="px-5 py-[18px]">
            <div className="flex flex-col gap-3">
              <p className="text-sm text-muted-foreground">
                Generate payslips for all active employees using the current
                statutory config.
              </p>
              <div>
                <Button onClick={handleProcess} disabled={processing}>
                  {processing ? 'Processing…' : 'Process Payroll'}
                </Button>
              </div>
              {processError && (
                <p className="max-w-xl text-sm text-destructive">
                  {processError}
                </p>
              )}
            </div>
          </SCard>
        )}

        {run.status === 'PROCESSING' && (
          <SCard className="px-5 py-[18px]">
            <p className="text-sm text-muted-foreground">
              Processing is in progress…
            </p>
          </SCard>
        )}

        {!['DRAFT', 'PROCESSING'].includes(run.status) && (
          <div>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-[15px] font-bold">Payslips</h2>
              {run.status === 'COMPLETED' && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleSubmit}
                  disabled={submitting}
                >
                  <Send className="size-4" />{' '}
                  {submitting ? 'Sending…' : 'Send to Accounts'}
                </Button>
              )}
            </div>
            {processError && (
              <p className="mb-3 text-sm text-destructive">{processError}</p>
            )}
            <SCard className="overflow-hidden">
              {payslips.length === 0 ? (
                <EmptyState title="No payslips" />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Employee</TableHead>
                      <TableHead className="text-right">Gross</TableHead>
                      <TableHead className="text-right">Net Pay</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {payslips.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell className="font-medium">
                          {employeeNames[p.employeeId] ?? '…'}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatINR(p.grossEarnings, numberFormatStyle)}
                        </TableCell>
                        <TableCell className="text-right font-medium tabular-nums">
                          {formatINR(p.netPay, numberFormatStyle)}
                        </TableCell>
                        <TableCell>
                          <StatusBadge value={p.status} />
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              router.push(
                                `/admin/payroll-runs/${run.id}/payslips/${p.id}`,
                              )
                            }
                          >
                            View detail
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </SCard>
          </div>
        )}
      </div>
    </SignalPage>
  );
}
