'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiFetch, ApiError } from '../../../lib/api';
import { useFinanceAccess } from '../../../lib/use-finance-access';
import { Button } from '../../../components/ui/button';
import { Card, CardContent } from '../../../components/ui/card';
import { PageContainer } from '../../../components/ui/page-container';
import { PageHeader } from '../../../components/ui/page-header';
import { StatusBadge } from '../../../components/ui/status-badge';
import { EmptyState } from '../../../components/ui/empty-state';
import { useToast } from '../../../components/ui/toaster';
import { ArrowLeftRight } from 'lucide-react';

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

export default function ContraVouchersPage() {
  const toast = useToast();
  const { isAccountsHead } = useFinanceAccess();
  const [vouchers, setVouchers] = useState<ContraVoucher[]>([]);
  const [loading, setLoading] = useState(true);

  const load = () =>
    apiFetch<Page<ContraVoucher>>('/finance/contra?limit=100').then((r) => setVouchers(r.items));

  useEffect(() => {
    setLoading(true);
    load()
      .catch((e) => toast.error(e instanceof ApiError ? e.message : 'Failed to load contra vouchers'))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left">
                    <th className="p-3">Voucher</th>
                    <th>Date</th>
                    <th>From</th>
                    <th>To</th>
                    <th>Amount</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {vouchers.map((v) => (
                    <tr className="border-b" key={v.id}>
                      <td className="p-3 font-mono">{v.voucherNumber}</td>
                      <td>{v.voucherDate.slice(0, 10)}</td>
                      <td>{v.fromLedgerAccount.name}</td>
                      <td>{v.toLedgerAccount.name}</td>
                      <td>₹{Number(v.amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                      <td>
                        <StatusBadge value={v.status} />
                      </td>
                      <td className="space-x-2">
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
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </PageContainer>
  );
}
