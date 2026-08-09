'use client';

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../../components/ui/table';
import { FormEvent, useEffect, useState } from 'react';
import { apiFetch, ApiError } from '../../../lib/api';
import { useFinanceAccess } from '../../../lib/use-finance-access';
import { formatINR } from '../../../lib/sales';
import { useNumberFormat } from '../../../lib/number-format-context';
import { Button } from '../../../components/ui/button';
import { Card, CardContent } from '../../../components/ui/card';
import { Input } from '../../../components/ui/input';
import { Select } from '../../../components/ui/select';
import { PageContainer } from '../../../components/ui/page-container';
import { PageHeader } from '../../../components/ui/page-header';
import { useToast } from '../../../components/ui/toaster';
type Period = { id: string; name: string };
type FY = { id: string; name: string; periods: Period[] };
type Account = { id: string; code: string; name: string };
type Cost = { id: string; code: string; name: string };
type Line = {
  periodId: string;
  accountId: string;
  costCenterId?: string;
  projectReference?: string;
  amount: number;
};
type Budget = {
  id: string;
  name: string;
  status: string;
  fiscalYear: FY;
  lines: { amount: string }[];
};
type Variance = {
  period: string;
  accountCode: string;
  accountName: string;
  costCenter?: string;
  projectReference?: string;
  budget: string;
  actual: string;
  variance: string;
  variancePercent?: string;
};
export default function BudgetsPage() {
  const toast = useToast(),
    { isAccountsHead } = useFinanceAccess();
  const { style: numberFormatStyle } = useNumberFormat();
  const [years, setYears] = useState<FY[]>([]),
    [accounts, setAccounts] = useState<Account[]>([]),
    [costs, setCosts] = useState<Cost[]>([]),
    [budgets, setBudgets] = useState<Budget[]>([]),
    [variance, setVariance] = useState<Variance[]>([]),
    [name, setName] = useState('Annual Operating Budget'),
    [fyId, setFyId] = useState(''),
    [periodId, setPeriodId] = useState(''),
    [accountId, setAccountId] = useState(''),
    [costId, setCostId] = useState(''),
    [project, setProject] = useState(''),
    [amount, setAmount] = useState(''),
    [lines, setLines] = useState<Line[]>([]);
  const fy = years.find((y) => y.id === fyId);
  const load = () =>
    Promise.all([
      apiFetch<FY[]>('/finance/fiscal-years'),
      apiFetch<Account[]>('/finance/accounts'),
      apiFetch<Cost[]>('/finance/cost-centers'),
      apiFetch<Budget[]>('/finance/management/budgets'),
    ]).then(([y, a, c, b]) => {
      setYears(y);
      setAccounts(a);
      setCosts(c);
      setBudgets(b);
      if (!fyId && y[0]) {
        setFyId(y[0].id);
        setPeriodId(y[0].periods[0]?.id || '');
      }
      if (!accountId && a[0]) setAccountId(a[0].id);
    });
  useEffect(() => {
    load().catch((e) =>
      toast.error(e instanceof ApiError ? e.message : 'Failed'),
    );
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  function addLine() {
    if (!periodId || !accountId || !amount) return;
    setLines([
      ...lines,
      {
        periodId,
        accountId,
        costCenterId: costId || undefined,
        projectReference: project || undefined,
        amount: Number(amount),
      },
    ]);
    setAmount('');
  }
  async function create(e: FormEvent) {
    e.preventDefault();
    try {
      await apiFetch('/finance/management/budgets', {
        method: 'POST',
        body: JSON.stringify({ name, fiscalYearId: fyId, lines }),
      });
      setLines([]);
      toast.success('Draft budget created');
      await load();
    } catch (x) {
      toast.error(x instanceof ApiError ? x.message : 'Failed');
    }
  }
  async function action(id: string, a: string, body?: unknown) {
    try {
      await apiFetch(`/finance/management/budgets/${id}/${a}`, {
        method: 'POST',
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      await load();
    } catch (x) {
      toast.error(x instanceof ApiError ? x.message : 'Failed');
    }
  }
  async function view(id: string) {
    try {
      setVariance(
        await apiFetch<Variance[]>(
          `/finance/management/budgets/${id}/variance`,
        ),
      );
    } catch (x) {
      toast.error(
        x instanceof ApiError ? x.message : 'Budget must be approved',
      );
    }
  }
  return (
    <PageContainer>
      <PageHeader
        title="Budgets & Variance"
        description="April–March budgets by month, ledger, cost centre and project with Finance Head approval"
      />
      <Card className="mb-6">
        <CardContent className="p-5">
          <form onSubmit={create}>
            <div className="grid gap-3 md:grid-cols-4">
              <Input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Budget name"
              />
              <Select
                value={fyId}
                onChange={(e) => {
                  setFyId(e.target.value);
                  const y = years.find((x) => x.id === e.target.value);
                  setPeriodId(y?.periods[0]?.id || '');
                }}
              >
                {years.map((y) => (
                  <option key={y.id} value={y.id}>
                    {y.name}
                  </option>
                ))}
              </Select>
              <Select
                value={periodId}
                onChange={(e) => setPeriodId(e.target.value)}
              >
                {fy?.periods.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
              <Select
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} · {a.name}
                  </option>
                ))}
              </Select>
              <Select
                value={costId}
                onChange={(e) => setCostId(e.target.value)}
              >
                <option value="">All / no cost centre</option>
                {costs.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} · {c.name}
                  </option>
                ))}
              </Select>
              <Input
                value={project}
                onChange={(e) => setProject(e.target.value)}
                placeholder="Project reference (optional)"
              />
              <Input
                type="number"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="Budget INR"
              />
              <Button type="button" variant="outline" onClick={addLine}>
                Add line ({lines.length})
              </Button>
              <Button type="submit" disabled={!lines.length}>
                Create budget
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
      <Card className="mb-6">
        <CardContent className="p-0 overflow-x-auto">
          <Table className="w-full text-sm">
            <TableHeader>
              <TableRow className="border-b text-left">
                <TableHead className="p-3">Budget</TableHead>
                <TableHead>FY</TableHead>
                <TableHead>Lines</TableHead>
                <TableHead>Total</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {budgets.map((b) => (
                <TableRow className="border-b" key={b.id}>
                  <TableCell className="p-3 font-medium">{b.name}</TableCell>
                  <TableCell>{b.fiscalYear.name}</TableCell>
                  <TableCell>{b.lines.length}</TableCell>
                  <TableCell>
                    {formatINR(
                      b.lines.reduce((s, l) => s + Number(l.amount), 0),
                      numberFormatStyle,
                    )}
                  </TableCell>
                  <TableCell>{b.status}</TableCell>
                  <TableCell className="space-x-1">
                    {['DRAFT', 'REJECTED'].includes(b.status) && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => action(b.id, 'submit')}
                      >
                        Submit
                      </Button>
                    )}
                    {isAccountsHead && b.status === 'PENDING_APPROVAL' && (
                      <>
                        <Button
                          size="sm"
                          onClick={() => action(b.id, 'approve')}
                        >
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() =>
                            action(b.id, 'reject', {
                              comment: window.prompt('Reason') || '',
                            })
                          }
                        >
                          Reject
                        </Button>
                      </>
                    )}
                    {['APPROVED', 'LOCKED'].includes(b.status) && (
                      <Button size="sm" onClick={() => view(b.id)}>
                        Variance
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      {variance.length > 0 && (
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <Table className="w-full text-sm">
              <TableHeader>
                <TableRow className="border-b text-left">
                  <TableHead className="p-3">Period</TableHead>
                  <TableHead>Account</TableHead>
                  <TableHead>Dimension</TableHead>
                  <TableHead>Budget</TableHead>
                  <TableHead>Actual</TableHead>
                  <TableHead>Variance</TableHead>
                  <TableHead>%</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {variance.map((v, i) => (
                  <TableRow className="border-b" key={i}>
                    <TableCell className="p-3">{v.period}</TableCell>
                    <TableCell>
                      {v.accountCode} · {v.accountName}
                    </TableCell>
                    <TableCell>{v.costCenter || v.projectReference || 'Company'}</TableCell>
                    <TableCell>{formatINR(v.budget, numberFormatStyle)}</TableCell>
                    <TableCell>{formatINR(v.actual, numberFormatStyle)}</TableCell>
                    <TableCell>{formatINR(v.variance, numberFormatStyle)}</TableCell>
                    <TableCell>{v.variancePercent ?? '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </PageContainer>
  );
}
