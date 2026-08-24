'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { apiFetch } from '../../../../../../lib/api';
import { Employee, Payslip } from '../../../../../../lib/types';
import { formatINR } from '../../../../../../lib/sales';
import { useNumberFormat } from '../../../../../../lib/number-format-context';
import {
  SCard,
  SCardTitle,
  SIGNAL_EYEBROW,
  SIGNAL_ROW_DIVIDER,
  SignalHeader,
  SignalPage,
} from '../../../../../../components/ui/signal';
import { Skeleton } from '../../../../../../components/ui/skeleton';
import { cn } from '../../../../../../lib/utils';

/** One label/value line in an earnings/deductions list. */
function Row({ label, value }: { label: string; value: string }) {
  return (
    <div
      className={cn(
        'flex items-center justify-between border-b py-2 text-[12px] font-medium text-black/60 last:border-0 dark:text-white/55',
        SIGNAL_ROW_DIVIDER,
      )}
    >
      <span>{label}</span>
      <span className="text-[12.5px] font-semibold tabular-nums text-[#1B1B1B] dark:text-[#EDEDED]">
        {value}
      </span>
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
      <SCard className="p-4">
        <div className="text-[13px] font-bold">{label}</div>
        <div className="mt-2 text-sm text-black/45 dark:text-white/40">Not applicable</div>
      </SCard>
    );
  }
  const c = config as Record<string, unknown>;
  return (
    <SCard className="p-4">
      <div className="text-[13px] font-bold">{label}</div>
      <div className="mt-1 text-xs text-black/45 dark:text-white/40">
        Effective {String(c.effectiveFrom ?? '').slice(0, 10)}
        {c.effectiveTo ? ` → ${String(c.effectiveTo).slice(0, 10)}` : ' (open-ended)'}
        {c.state ? ` — ${c.state}` : ''}
      </div>
      <pre className="mt-2 overflow-x-auto rounded-md bg-black/[.04] p-2 text-xs dark:bg-white/[.05]">
        {JSON.stringify(c.configData ?? {}, null, 2)}
      </pre>
      <div className="mt-2 text-xs text-black/45 dark:text-white/40">
        Source: {String(c.sourceNote ?? '—')}
      </div>
    </SCard>
  );
}

export default function PayslipDetailPage() {
  const { id, payslipId } = useParams<{ id: string; payslipId: string }>();
  const { style: numberFormatStyle } = useNumberFormat();
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
      <SignalPage>
        <div className="px-5 pb-7 pt-[18px] lg:px-7">
          <Skeleton className="mb-4 h-6 w-24" />
          <Skeleton className="mb-6 h-9 w-64" />
          <Skeleton className="h-64 w-full" />
        </div>
      </SignalPage>
    );
  }
  if (error || !payslip) {
    return (
      <SignalPage>
        <div className="px-5 pb-7 pt-[18px] lg:px-7">
          <p className="text-destructive">{error ?? 'Payslip not found.'}</p>
        </div>
      </SignalPage>
    );
  }

  const snapshot = payslip.statutoryConfigSnapshot as Record<string, unknown>;

  return (
    <SignalPage>
      <SignalHeader
        backHref={`/admin/payroll-runs/${id}`}
        backLabel="Back to run"
        title={`Payslip — ${employeeName ?? payslip.employeeId}`}
      />
      <div className="space-y-4 px-5 pb-7 pt-[18px] lg:px-7">

      <div className="grid gap-4 md:grid-cols-2">
        <SCard className="px-5 py-[18px]">
          <SCardTitle title="Earnings" />
          <div className="mt-2">
            <Row label="Basic" value={formatINR(payslip.basicPaid, numberFormatStyle)} />
            <Row label="HRA" value={formatINR(payslip.hraPaid, numberFormatStyle)} />
            <Row label="Special allowance" value={formatINR(payslip.specialAllowancePaid, numberFormatStyle)} />
            <Row label="Other allowances" value={formatINR(payslip.otherAllowancesPaid, numberFormatStyle)} />
            <Row label="Gross earnings" value={formatINR(payslip.grossEarnings, numberFormatStyle)} />
          </div>
        </SCard>

        <SCard className="px-5 py-[18px]">
          <SCardTitle title="Deductions" />
          <div className="mt-2">
            <Row label="PF (employee)" value={formatINR(payslip.pfEmployee, numberFormatStyle)} />
            <Row label="PF (employer)" value={formatINR(payslip.pfEmployer, numberFormatStyle)} />
            <Row label="ESI (employee)" value={payslip.esiEmployee ? formatINR(payslip.esiEmployee, numberFormatStyle) : 'N/A'} />
            <Row label="ESI (employer)" value={payslip.esiEmployer ? formatINR(payslip.esiEmployer, numberFormatStyle) : 'N/A'} />
            <Row label="Professional Tax" value={payslip.professionalTax ? formatINR(payslip.professionalTax, numberFormatStyle) : 'N/A'} />
            <Row label="TDS" value={formatINR(payslip.tdsDeducted, numberFormatStyle)} />
            <Row label="Unpaid leave deduction" value={formatINR(payslip.unpaidLeaveDeduction, numberFormatStyle)} />
          </div>
        </SCard>
      </div>

      <SCard className="px-5 py-[18px]">
        <div className="flex items-center justify-between">
          <span className={SIGNAL_EYEBROW}>Net Pay</span>
          <span className="text-[30px] font-extrabold leading-none tracking-[-1.4px] tabular-nums">
            {formatINR(payslip.netPay, numberFormatStyle)}
          </span>
        </div>
      </SCard>

      <div className="pt-2">
        <h2 className="text-[15px] font-bold">Statutory Config Snapshot</h2>
        <p className="mt-1 max-w-2xl text-sm text-black/45 dark:text-white/40">
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
      </div>
    </SignalPage>
  );
}
