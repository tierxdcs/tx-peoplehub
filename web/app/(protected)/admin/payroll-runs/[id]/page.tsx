'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Lock } from 'lucide-react';
import { apiFetch, ApiError } from '../../../../lib/api';
import { Employee, PayrollRun, Payslip } from '../../../../lib/types';
import { formatINR } from '../../../../lib/sales';
import { PageContainer } from '../../../../components/ui/page-container';
import { Card, CardContent } from '../../../../components/ui/card';
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
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export default function PayrollRunDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const confirm = useConfirm();
  const [run, setRun] = useState<PayrollRun | null>(null);
  const [payslips, setPayslips] = useState<Payslip[]>([]);
  const [employeeNames, setEmployeeNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [processError, setProcessError] = useState<string | null>(null);
  const [locking, setLocking] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const runRes = await apiFetch<PayrollRun>(`/payroll-runs/${id}`);
      setRun(runRes);

      if (runRes.status === 'COMPLETED' || runRes.status === 'LOCKED') {
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

  async function handleLock() {
    const ok = await confirm({
      title: 'Lock this payroll run?',
      description:
        'Once locked, this run cannot be edited — corrections require a new adjustment in a future period.',
      confirmLabel: 'Lock',
      destructive: true,
    });
    if (!ok) return;
    setLocking(true);
    try {
      await apiFetch(`/payroll-runs/${id}/lock`, { method: 'PATCH' });
      await load();
    } catch (err) {
      setProcessError(
        err instanceof ApiError ? err.message : 'Failed to lock run',
      );
    } finally {
      setLocking(false);
    }
  }

  if (loading) {
    return (
      <PageContainer className="max-w-4xl">
        <Skeleton className="mb-4 h-6 w-24" />
        <Skeleton className="mb-6 h-9 w-64" />
        <Skeleton className="h-40 w-full" />
      </PageContainer>
    );
  }
  if (error || !run) {
    return (
      <PageContainer className="max-w-4xl">
        <p className="text-destructive">{error ?? 'Payroll run not found.'}</p>
      </PageContainer>
    );
  }

  return (
    <PageContainer className="max-w-4xl">
      <button
        onClick={() => router.push('/admin/payroll-runs')}
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Payroll Runs
      </button>

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">
          {MONTH_NAMES[run.month - 1]} {run.year}
        </h1>
        <StatusBadge value={run.status} />
      </div>

      <Card className="mb-6">
        <CardContent className="grid gap-6 p-6 sm:grid-cols-3">
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              Status
            </div>
            <div className="mt-1"><StatusBadge value={run.status} /></div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              Processed at
            </div>
            <div className="mt-1 text-sm font-medium">
              {run.processedAt ? new Date(run.processedAt).toLocaleString() : '—'}
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              Locked at
            </div>
            <div className="mt-1 text-sm font-medium">
              {run.lockedAt ? new Date(run.lockedAt).toLocaleString() : '—'}
            </div>
          </div>
        </CardContent>
      </Card>

      {run.status === 'DRAFT' && (
        <Card className="mb-6">
          <CardContent className="flex flex-col gap-3 p-6">
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
              <p className="max-w-xl text-sm text-destructive">{processError}</p>
            )}
          </CardContent>
        </Card>
      )}

      {run.status === 'PROCESSING' && (
        <Card className="mb-6">
          <CardContent className="p-6 text-sm text-muted-foreground">
            Processing is in progress…
          </CardContent>
        </Card>
      )}

      {(run.status === 'COMPLETED' || run.status === 'LOCKED') && (
        <>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Payslips</h2>
            {run.status === 'COMPLETED' && (
              <Button variant="outline" size="sm" onClick={handleLock} disabled={locking}>
                <Lock className="size-4" /> {locking ? 'Locking…' : 'Lock Run'}
              </Button>
            )}
            {run.status === 'LOCKED' && (
              <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                <Lock className="size-4" /> Locked — cannot be edited
              </span>
            )}
          </div>
          {processError && (
            <p className="mb-3 text-sm text-destructive">{processError}</p>
          )}
          <Card>
            <CardContent className="p-0">
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
                        <TableCell className="text-right">{formatINR(p.grossEarnings)}</TableCell>
                        <TableCell className="text-right font-medium">{formatINR(p.netPay)}</TableCell>
                        <TableCell><StatusBadge value={p.status} /></TableCell>
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
            </CardContent>
          </Card>
        </>
      )}
    </PageContainer>
  );
}
