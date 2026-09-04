'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { Search } from 'lucide-react';
import { apiFetch, ApiError } from '../../../../lib/api';
import { formatINR } from '../../../../lib/sales';
import { useNumberFormat } from '../../../../lib/number-format-context';
import { useFinanceAccess } from '../../../../lib/use-finance-access';
import {
  SCard,
  SIGNAL_EYEBROW,
  SIGNAL_MUTED,
  SignalHeader,
  SignalPage,
} from '../../../../components/ui/signal';
import { Button } from '../../../../components/ui/button';
import { Input } from '../../../../components/ui/input';
import { Select } from '../../../../components/ui/select';
import { Skeleton } from '../../../../components/ui/skeleton';
import { StatusBadge } from '../../../../components/ui/status-badge';
import { EmptyState } from '../../../../components/ui/empty-state';
import { useConfirm } from '../../../../components/ui/confirm';
import { useToast } from '../../../../components/ui/toaster';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../../components/ui/table';

type MoneyTotals = {
  employeeCount: number;
  grossEarnings: string;
  employerContributions: string;
  unpaidLeaveDeduction: string;
  tds: string;
  netPay: string;
  totalExpense: string;
  averageNetPay: string;
};

type VerticalCost = Omit<MoneyTotals, 'averageNetPay'> & {
  verticalId: string | null;
  verticalName: string;
};

type ReviewPayslip = {
  id: string;
  employeeId: string;
  grossEarnings: string;
  pfEmployer: string;
  esiEmployer: string | null;
  unpaidLeaveDeduction: string;
  tdsDeducted: string;
  netPay: string;
  status: string;
  employee: {
    employeeId: string;
    firstName: string;
    lastName: string;
    designation: string | null;
    vertical: { id: string; name: string; code: string } | null;
  };
};

