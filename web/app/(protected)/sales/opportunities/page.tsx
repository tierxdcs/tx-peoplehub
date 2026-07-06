'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '../../../lib/api';
import {
  Opportunity,
  OpportunityStage,
  PaginatedResult,
} from '../../../lib/types';
import { badgeStyle, formatINR, pipelineStatusColor, prettyEnum } from '../../../lib/sales';
import { Button } from '../../../components/ui/button';

const STAGES: OpportunityStage[] = [
  'PROSPECTING',
  'QUALIFICATION',
  'PROPOSAL',
  'NEGOTIATION',
  'CLOSED_WON',
  'CLOSED_LOST',
];

export default function OpportunitiesPage() {
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [stageFilter, setStageFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const limit = 20;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<PaginatedResult<Opportunity>>(
        `/opportunities?page=${page}&limit=${limit}`,
      );
      setOpportunities(res.items);
      setTotal(res.total);
    } catch {
      setError('Failed to load opportunities');
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(
    () =>
      opportunities.filter((o) => !stageFilter || o.stage === stageFilter),
    [opportunities, stageFilter],
  );

  return (
    <div>
      <h1>Opportunities</h1>

      <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
        <select
          value={stageFilter}
          onChange={(e) => setStageFilter(e.target.value)}
          style={{ padding: 6 }}
        >
          <option value="">All stages</option>
          {STAGES.map((s) => (
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
                <th>Name</th>
                <th>Stage</th>
                <th>Estimated Value</th>
                <th>Expected Close</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((o) => (
                <tr key={o.id} style={{ borderBottom: '1px solid #eee' }}>
                  <td>
                    <Link href={`/sales/opportunities/${o.id}`}>{o.name}</Link>
                  </td>
                  <td>
                    <span style={badgeStyle(pipelineStatusColor(prettyEnum(o.stage)))}>
                      {prettyEnum(o.stage)}
                    </span>
                  </td>
                  <td>{formatINR(o.estimatedValue)}</td>
                  <td>{o.expectedCloseDate.slice(0, 10)}</td>
                  <td>
                    <Link href={`/sales/opportunities/${o.id}`}>View</Link>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ padding: 12, color: '#666' }}>
                    No opportunities.
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
