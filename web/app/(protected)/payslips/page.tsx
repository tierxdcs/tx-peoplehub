'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { apiFetch } from '../../lib/api';
import { PaginatedResult, Payslip } from '../../lib/types';

const PAYSLIPS_ENABLED = process.env.NEXT_PUBLIC_PAYSLIPS_ENABLED === 'true';

export default function MyPayslipsPage() {
  const router = useRouter();
  const [payslips, setPayslips] = useState<Payslip[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!PAYSLIPS_ENABLED) {
      router.replace('/');
      return;
    }
    apiFetch<PaginatedResult<Payslip>>('/payslips/me?page=1&limit=100')
      .then((res) => setPayslips(res.items))
      .catch(() => setError('Failed to load payslips'))
      .finally(() => setLoading(false));
  }, [router]);

  if (!PAYSLIPS_ENABLED) return null;

  return (
    <div>
      <h1>My Payslips</h1>

      {error && <p style={{ color: 'crimson' }}>{error}</p>}
      {loading ? (
        <p>Loading…</p>
      ) : payslips.length === 0 ? (
        <p>No payslips yet.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid #ccc' }}>
              <th>Generated</th>
              <th>Gross</th>
              <th>Net Pay</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {payslips.map((p) => (
              <tr key={p.id} style={{ borderBottom: '1px solid #eee' }}>
                <td>{new Date(p.createdAt).toLocaleDateString()}</td>
                <td>{p.grossEarnings}</td>
                <td>{p.netPay}</td>
                <td>{p.status}</td>
                <td>
                  <Link href={`/payslips/${p.id}`}>View</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
