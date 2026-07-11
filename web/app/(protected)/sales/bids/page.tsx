'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '../../../lib/api';
import { Bid, BidStatus, PaginatedResult } from '../../../lib/types';
import { badgeStyle, bidStatusColor, formatINR, prettyEnum } from '../../../lib/sales';
import { Button } from '../../../components/ui/button';

const STATUSES: BidStatus[] = [
  'DRAFT',
  'PENDING_APPROVAL',
  'APPROVED',
  'REJECTED',
  'SENT',
  'ACCEPTED',
  'EXPIRED',
];

export default function BidsPage() {
  const [bids, setBids] = useState<Bid[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const limit = 20;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<PaginatedResult<Bid>>(
        `/bids?page=${page}&limit=${limit}`,
      );
      setBids(res.items);
      setTotal(res.total);
    } catch {
      setError('Failed to load bids');
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(
    () => bids.filter((b) => !statusFilter || b.status === statusFilter),
    [bids, statusFilter],
  );

  return (
    <div>
      <h1>Bids</h1>

      <div style={{ marginBottom: 16 }}>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          style={{ padding: 6 }}
        >
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {prettyEnum(s)}
            </option>
          ))}
        </select>
      </div>

      {error && <p style={{ color: 'crimson' }}>{error}</p>}
      {loading ? (
        <p>Loading…</p>
      ) : (
        <>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid #ccc' }}>
                <th>Bid #</th>
                <th>Status</th>
                <th>Discount %</th>
                <th>Total</th>
                <th>Valid Until</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((b) => (
                <tr key={b.id} style={{ borderBottom: '1px solid #eee' }}>
                  <td>
                    <Link href={`/sales/bids/${b.id}`}>{b.bidNumber}</Link>
                  </td>
                  <td>
                    <span style={badgeStyle(bidStatusColor(b.status))}>
                      {prettyEnum(b.status)}
                    </span>
                  </td>
                  <td>{b.discountPercent}%</td>
                  <td>{formatINR(b.totalAmount)}</td>
                  <td>{b.validUntil.slice(0, 10)}</td>
                  <td>
                    <Link href={`/sales/bids/${b.id}`}>
                      <Button variant="outline" size="sm">
                        View
                      </Button>
                    </Link>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ padding: 12, color: '#666' }}>
                    No bids.
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Prev
            </Button>
            <span>
              Page {page} of {Math.max(1, Math.ceil(total / limit))}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page * limit >= total}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
