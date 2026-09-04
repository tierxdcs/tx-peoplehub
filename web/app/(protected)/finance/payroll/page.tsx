'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, ApiError } from '../../../lib/api';
import { formatINR } from '../../../lib/sales';
import { useNumberFormat } from '../../../lib/number-format-context';
import { useFinanceAccess } from '../../../lib/use-finance-access';
import {
  SignalHeader,
  SignalPage,
  SCard,
  SIGNAL_MUTED,
} from '../../../components/ui/signal';
import { Button } from '../../../components/ui/button';
import { StatusBadge } from '../../../components/ui/status-badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../components/ui/table';
import { useToast } from '../../../components/ui/toaster';
import { useConfirm } from '../../../components/ui/confirm';

type Payroll = {
  id: string;
  month: number;
  year: number;
  status: string;
  employeeCount: number;
  grossEarnings: string;
  employerContributions: string;
  unpaidLeaveDeduction: string;
  netPay: string;
  tds: string;
  totalExpense: string;
  paymentBankReference?: string | null;
};
const months = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

export default function SalaryPaymentsPage() {
  const [runs, setRuns] = useState<Payroll[]>([]);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const { style } = useNumberFormat();
  const { isAccountsHead } = useFinanceAccess();
  const load = useCallback(async () => {
    try {
      setRuns(await apiFetch<Payroll[]>('/finance/payroll'));
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Unable to load payroll');
    } finally {
      setLoading(false);
    }
  }, [toast]);
  useEffect(() => {
    void load();
  }, [load]);
  async function approve(run: Payroll) {
    if (
      !(await confirm({
        title: 'Approve payroll?',
        description: `Approve ${months[run.month - 1]} ${run.year} and post the salary accrual journal?`,
        confirmLabel: 'Approve payroll',
      }))
    )
      return;
    try {
      await apiFetch(`/finance/payroll/${run.id}/approve`, { method: 'POST' });
      toast.success('Payroll approved and posted');
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Approval failed');
    }
  }
  async function pay(run: Payroll) {
    const bankReference = window.prompt('Bank transaction/reference number');
    if (!bankReference?.trim()) return;
    if (
      !(await confirm({
        title: 'Record salary payment?',
        description: `Confirm bank payment of ${formatINR(run.netPay, style)}?`,
        confirmLabel: 'Record payment',
      }))
    )
      return;
    try {
      await apiFetch(`/finance/payroll/${run.id}/execute`, {
        method: 'POST',
        body: JSON.stringify({ bankReference }),
      });
      toast.success('Salary payment posted; payslips marked paid');
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Payment failed');
    }
  }
  return (
    <SignalPage>
      <SignalHeader
        title="Salary Payments"
        description="Payroll handed over by HR for Accounts approval, posting and bank execution."
      />
      <div className="px-5 py-5">
        <SCard className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Period</TableHead>
                <TableHead>Employees</TableHead>
                <TableHead>Gross / Employer cost</TableHead>
                <TableHead>Net payable / TDS</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.map((run) => (
                <TableRow key={run.id}>
                  <TableCell className="font-medium">
                    {months[run.month - 1]} {run.year}
                  </TableCell>
                  <TableCell>{run.employeeCount}</TableCell>
                  <TableCell>
                    {formatINR(run.grossEarnings, style)}
                    <br />
                    <span className={SIGNAL_MUTED}>
                      Cost {formatINR(run.totalExpense, style)}
                    </span>
                  </TableCell>
                  <TableCell>
                    {formatINR(run.netPay, style)}
                    <br />
                    <span className={SIGNAL_MUTED}>
                      TDS {formatINR(run.tds, style)}
                    </span>
                  </TableCell>
                  <TableCell>
                    <StatusBadge value={run.status} />
                    {run.paymentBankReference && (
                      <div className={`text-xs ${SIGNAL_MUTED}`}>
                        {run.paymentBankReference}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          router.push(`/finance/payroll/${run.id}`)
                        }
                      >
                        View details
                      </Button>
                      {isAccountsHead && run.status === 'PENDING_APPROVAL' && (
                        <Button size="sm" onClick={() => void approve(run)}>
                          Approve
                        </Button>
                      )}
                      {['APPROVED', 'LOCKED'].includes(run.status) && (
                        <Button size="sm" onClick={() => void pay(run)}>
                          Record bank payment
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {!loading && !runs.length && (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center">
                    No payroll has been sent to Accounts.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </SCard>
      </div>
    </SignalPage>
  );
}
