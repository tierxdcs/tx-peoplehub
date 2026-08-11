'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Plus, ReceiptText } from 'lucide-react';
import { listMyClaims, type ExpenseClaim } from '../../lib/expense-claims';
import { formatINR } from '../../lib/sales';
import { useNumberFormat } from '../../lib/number-format-context';
import { useToast } from '../../components/ui/toaster';
import { PageContainer } from '../../components/ui/page-container';
import { PageHeader } from '../../components/ui/page-header';
import { Card, CardContent } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { StatusBadge } from '../../components/ui/status-badge';
import { EmptyState } from '../../components/ui/empty-state';
import { Skeleton } from '../../components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table';
import { RegisterToolbar } from '../../components/ui/register-toolbar';
import { RegisterPagination } from '../../components/ui/register-pagination';
import { useRegisterList } from '../../lib/use-register-list';
import { dateOnlyStr } from '../../lib/date';

export default function MyExpenseClaimsPage() {
  const router = useRouter();
  const toast = useToast();
  const { style } = useNumberFormat();
  const [claims, setClaims] = useState<ExpenseClaim[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setClaims(await listMyClaims());
    } catch {
      toast.error('Failed to load your expense claims');
    } finally {
      setLoading(false);
    }
  }, [toast]);
  useEffect(() => {
    void load();
  }, [load]);

  const register = useRegisterList(
    claims,
    (c) => `${c.claimNumber} ${c.title} ${c.status}`,
  );

  return (
    <PageContainer>
      <PageHeader
        title="My Expense Claims"
        description="Raise a reimbursement claim, attach a receipt to every line, and submit it for approval by the Accounts Head."
        action={
          <Button onClick={() => router.push('/expense-claims/new')}>
            <Plus className="size-4" /> New claim
          </Button>
        }
      />

      <RegisterToolbar
        title="Claim Register"
        search={register.search}
        onSearchChange={register.setSearch}
        searchPlaceholder="Search claim number, title or status"
      />

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : register.visibleItems.length === 0 ? (
            <EmptyState
              icon={ReceiptText}
              title="No expense claims yet"
              description="Create a claim to request reimbursement for out-of-pocket expenses."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Claim</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Submitted</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {register.visibleItems.map((c) => (
                  <TableRow
                    key={c.id}
                    className="cursor-pointer"
                    onClick={() => router.push(`/expense-claims/${c.id}`)}
                  >
                    <TableCell className="font-medium">
                      <Link
                        href={`/expense-claims/${c.id}`}
                        className="text-primary hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {c.claimNumber}
                      </Link>
                    </TableCell>
                    <TableCell>{c.title}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatINR(c.totalAmount, style)}
                    </TableCell>
                    <TableCell>
                      <StatusBadge value={c.status} />
                    </TableCell>
                    <TableCell>
                      {c.submittedAt ? dateOnlyStr(c.submittedAt) : '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <RegisterPagination
        page={register.page}
        pageCount={register.pageCount}
        onPageChange={register.setPage}
        disabled={loading}
      />
    </PageContainer>
  );
}
