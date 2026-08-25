'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ReceiptText } from 'lucide-react';
import { listReviewClaims, type ExpenseClaim } from '../../../lib/expense-claims';
import { formatINR } from '../../../lib/sales';
import { useNumberFormat } from '../../../lib/number-format-context';
import { dateOnlyStr } from '../../../lib/date';
import { useToast } from '../../../components/ui/toaster';
import {
  SCard,
  SCardTitle,
  SIGNAL_LINK,
  SignalHeader,
  SignalPage,
} from '../../../components/ui/signal';
import { StatusBadge } from '../../../components/ui/status-badge';
import { EmptyState } from '../../../components/ui/empty-state';
import { Skeleton } from '../../../components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../components/ui/table';

export default function ExpenseClaimReviewPage() {
  const router = useRouter();
  const toast = useToast();
  const { style } = useNumberFormat();
  const [claims, setClaims] = useState<ExpenseClaim[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setClaims(await listReviewClaims());
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Failed to load expense claims';
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, [toast]);
  useEffect(() => {
    void load();
  }, [load]);

  const submitted = claims.filter((c) => c.status === 'SUBMITTED');
  const approved = claims.filter((c) => c.status === 'APPROVED');

  return (
    <SignalPage>
      <SignalHeader
        title="Expense Claims"
        description="Review submitted employee expense claims — approve to post the general-ledger journal, or reject with a reason. Approved claims await reimbursement (Mark as paid) on the claim page."
      />
      <div className="space-y-4 px-5 pb-7 pt-[18px] lg:px-7">
      {loading ? (
        <SCard>
          <div className="space-y-2 p-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        </SCard>
      ) : error ? (
        <SCard>
          <div className="p-6 text-sm text-destructive">
            {error}
          </div>
        </SCard>
      ) : (
        <>
          <ClaimQueue
            title="Awaiting your approval"
            emptyLabel="No claims awaiting approval"
            claims={submitted}
            style={style}
            onOpen={(id) => router.push(`/expense-claims/${id}`)}
          />
          <ClaimQueue
            title="Approved — awaiting reimbursement"
            emptyLabel="No approved claims awaiting payment"
            claims={approved}
            style={style}
            onOpen={(id) => router.push(`/expense-claims/${id}`)}
          />
        </>
      )}
      </div>
    </SignalPage>
  );
}

function ClaimQueue({
  title,
  emptyLabel,
  claims,
  style,
  onOpen,
}: {
  title: string;
  emptyLabel: string;
  claims: ExpenseClaim[];
  style: 'india' | 'international';
  onOpen: (id: string) => void;
}) {
  return (
    <SCard className="overflow-hidden">
      <div className="px-5 pb-3 pt-[18px]">
        <SCardTitle title={title} />
      </div>
      {claims.length === 0 ? (
        <EmptyState icon={ReceiptText} title={emptyLabel} tone="positive" />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Claim</TableHead>
              <TableHead>Claimant</TableHead>
              <TableHead>Title</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>Submitted</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {claims.map((c) => (
              <TableRow
                key={c.id}
                className="cursor-pointer"
                onClick={() => onOpen(c.id)}
              >
                <TableCell className="font-medium">
                  <Link
                    href={`/expense-claims/${c.id}`}
                    className={SIGNAL_LINK}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {c.claimNumber}
                  </Link>
                </TableCell>
                <TableCell>{c.employeeName ?? '—'}</TableCell>
                <TableCell>{c.title}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatINR(c.totalAmount, style)}
                </TableCell>
                <TableCell>
                  {c.submittedAt ? dateOnlyStr(c.submittedAt) : '—'}
                </TableCell>
                <TableCell>
                  <StatusBadge value={c.status} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </SCard>
  );
}
