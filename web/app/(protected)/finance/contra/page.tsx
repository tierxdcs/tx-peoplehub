'use client';

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../../components/ui/table';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiFetch, ApiError } from '../../../lib/api';
import { useFinanceAccess } from '../../../lib/use-finance-access';
import { formatINR } from '../../../lib/sales';
import { useNumberFormat } from '../../../lib/number-format-context';
import { Button } from '../../../components/ui/button';
import { Card, CardContent } from '../../../components/ui/card';
import { PageContainer } from '../../../components/ui/page-container';
import { PageHeader } from '../../../components/ui/page-header';
import { StatusBadge } from '../../../components/ui/status-badge';
import { EmptyState } from '../../../components/ui/empty-state';
import { useToast } from '../../../components/ui/toaster';
import { ArrowLeftRight } from 'lucide-react';
import { RegisterPagination } from '../../../components/ui/register-pagination';
import { serverPageCount } from '../../../lib/server-pagination';

interface ContraVoucher {
  id: string;
  voucherNumber: string;
  voucherDate: string;
  amount: string;
  narration: string | null;
  status: string;
  fromLedgerAccount: { code: string; name: string };
  toLedgerAccount: { code: string; name: string };
}
interface Page<T> {
  items: T[];
  total: number;
}
const PAGE_SIZE = 25;

export default function ContraVouchersPage() {
  const toast = useToast();
  const { isAccountsHead } = useFinanceAccess();
  const { style: numberFormatStyle } = useNumberFormat();
  const [vouchers, setVouchers] = useState<ContraVoucher[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  const load = () =>
    apiFetch<Page<ContraVoucher>>(`/finance/contra?page=${page}&limit=${PAGE_SIZE}`).then((r) => {
      setVouchers(r.items);
      setTotal(r.total);
    });

  useEffect(() => {
    setLoading(true);
    load()
      .catch((e) => toast.error(e instanceof ApiError ? e.message : 'Failed to load contra vouchers'))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  async function action(id: string, act: string) {
    try {
      await apiFetch(`/finance/contra/${id}/${act}`, {
        method: 'POST',
        ...(act === 'reject' ? { body: JSON.stringify({ comment: window.prompt('Rejection reason') || '' }) } : {}),
      });
      toast.success(`Contra voucher ${act}d`);
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : `Failed to ${act} contra voucher`);
    }
  }

  return (
    <PageContainer>
      <div className="mb-5 flex items-center justify-between">
        <PageHeader title="Contra Vouchers" description="Bank-to-cash, cash-to-bank, and inter-bank transfers" />
        <Link href="/finance/vouchers/contra/new">
          <Button>New Contra Voucher</Button>
        </Link>
      </div>
      <Card>
        <CardContent className="p-0">
          {!loading && vouchers.length === 0 ? (
            <EmptyState
              icon={ArrowLeftRight}
              title="No contra vouchers"
              description="Bank/cash transfers recorded here will appear as a chronological register."
            />
          ) : (
            <div className="overflow-x-auto">
              <Table className="w-full text-sm">
                <TableHeader>
                  <TableRow className="border-b text-left">
                    <TableHead className="p-3">Voucher</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>From</TableHead>
                    <TableHead>To</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {vouchers.map((v) => (
                    <TableRow className="border-b" key={v.id}>
                      <TableCell className="p-3 font-mono">{v.voucherNumber}</TableCell>
                      <TableCell>{v.voucherDate.slice(0, 10)}</TableCell>
                      <TableCell>{v.fromLedgerAccount.name}</TableCell>
                      <TableCell>{v.toLedgerAccount.name}</TableCell>
                      <TableCell>{formatINR(v.amount, numberFormatStyle)}</TableCell>
                      <TableCell>
                        <StatusBadge value={v.status} />
                      </TableCell>
                      <TableCell className="space-x-2">
                        {(v.status === 'DRAFT' || v.status === 'REJECTED') && (
                          <Button size="sm" variant="outline" onClick={() => void action(v.id, 'submit')}>
                            Submit
                          </Button>
                        )}
                        {isAccountsHead && v.status === 'PENDING_APPROVAL' && (
                          <>
                            <Button size="sm" onClick={() => void action(v.id, 'approve')}>
                              Approve
                            </Button>
                            <Button size="sm" variant="destructive" onClick={() => void action(v.id, 'reject')}>
                              Reject
                            </Button>
                          </>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
      <RegisterPagination
        page={page}
        pageCount={serverPageCount(total, PAGE_SIZE)}
        onPageChange={setPage}
        disabled={loading}
      />
    </PageContainer>
  );
}
