'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { apiFetch } from '../../../../../../lib/api';
import { Employee, Payslip } from '../../../../../../lib/types';
import { formatINR } from '../../../../../../lib/sales';
import { PageContainer } from '../../../../../../components/ui/page-container';
import { Card, CardContent, CardHeader, CardTitle } from '../../../../../../components/ui/card';
import { Skeleton } from '../../../../../../components/ui/skeleton';

/** One label/value line in an earnings/deductions list. */
function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b py-2 text-sm last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

/**
 * The statutoryConfigSnapshot shape is whatever
 * PayrollComputationService.buildSnapshot() wrote at generation time. Rendered
 * generically so it stays correct if the snapshot's shape evolves.
 */
function ConfigSnapshotCard({ label, config }: { label: string; config: unknown }) {
  if (!config || typeof config !== 'object') {
    return (
      <Card>
        <CardContent className="p-4">
          <div className="font-medium">{label}</div>
          <div className="mt-2 text-sm text-muted-foreground">Not applicable</div>
        </CardContent>
      </Card>
    );
  }
  const c = config as Record<string, unknown>;
  return (
    <Card>
      <CardContent className="p-4">
        <div className="font-medium">{label}</div>
        <div className="mt-1 text-xs text-muted-foreground">
          Effective {String(c.effectiveFrom ?? '').slice(0, 10)}
          {c.effectiveTo ? ` → ${String(c.effectiveTo).slice(0, 10)}` : ' (open-ended)'}
          {c.state ? ` — ${c.state}` : ''}
        </div>
        <pre className="mt-2 overflow-x-auto rounded-md bg-muted p-2 text-xs">
          {JSON.stringify(c.configData ?? {}, null, 2)}
        </pre>
        <div className="mt-2 text-xs text-muted-foreground">
          Source: {String(c.sourceNote ?? '—')}
        </div>
      </CardContent>
    </Card>
  );
}

export default function PayslipDetailPage() {
  const { id, payslipId } = useParams<{ id: string; payslipId: string }>();
  const router = useRouter();
  const [payslip, setPayslip] = useState<Payslip | null>(null);
  const [employeeName, setEmployeeName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<Payslip>(`/payslips/${payslipId}`)
      .then(async (p) => {
        setPayslip(p);
        try {
          const emp = await apiFetch<Employee>(`/employees/${p.employeeId}`);
          setEmployeeName(`${emp.firstName} ${emp.lastName}`);
        } catch {
          setEmployeeName(null);
        }
      })
      .catch(() => setError('Failed to load payslip'))
      .finally(() => setLoading(false));
  }, [payslipId]);

  if (loading) {
    return (
      <PageContainer className="max-w-4xl">
        <Skeleton className="mb-4 h-6 w-24" />
        <Skeleton className="mb-6 h-9 w-64" />
        <Skeleton className="h-64 w-full" />
      </PageContainer>
    );
  }
  if (error || !payslip) {
    return (
      <PageContainer className="max-w-4xl">
        <p className="text-destructive">{error ?? 'Payslip not found.'}</p>
      </PageContainer>
    );
  }

  const snapshot = payslip.statutoryConfigSnapshot as Record<string, unknown>;

  return (
    <PageContainer className="max-w-4xl">
      <button
        onClick={() => router.push(`/admin/payroll-runs/${id}`)}
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Back to run
      </button>

      <h1 className="mb-6 text-2xl font-semibold tracking-tight">
        Payslip — {employeeName ?? payslip.employeeId}
      </h1>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Earnings</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <Row label="Basic" value={formatINR(payslip.basicPaid)} />
            <Row label="HRA" value={formatINR(payslip.hraPaid)} />
            <Row label="Special allowance" value={formatINR(payslip.specialAllowancePaid)} />
            <Row label="Other allowances" value={formatINR(payslip.otherAllowancesPaid)} />
            <Row label="Gross earnings" value={formatINR(payslip.grossEarnings)} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Deductions</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <Row label="PF (employee)" value={formatINR(payslip.pfEmployee)} />
            <Row label="PF (employer)" value={formatINR(payslip.pfEmployer)} />
            <Row label="ESI (employee)" value={payslip.esiEmployee ? formatINR(payslip.esiEmployee) : 'N/A'} />
            <Row label="ESI (employer)" value={payslip.esiEmployer ? formatINR(payslip.esiEmployer) : 'N/A'} />
            <Row label="Professional Tax" value={payslip.professionalTax ? formatINR(payslip.professionalTax) : 'N/A'} />
            <Row label="TDS" value={formatINR(payslip.tdsDeducted)} />
            <Row label="Unpaid leave deduction" value={formatINR(payslip.unpaidLeaveDeduction)} />
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardContent className="flex items-center justify-between p-6">
          <span className="text-sm uppercase tracking-wide text-muted-foreground">
            Net Pay
          </span>
          <span className="text-3xl font-semibold">{formatINR(payslip.netPay)}</span>
        </CardContent>
      </Card>

      <div className="mt-8">
        <h2 className="text-lg font-semibold">Statutory Config Snapshot</h2>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          The exact StatutoryConfig rows applied when this payslip was generated
          — frozen at generation time, so a later config change can never
          retroactively alter what these numbers mean. This is the view a
          CA/compliance reviewer needs to verify the computation.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <ConfigSnapshotCard label="PF" config={snapshot.pf} />
          <ConfigSnapshotCard label="ESI" config={snapshot.esi} />
          <ConfigSnapshotCard label="Professional Tax" config={snapshot.professionalTax} />
          <ConfigSnapshotCard label="TDS Slabs" config={snapshot.tdsSlab} />
          <ConfigSnapshotCard label="Standard Deduction" config={snapshot.standardDeduction} />
        </div>
      </div>
    </PageContainer>
  );
}
