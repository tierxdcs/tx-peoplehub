'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { apiFetch, ApiError } from '../../../../lib/api';
import { Bid, PaginatedResult } from '../../../../lib/types';
import { formatINR } from '../../../../lib/sales';
import { Button } from '../../../../components/ui/button';
import { useToast } from '../../../../components/ui/toaster';
import { useConfirm } from '../../../../components/ui/confirm';
import { Input } from '../../../../components/ui/input';
import { Card, CardContent } from '../../../../components/ui/card';
import { PageContainer } from '../../../../components/ui/page-container';
import { PageHeader } from '../../../../components/ui/page-header';

export default function BidApprovalQueuePage() {
  const toast = useToast();
  const confirm = useConfirm();
  const [bids, setBids] = useState<Bid[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [comments, setComments] = useState<Record<string, string>>({});
  const [acting, setActing] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<PaginatedResult<Bid>>(
        '/bids/pending-approval?page=1&limit=100',
      );
      setBids(res.items);
    } catch {
      setError('Failed to load pending bids');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function act(id: string, action: 'approve' | 'reject') {
    const ok = await confirm(
      action === 'approve'
        ? {
            title: 'Approve this bid?',
            description: 'The bid will be marked APPROVED.',
          }
        : {
            title: 'Reject this bid?',
            description: 'The bid will be marked REJECTED.',
            destructive: true,
          },
    );
    if (!ok) return;
    setActing(id);
    try {
      await apiFetch(`/bids/${id}/${action}`, {
        method: 'PATCH',
        body: JSON.stringify({ approverComments: comments[id] || undefined }),
      });
      await load();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : `Failed to ${action} bid`,
      );
    } finally {
      setActing(null);
    }
  }

  return (
    <PageContainer>
      <PageHeader
        title="Bid Approvals"
        description="Bids awaiting your approval. Your own submitted bids never appear here."
      />

      {error && <p className="text-destructive">{error}</p>}
      {loading ? (
        <p>Loading…</p>
      ) : bids.length === 0 ? (
        <p>No bids pending approval.</p>
      ) : (
        <Card>
          <CardContent className="p-3 md:p-0">
            <div className="space-y-3 md:hidden">
              {bids.map((b) => (
                <article key={b.id} className="space-y-3 rounded-lg border p-4">
                  <div className="flex items-start justify-between gap-3">
                    <Link
                      className="font-medium text-primary"
                      href={`/sales/bids/${b.id}`}
                    >
                      {b.bidNumber}
                    </Link>
                    <span className="font-semibold">
                      {formatINR(b.totalAmount)}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Discount: {b.discountPercent}%
                  </p>
                  <Input
                    placeholder="Optional approval comment"
                    value={comments[b.id] ?? ''}
                    onChange={(e) =>
                      setComments((c) => ({ ...c, [b.id]: e.target.value }))
                    }
                  />
                  <div className="grid grid-cols-2 gap-3">
                    <Button
                      disabled={acting === b.id}
                      onClick={() => act(b.id, 'approve')}
                    >
                      Approve
                    </Button>
                    <Button
                      variant="destructive"
                      disabled={acting === b.id}
                      onClick={() => act(b.id, 'reject')}
                    >
                      Reject
                    </Button>
                  </div>
                </article>
              ))}
            </div>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr
                    style={{
                      textAlign: 'left',
                      borderBottom: '1px solid hsl(var(--border))',
                    }}
                  >
                    <th>Bid #</th>
                    <th>Discount %</th>
                    <th>Total</th>
                    <th>Comments</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {bids.map((b) => (
                    <tr key={b.id} style={{ borderBottom: '1px solid hsl(var(--border))' }}>
                      <td>
                        <Link href={`/sales/bids/${b.id}`}>{b.bidNumber}</Link>
                      </td>
                      <td>{b.discountPercent}%</td>
                      <td>{formatINR(b.totalAmount)}</td>
                      <td>
                        <Input
                          placeholder="Optional"
                          value={comments[b.id] ?? ''}
                          onChange={(e) =>
                            setComments((c) => ({
                              ...c,
                              [b.id]: e.target.value,
                            }))
                          }
                          className="w-48"
                        />
                      </td>
                      <td style={{ display: 'flex', gap: 6 }}>
                        <Button
                          size="sm"
                          disabled={acting === b.id}
                          onClick={() => act(b.id, 'approve')}
                        >
                          Approve
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          disabled={acting === b.id}
                          onClick={() => act(b.id, 'reject')}
                        >
                          Reject
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </PageContainer>
  );
}
