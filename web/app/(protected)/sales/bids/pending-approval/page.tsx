'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { apiFetch, ApiError } from '../../../../lib/api';
import { Bid, PaginatedResult } from '../../../../lib/types';
import { formatINR } from '../../../../lib/sales';
import { useNumberFormat } from '../../../../lib/number-format-context';
import { Button } from '../../../../components/ui/button';
import { useToast } from '../../../../components/ui/toaster';
import { useConfirm } from '../../../../components/ui/confirm';
import { Input } from '../../../../components/ui/input';
import {
  SCard,
  SIGNAL_LINK,
  SignalHeader,
  SignalPage,
} from '../../../../components/ui/signal';
import { RegisterToolbar } from '../../../../components/ui/register-toolbar';
import { RegisterPagination } from '../../../../components/ui/register-pagination';
import { EmptyState } from '../../../../components/ui/empty-state';
import { ClipboardCheck } from 'lucide-react';
import { useRegisterList } from '../../../../lib/use-register-list';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../../../components/ui/table';

export default function BidApprovalQueuePage() {
  const toast = useToast();
  const confirm = useConfirm();
  const { style: numberFormatStyle } = useNumberFormat();
  const [bids, setBids] = useState<Bid[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [comments, setComments] = useState<Record<string, string>>({});
  const [acting, setActing] = useState<string | null>(null);
  const register = useRegisterList(bids, (bid) => `${bid.bidNumber} ${bid.status} ${bid.ownerName} ${bid.enquiryCreatorName}`);

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
    <SignalPage>
      <SignalHeader
        title="Bid Approvals"
        description="Bids awaiting your approval. Your own submitted bids never appear here."
      />
      <div className="space-y-4 px-5 pb-7 pt-[18px] lg:px-7">
      <RegisterToolbar title="Approval Queue" search={register.search} onSearchChange={register.setSearch} searchPlaceholder="Search bid, requester or status" />

      {error && <p className="text-destructive">{error}</p>}
      {loading ? (
        <p>Loading…</p>
      ) : (
        <SCard className="overflow-hidden p-3 md:p-0">
            <div className="space-y-3 md:hidden">
              {register.visibleItems.map((b) => (
                <article key={b.id} className="space-y-3 rounded-lg border p-4">
                  <div className="flex items-start justify-between gap-3">
                    <Link
                      className={SIGNAL_LINK}
                      href={`/sales/bids/${b.id}`}
                    >
                      {b.bidNumber}
                    </Link>
                    <span className="font-semibold">
                      {formatINR(b.grandTotal, numberFormatStyle)}
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
              <Table><TableHeader><TableRow><TableHead>Bid #</TableHead><TableHead>Discount %</TableHead><TableHead>Total</TableHead><TableHead>Comments</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader><TableBody>
                  {register.visibleItems.map((b) => (
                    <TableRow key={b.id}>
                      <TableCell>
                        <Link className={SIGNAL_LINK} href={`/sales/bids/${b.id}`}>{b.bidNumber}</Link>
                      </TableCell><TableCell>{b.discountPercent}%</TableCell><TableCell>{formatINR(b.grandTotal, numberFormatStyle)}</TableCell><TableCell>
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
                      </TableCell><TableCell><div className="flex justify-end gap-2">
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
                      </div></TableCell></TableRow>
                  ))}
                  {!register.visibleItems.length && <TableRow><TableCell colSpan={5} className="p-0"><EmptyState icon={ClipboardCheck} title="No bids pending approval" tone="positive" /></TableCell></TableRow>}
                </TableBody></Table>
            </div>
        </SCard>
      )}
      <RegisterPagination page={register.page} pageCount={register.pageCount} onPageChange={register.setPage} disabled={loading} />
      </div>
    </SignalPage>
  );
}
