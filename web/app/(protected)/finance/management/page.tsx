'use client';
import { FormEvent, useEffect, useState } from 'react';
import { apiFetch, ApiError } from '../../../lib/api';
import { useFinanceAccess } from '../../../lib/use-finance-access';
import { Button } from '../../../components/ui/button';
import { Card, CardContent } from '../../../components/ui/card';
import { Input } from '../../../components/ui/input';
import { Select } from '../../../components/ui/select';
import { PageContainer } from '../../../components/ui/page-container';
import { PageHeader } from '../../../components/ui/page-header';
import { useToast } from '../../../components/ui/toaster';
type Account = { id: string; code: string; name: string };
type Schedule = {
  id: string;
  scheduleNumber: string;
  name: string;
  scheduleType: string;
  status: string;
  amountPerRun: string;
  nextRunDate: string;
  remainingRuns?: number;
  debitAccount: Account;
  creditAccount: Account;
};
type Inventory = {
  itemCode: string;
  itemName: string;
  location: string;
  onHandQuantity: string;
  weightedAverageCost: string;
  estimatedValue: string;
  costBasis: string;
};
type Project = {
  projectId: string;
  projectName: string;
  orderNumber: string;
  customer: string;
  revenue: string;
  ledgerCost: string;
  estimatedMaterialCost: string;
  totalCost: string;
  grossProfit: string;
  marginPercent?: string;
};
export default function ManagementPage() {
  const toast = useToast(),
    { isAccountsHead } = useFinanceAccess();
  const [accounts, setAccounts] = useState<Account[]>([]),
    [schedules, setSchedules] = useState<Schedule[]>([]),
    [inventory, setInventory] = useState<Inventory[]>([]),
    [projects, setProjects] = useState<Project[]>([]),
    [name, setName] = useState('Monthly accrual'),
    [type, setType] = useState('ACCRUAL'),
    [debit, setDebit] = useState(''),
    [credit, setCredit] = useState(''),
    [amount, setAmount] = useState(''),
    [start, setStart] = useState(new Date().toISOString().slice(0, 10)),
    [runs, setRuns] = useState('12'),
    [project, setProject] = useState('');
  const now = new Date(),
    from = `${now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1}-04-01`,
    to = now.toISOString().slice(0, 10);
  const load = () =>
    Promise.all([
      apiFetch<Account[]>('/finance/accounts'),
      apiFetch<Schedule[]>('/finance/management/schedules'),
      apiFetch<Inventory[]>(
        `/finance/management/reports/inventory-valuation?asOf=${to}`,
      ),
      apiFetch<Project[]>(
        `/finance/management/reports/project-profitability?from=${from}&to=${to}`,
      ),
    ]).then(([a, s, i, p]) => {
      setAccounts(a);
      setSchedules(s);
      setInventory(i);
      setProjects(p);
      if (a[0]) {
        setDebit((v) => v || a[0].id);
        setCredit((v) => v || a[Math.min(1, a.length - 1)].id);
      }
    });
  useEffect(() => {
    load().catch((e) =>
      toast.error(e instanceof ApiError ? e.message : 'Failed'),
    );
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  async function create(e: FormEvent) {
    e.preventDefault();
    try {
      await apiFetch('/finance/management/schedules', {
        method: 'POST',
        body: JSON.stringify({
          name,
          scheduleType: type,
          debitAccountId: debit,
          creditAccountId: credit,
          amountPerRun: Number(amount),
          startDate: start,
          remainingRuns: Number(runs),
          projectReference: project || undefined,
        }),
      });
      setAmount('');
      await load();
    } catch (x) {
      toast.error(x instanceof ApiError ? x.message : 'Failed');
    }
  }
  async function action(id: string, a: string, body?: unknown) {
    try {
      await apiFetch(`/finance/management/schedules/${id}/${a}`, {
        method: 'POST',
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      await load();
    } catch (x) {
      toast.error(x instanceof ApiError ? x.message : 'Failed');
    }
  }
  async function run() {
    try {
      const r = await apiFetch<{ executionsCreated: number; total: string }>(
        '/finance/management/schedules/run-due',
        { method: 'POST', body: JSON.stringify({ asOf: to }) },
      );
      toast.success(`${r.executionsCreated} scheduled journals · ₹${r.total}`);
      await load();
    } catch (x) {
      toast.error(x instanceof ApiError ? x.message : 'Failed');
    }
  }
  return (
    <PageContainer>
      <PageHeader
        title="Schedules & Management Analytics"
        description="Approved recurring journals, accruals, prepayments, estimated inventory value and project profitability"
      />
      <Card className="mb-6">
        <CardContent className="p-5">
          <form onSubmit={create} className="grid gap-3 md:grid-cols-4">
            <Input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Schedule name"
            />
            <Select value={type} onChange={(e) => setType(e.target.value)}>
              <option>RECURRING_JOURNAL</option>
              <option>ACCRUAL</option>
              <option>PREPAYMENT</option>
              <option>PROVISION</option>
            </Select>
            <Select value={debit} onChange={(e) => setDebit(e.target.value)}>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  Dr {a.code} · {a.name}
                </option>
              ))}
            </Select>
            <Select value={credit} onChange={(e) => setCredit(e.target.value)}>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  Cr {a.code} · {a.name}
                </option>
              ))}
            </Select>
            <Input
              required
              type="number"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="Amount per month"
            />
            <Input
              required
              type="date"
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
            <Input
              required
              type="number"
              value={runs}
              onChange={(e) => setRuns(e.target.value)}
              placeholder="Number of runs"
            />
            <Input
              value={project}
              onChange={(e) => setProject(e.target.value)}
              placeholder="Project reference"
            />
            <Button type="submit">Create schedule</Button>
            {isAccountsHead && (
              <Button type="button" variant="outline" onClick={run}>
                Run due schedules
              </Button>
            )}
          </form>
        </CardContent>
      </Card>
      <Card className="mb-6">
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="p-3">Schedule</th>
                <th>Type</th>
                <th>Posting</th>
                <th>Amount</th>
                <th>Next run</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {schedules.map((s) => (
                <tr className="border-b" key={s.id}>
                  <td className="p-3 font-mono">
                    {s.scheduleNumber}
                    <br />
                    {s.name}
                  </td>
                  <td>{s.scheduleType.replaceAll('_', ' ')}</td>
                  <td>
                    Dr {s.debitAccount.code} / Cr {s.creditAccount.code}
                  </td>
                  <td>₹ {s.amountPerRun}</td>
                  <td>{s.nextRunDate.slice(0, 10)}</td>
                  <td>{s.status}</td>
                  <td className="space-x-1">
                    {['DRAFT', 'REJECTED'].includes(s.status) && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => action(s.id, 'submit')}
                      >
                        Submit
                      </Button>
                    )}
                    {isAccountsHead && s.status === 'PENDING_APPROVAL' && (
                      <>
                        <Button
                          size="sm"
                          onClick={() => action(s.id, 'approve')}
                        >
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() =>
                            action(s.id, 'reject', {
                              comment: window.prompt('Reason') || '',
                            })
                          }
                        >
                          Reject
                        </Button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
      <Card className="mb-6">
        <CardContent className="p-0 overflow-x-auto">
          <h2 className="p-4 font-semibold">Estimated Inventory Valuation</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="p-3">Item</th>
                <th>Location</th>
                <th>On hand</th>
                <th>Weighted average</th>
                <th>Estimated value</th>
                <th>Basis</th>
              </tr>
            </thead>
            <tbody>
              {inventory.map((i, n) => (
                <tr className="border-b" key={n}>
                  <td className="p-3">
                    {i.itemCode} · {i.itemName}
                  </td>
                  <td>{i.location}</td>
                  <td>{i.onHandQuantity}</td>
                  <td>₹ {i.weightedAverageCost}</td>
                  <td>₹ {i.estimatedValue}</td>
                  <td>{i.costBasis}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <h2 className="p-4 font-semibold">
            Project Profitability — Current FY
          </h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="p-3">Project</th>
                <th>Customer</th>
                <th>Revenue</th>
                <th>Ledger cost</th>
                <th>Material estimate</th>
                <th>Total cost</th>
                <th>Gross profit</th>
                <th>Margin</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => (
                <tr className="border-b" key={p.projectId}>
                  <td className="p-3">
                    {p.projectName}
                    <br />
                    <span className="font-mono text-xs">{p.orderNumber}</span>
                  </td>
                  <td>{p.customer}</td>
                  <td>₹ {p.revenue}</td>
                  <td>₹ {p.ledgerCost}</td>
                  <td>₹ {p.estimatedMaterialCost}</td>
                  <td>₹ {p.totalCost}</td>
                  <td>₹ {p.grossProfit}</td>
                  <td>{p.marginPercent ?? '—'}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </PageContainer>
  );
}
