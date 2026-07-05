'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { apiFetch } from '../../../../../../lib/api';
import { Employee, Payslip } from '../../../../../../lib/types';

function Row({ label, value }: { label: string; value: string }) {
  return (
    <tr style={{ borderBottom: '1px solid #eee' }}>
      <td style={{ padding: '6px 12px 6px 0', color: '#666' }}>{label}</td>
      <td style={{ padding: '6px 0', fontWeight: 'bold' }}>{value}</td>
    </tr>
  );
}

/**
 * The statutoryConfigSnapshot shape is whatever
 * PayrollComputationService.buildSnapshot() wrote at generation time — see
 * that method for the exact keys (pf/esi/tdsSlab/standardDeduction/
 * professionalTax), each holding a full StatutoryConfig row (or null).
 * Rendered generically here rather than destructured field-by-field so it
 * stays correct if the snapshot's shape evolves.
 */
function ConfigSnapshotCard({
  label,
  config,
}: {
  label: string;
  config: unknown;
}) {
  if (!config || typeof config !== 'object') {
    return (
      <div
        style={{
          border: '1px solid #ccc',
          borderRadius: 6,
          padding: 12,
          minWidth: 220,
        }}
      >
        <div style={{ fontWeight: 'bold' }}>{label}</div>
        <div style={{ color: '#666', marginTop: 8 }}>Not applicable</div>
      </div>
    );
  }
  const c = config as Record<string, unknown>;
  return (
    <div
      style={{
        border: '1px solid #ccc',
        borderRadius: 6,
        padding: 12,
        minWidth: 260,
      }}
    >
      <div style={{ fontWeight: 'bold' }}>{label}</div>
      <div style={{ fontSize: 13, color: '#666', marginTop: 4 }}>
        Effective {String(c.effectiveFrom ?? '').slice(0, 10)}
        {c.effectiveTo ? ` → ${String(c.effectiveTo).slice(0, 10)}` : ' (open-ended)'}
        {c.state ? ` — ${c.state}` : ''}
      </div>
      <pre
        style={{
          background: '#f7f7f7',
          padding: 8,
          borderRadius: 4,
          fontSize: 12,
          marginTop: 8,
          overflowX: 'auto',
        }}
      >
        {JSON.stringify(c.configData ?? {}, null, 2)}
      </pre>
      <div style={{ fontSize: 12, color: '#666' }}>
        Source: {String(c.sourceNote ?? '—')}
      </div>
    </div>
  );
}

export default function PayslipDetailPage() {
  const { id, payslipId } = useParams<{ id: string; payslipId: string }>();
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

  if (loading) return <p>Loading…</p>;
  if (error || !payslip) return <p style={{ color: 'crimson' }}>{error}</p>;

  const snapshot = payslip.statutoryConfigSnapshot as Record<string, unknown>;

  return (
    <div>
      <p>
        <Link href={`/admin/payroll-runs/${id}`}>← Back to run</Link>
      </p>
      <h1>Payslip — {employeeName ?? payslip.employeeId}</h1>

      <h2>Earnings</h2>
      <table style={{ marginBottom: 24 }}>
        <tbody>
          <Row label="Basic" value={payslip.basicPaid} />
          <Row label="HRA" value={payslip.hraPaid} />
          <Row label="Special allowance" value={payslip.specialAllowancePaid} />
          <Row label="Other allowances" value={payslip.otherAllowancesPaid} />
          <Row label="Gross earnings" value={payslip.grossEarnings} />
        </tbody>
      </table>

      <h2>Deductions</h2>
      <table style={{ marginBottom: 24 }}>
        <tbody>
          <Row label="PF (employee)" value={payslip.pfEmployee} />
          <Row label="PF (employer)" value={payslip.pfEmployer} />
          <Row
            label="ESI (employee)"
            value={payslip.esiEmployee ?? 'N/A'}
          />
          <Row
            label="ESI (employer)"
            value={payslip.esiEmployer ?? 'N/A'}
          />
          <Row
            label="Professional Tax"
            value={payslip.professionalTax ?? 'N/A'}
          />
          <Row label="TDS" value={payslip.tdsDeducted} />
          <Row
            label="Unpaid leave deduction"
            value={payslip.unpaidLeaveDeduction}
          />
        </tbody>
      </table>

      <h2>Net Pay</h2>
      <p style={{ fontSize: 24, fontWeight: 'bold', marginBottom: 24 }}>
        {payslip.netPay}
      </p>

      <h2>Statutory Config Snapshot</h2>
      <p style={{ color: '#666', maxWidth: 700 }}>
        The exact StatutoryConfig rows applied when this payslip was
        generated — frozen at generation time, so a later config change can
        never retroactively alter what this payslip&rsquo;s numbers mean.
        This is the view a CA/compliance reviewer needs to verify the
        computation.
      </p>
      <div
        style={{
          display: 'flex',
          gap: 12,
          flexWrap: 'wrap',
          marginTop: 12,
        }}
      >
        <ConfigSnapshotCard label="PF" config={snapshot.pf} />
        <ConfigSnapshotCard label="ESI" config={snapshot.esi} />
        <ConfigSnapshotCard
          label="Professional Tax"
          config={snapshot.professionalTax}
        />
        <ConfigSnapshotCard label="TDS Slabs" config={snapshot.tdsSlab} />
        <ConfigSnapshotCard
          label="Standard Deduction"
          config={snapshot.standardDeduction}
        />
      </div>
    </div>
  );
}