type PayrollReview = {
  id: string;
  month: number;
  year: number;
  status: string;
  submittedAt: string | null;
  approvedAt: string | null;
  paymentBankReference: string | null;
  totals: MoneyTotals;
  verticals: VerticalCost[];
  payslips: ReviewPayslip[];
};

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export default function SalaryPaymentReviewPage() {
  const { id } = useParams<{ id: string }>();
  const confirm = useConfirm();
  const toast = useToast();
  const { style } = useNumberFormat();
  const { isAccountsHead } = useFinanceAccess();
  const [review, setReview] = useState<PayrollReview | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [search, setSearch] = useState('');
  const [verticalFilter, setVerticalFilter] = useState('');

  const load = useCallback(async () => {
    try {
      setReview(await apiFetch<PayrollReview>(`/finance/payroll/${id}`));
    } catch (error) {
      toast.error(
        error instanceof ApiError ? error.message : 'Unable to load payroll',
      );
    } finally {
      setLoading(false);
    }
  }, [id, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const employees = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (review?.payslips ?? []).filter((payslip) => {
      const name = `${payslip.employee.firstName} ${payslip.employee.lastName}`;
      return (
        (!query ||
          name.toLowerCase().includes(query) ||
          payslip.employee.employeeId.toLowerCase().includes(query) ||
          payslip.employee.designation?.toLowerCase().includes(query)) &&
        (!verticalFilter ||
          (payslip.employee.vertical?.id ?? 'unassigned') === verticalFilter)
      );
    });
  }, [review, search, verticalFilter]);

  async function approve() {
    if (!review) return;
    const ok = await confirm({
      title: 'Approve payroll?',
      description: `Approve ${MONTHS[review.month - 1]} ${review.year}, lock its figures and post the salary accrual journal?`,
      confirmLabel: 'Approve payroll',
    });
    if (!ok) return;
    setActing(true);
    try {
      await apiFetch(`/finance/payroll/${review.id}/approve`, {
        method: 'POST',
      });
      toast.success('Payroll approved and accrual journal posted');
      await load();
    } catch (error) {
      toast.error(
        error instanceof ApiError ? error.message : 'Approval failed',
      );
    } finally {
      setActing(false);
    }
  }

  if (loading) {
    return (
      <SignalPage>
        <div className="space-y-4 px-5 py-5 lg:px-7">
          <Skeleton className="h-10 w-72" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-80 w-full" />
        </div>
      </SignalPage>
    );
  }

  if (!review) {
    return (
      <SignalPage>
        <SignalHeader
          backHref="/finance/payroll"
          backLabel="Salary Payments"
          title="Payroll review"
        />
        <div className="px-5 py-5 text-sm text-destructive">
          Payroll review is unavailable.
        </div>
      </SignalPage>
    );
  }

  const maxVerticalCost = Math.max(
    ...review.verticals.map((vertical) => Number(vertical.totalExpense)),
    1,
  );
  const employerShare = Number(review.totals.totalExpense)
    ? (Number(review.totals.employerContributions) /
        Number(review.totals.totalExpense)) *
      100
    : 0;

  return (
    <SignalPage>
      <SignalHeader
        backHref="/finance/payroll"
        backLabel="Salary Payments"
        title={`${MONTHS[review.month - 1]} ${review.year} payroll review`}
        chip={<StatusBadge value={review.status} />}
        actions={
          isAccountsHead && review.status === 'PENDING_APPROVAL' ? (
            <Button disabled={acting} onClick={() => void approve()}>
              {acting ? 'Approving…' : 'Approve payroll'}
            </Button>
          ) : undefined
        }
      />

      <div className="space-y-4 px-5 pb-7 pt-[18px] lg:px-7">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Metric
            label="Total payroll cost"
            value={formatINR(review.totals.totalExpense, style)}
            detail={`${review.totals.employeeCount} employees`}
          />
          <Metric
            label="Net salary payable"
            value={formatINR(review.totals.netPay, style)}
            detail={`Average ${formatINR(review.totals.averageNetPay, style)}`}
          />
          <Metric
            label="Tax deducted (TDS)"
            value={formatINR(review.totals.tds, style)}
            detail="Liability to be remitted"
          />
          <Metric
            label="Employer contributions"
            value={formatINR(review.totals.employerContributions, style)}
            detail={`${employerShare.toFixed(1)}% of payroll cost`}
          />
        </div>

        <SCard className="overflow-hidden">
          <div className="border-b px-5 py-4">
            <h2 className="font-semibold">Vertical cost analysis</h2>
            <p className={`mt-0.5 text-sm ${SIGNAL_MUTED}`}>
              Headcount, payroll cost and cash requirement by vertical.
            </p>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Vertical</TableHead>
                <TableHead className="text-right">Employees</TableHead>
                <TableHead className="text-right">Gross</TableHead>
                <TableHead className="text-right">Employer cost</TableHead>
                <TableHead className="text-right">TDS</TableHead>
                <TableHead className="text-right">Net payable</TableHead>
                <TableHead className="min-w-52">Total cost</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {review.verticals.map((vertical) => (
                <TableRow key={vertical.verticalId ?? 'unassigned'}>
                  <TableCell className="font-medium">
                    {vertical.verticalName}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {vertical.employeeCount}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatINR(vertical.grossEarnings, style)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatINR(vertical.employerContributions, style)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatINR(vertical.tds, style)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatINR(vertical.netPay, style)}
                  </TableCell>
                  <TableCell>
                    <div className="font-medium tabular-nums">
                      {formatINR(vertical.totalExpense, style)}
                    </div>
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{
                          width: `${(Number(vertical.totalExpense) / maxVerticalCost) * 100}%`,
                        }}
                      />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </SCard>

        <SCard className="px-5 py-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <div className={SIGNAL_EYEBROW}>Unpaid leave deductions</div>
              <div className="mt-1 font-semibold tabular-nums">
                {formatINR(review.totals.unpaidLeaveDeduction, style)}
              </div>
            </div>
            <div>
              <div className={SIGNAL_EYEBROW}>Submitted at</div>
              <div className="mt-1 text-sm font-medium">
                {review.submittedAt
                  ? new Date(review.submittedAt).toLocaleString()
                  : '—'}
              </div>
            </div>
            <div>
              <div className={SIGNAL_EYEBROW}>Bank reference</div>
              <div className="mt-1 text-sm font-medium">
                {review.paymentBankReference ?? 'Not paid yet'}
              </div>
            </div>
          </div>
        </SCard>

        <div>
          <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="font-semibold">Employee payroll detail</h2>
              <p className={`mt-0.5 text-sm ${SIGNAL_MUTED}`}>
                Use this register to investigate the figures behind the control
                totals.
              </p>
            </div>
            <div className="grid w-full gap-2 sm:w-auto sm:grid-cols-[18rem_14rem]">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="pl-9"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search employee or designation"
                />
              </div>
              <Select
                value={verticalFilter}
                onChange={(event) => setVerticalFilter(event.target.value)}
              >
                <option value="">All verticals</option>
                {review.verticals.map((vertical) => (
                  <option
                    key={vertical.verticalId ?? 'unassigned'}
                    value={vertical.verticalId ?? 'unassigned'}
                  >
                    {vertical.verticalName}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <SCard className="overflow-hidden">
            {employees.length === 0 ? (
              <EmptyState title="No matching employees" />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Employee</TableHead>
                    <TableHead>Vertical</TableHead>
                    <TableHead className="text-right">Gross</TableHead>
                    <TableHead className="text-right">
                      Employer contribution
                    </TableHead>
                    <TableHead className="text-right">Unpaid leave</TableHead>
                    <TableHead className="text-right">TDS</TableHead>
                    <TableHead className="text-right">Net pay</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {employees.map((payslip) => (
                    <TableRow key={payslip.id}>
                      <TableCell>
                        <div className="font-medium">
                          {payslip.employee.firstName}{' '}
                          {payslip.employee.lastName}
                        </div>
                        <div className={`text-xs ${SIGNAL_MUTED}`}>
                          {payslip.employee.employeeId}
                          {payslip.employee.designation
                            ? ` · ${payslip.employee.designation}`
                            : ''}
                        </div>
                      </TableCell>
                      <TableCell>
                        {payslip.employee.vertical?.name ?? 'Not assigned'}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatINR(payslip.grossEarnings, style)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatINR(
                          Number(payslip.pfEmployer) +
                            Number(payslip.esiEmployer ?? 0),
                          style,
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatINR(payslip.unpaidLeaveDeduction, style)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatINR(payslip.tdsDeducted, style)}
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {formatINR(payslip.netPay, style)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </SCard>
        </div>
      </div>
    </SignalPage>
  );
}

function Metric({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <SCard className="px-5 py-4">
      <div className={SIGNAL_EYEBROW}>{label}</div>
      <div className="mt-2 text-xl font-semibold tabular-nums">{value}</div>
      <div className={`mt-1 text-xs ${SIGNAL_MUTED}`}>{detail}</div>
    </SCard>
  );
}
