'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { apiFetch } from '../../../lib/api';
import { Payslip } from '../../../lib/types';

const PAYSLIPS_ENABLED = process.env.NEXT_PUBLIC_PAYSLIPS_ENABLED === 'true';

function Row({ label, value }: { label: string; value: string }) {
  return (
    <tr style={{ borderBottom: '1px solid hsl(var(--border))' }}>
      <td style={{ padding: '6px 12px 6px 0', color: 'hsl(var(--muted-foreground))' }}>{label}</td>
      <td style={{ padding: '6px 0', fontWeight: 'bold' }}>{value}</td>
    </tr>
  );
}

/** Earnings/deductions/net pay only — the full statutoryConfigSnapshot is
 * more useful to Admin/reviewers than to the employee (spec §5). */
export default function MyPayslipDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [payslip, setPayslip] = useState<Payslip | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!PAYSLIPS_ENABLED) {
      router.replace('/');
      return;
    }
    apiFetch<Payslip>(`/payslips/${id}`)
      .then(setPayslip)
      .catch(() => setError('Failed to load payslip'))
      .finally(() => setLoading(false));
  }, [id, router]);

  if (!PAYSLIPS_ENABLED) return null;
  if (loading) return <p>Loading…</p>;
  if (error || !payslip) return <p className="text-destructive">{error}</p>;

  return (
    <div>
      <p>
        <Link href="/payslips">← Back to payslips</Link>
      </p>
      <h1>Payslip</h1>

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
          <Row label="PF" value={payslip.pfEmployee} />
          <Row label="ESI" value={payslip.esiEmployee ?? 'N/A'} />
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
      <p style={{ fontSize: 24, fontWeight: 'bold' }}>{payslip.netPay}</p>

      <button onClick={() => window.print()} style={{ padding: 8, marginTop: 16 }}>
        Print / Save as PDF
      </button>
    </div>
  );
}
