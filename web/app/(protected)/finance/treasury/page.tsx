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
type Run = {
  id: string;
  runNumber: string;
  status: string;
  totalGainInr: string;
  totalLossInr: string;
  lines: unknown[];
};
type Advance = {
  side: string;
  sourceId: string;
  number: string;
  party: string;
  currencyCode: string;
  available: string;
};
type Dashboard = {
  runs: Run[];
  controls: {
    customerId: string;
    creditLimitInr: string;
    overdueGraceDays: number;
  }[];
  advances: Advance[];
};
type Customer = { id: string; name: string };
type Account = { id: string; code: string; name: string; accountType: string };
type Period = { id: string; name: string; status: string };
type Fy = { name: string; periods: Period[] };
export default function TreasuryPage() {
  const toast = useToast(),
    { isAccountsHead } = useFinanceAccess();
  const [data, setData] = useState<Dashboard>(),
    [customers, setCustomers] = useState<Customer[]>([]),
    [accounts, setAccounts] = useState<Account[]>([]),
    [periods, setPeriods] = useState<Period[]>([]);
  const [customerId, setCustomerId] = useState(''),
    [limit, setLimit] = useState(''),
    [grace, setGrace] = useState('0');
  const [periodId, setPeriodId] = useState(''),
    [rates, setRates] = useState('{"USD": 84.50, "CAD": 61.75, "EUR": 91.25}'),
    [gain, setGain] = useState(''),
    [loss, setLoss] = useState('');
  const fail = (e: unknown) =>
    toast.error(e instanceof ApiError ? e.message : 'Operation failed');
  const load = () =>
    Promise.all([
      apiFetch<Dashboard>('/finance/treasury'),
      apiFetch<Customer[]>('/finance/ar/reference/customers'),
      apiFetch<Account[]>('/finance/accounts'),
      apiFetch<Fy[]>('/finance/fiscal-years'),
    ])
      .then(([d, c, a, y]) => {
        setData(d);
        setCustomers(c);
        setAccounts(a);
        const ps = y
          .flatMap((x) => x.periods)
          .filter((x) => x.status === 'OPEN');
        setPeriods(ps);
        if (!customerId && c[0]) setCustomerId(c[0].id);
        if (!periodId && ps[0]) setPeriodId(ps[0].id);
      })
      .catch(fail);
  useEffect(() => {
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  async function action(path: string, body?: object) {
    try {
      await apiFetch(path, {
        method: 'POST',
        body: JSON.stringify(body ?? {}),
      });
      toast.success('Treasury controls updated');
      await load();
    } catch (e) {
      fail(e);
    }
  }
  async function saveCredit(e: FormEvent) {
    e.preventDefault();
    await action('/finance/treasury/credit-controls', {
      customerId,
      creditLimitInr: Number(limit),
      overdueGraceDays: Number(grace),
      blockOnLimit: true,
      blockOnOverdue: true,
    });
  }
  async function createFx(e: FormEvent) {
    e.preventDefault();
    try {
      await action('/finance/treasury/fx-runs', {
        periodId,
        closingRates: JSON.parse(rates),
        gainAccountId: gain,
        lossAccountId: loss,
      });
    } catch (e) {
      fail(e);
    }
  }
  async function apply(a: Advance) {
    const targetInvoiceId = window.prompt(
        `Target ${a.side === 'CUSTOMER' ? 'sales' : 'vendor'} invoice ID`,
      ),
      amount = window.prompt(
        `Amount available ${a.available} ${a.currencyCode}`,
      );
    if (targetInvoiceId && amount)
      await action('/finance/treasury/advances/apply', {
        side: a.side,
        sourceId: a.sourceId,
        targetInvoiceId,
        applicationDate: new Date().toISOString().slice(0, 10),
        amount: Number(amount),
      });
  }
  return (
    <PageContainer>
      <PageHeader
        title="Treasury & Credit Controls"
        description="Foreign-currency revaluation, customer credit governance, advances, and provisions"
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardContent className="p-5">
            <h2 className="mb-3 font-semibold">Customer Credit Control</h2>
            <form className="grid gap-3" onSubmit={saveCredit}>
              <Select
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
              >
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
              <Input
                required
                type="number"
                value={limit}
                onChange={(e) => setLimit(e.target.value)}
                placeholder="Credit limit INR"
              />
              <Input
                type="number"
                value={grace}
                onChange={(e) => setGrace(e.target.value)}
                placeholder="Overdue grace days"
              />
              {isAccountsHead && (
                <Button type="submit">Save credit control</Button>
              )}
            </form>
            <div className="mt-4 text-sm">
              {(data?.controls ?? []).map((x) => (
                <div key={x.customerId} className="border-b py-2">
                  {customers.find((c) => c.id === x.customerId)?.name ??
                    x.customerId}{' '}
                  · ₹{x.creditLimitInr} · {x.overdueGraceDays} grace days
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <h2 className="mb-3 font-semibold">Period-end FX Revaluation</h2>
            <form className="grid gap-3" onSubmit={createFx}>
              <Select
                value={periodId}
                onChange={(e) => setPeriodId(e.target.value)}
              >
                {periods.map((p) => (
                  <option value={p.id} key={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
              <textarea
                className="min-h-20 rounded border bg-background p-2 font-mono text-xs"
                value={rates}
                onChange={(e) => setRates(e.target.value)}
              />
              <Select
                required
                value={gain}
                onChange={(e) => setGain(e.target.value)}
              >
                <option value="">FX gain account</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} · {a.name}
                  </option>
                ))}
              </Select>
              <Select
                required
                value={loss}
                onChange={(e) => setLoss(e.target.value)}
              >
                <option value="">FX loss account</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} · {a.name}
                  </option>
                ))}
              </Select>
              {isAccountsHead && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    action('/finance/treasury/fx-settings', {
                      gainAccountId: gain,
                      lossAccountId: loss,
                    })
                  }
                >
                  Save realized FX accounts
                </Button>
              )}
              <Button type="submit">Prepare FX run</Button>
            </form>
          </CardContent>
        </Card>
      </div>
      <Card className="mt-6">
        <CardContent className="p-5">
          <h2 className="mb-3 font-semibold">FX Runs</h2>
          {(data?.runs ?? []).map((r) => (
            <div
              className="flex flex-wrap items-center justify-between border-b py-3 text-sm"
              key={r.id}
            >
              <span>
                <b>{r.runNumber}</b> · {r.status} · Gain ₹{r.totalGainInr} ·
                Loss ₹{r.totalLossInr} · {r.lines.length} documents
              </span>
              <div className="flex gap-2">
                {r.status === 'DRAFT' && (
                  <Button
                    size="sm"
                    onClick={() =>
                      action(`/finance/treasury/fx-runs/${r.id}/submit`)
                    }
                  >
                    Submit
                  </Button>
                )}
                {isAccountsHead && r.status === 'PENDING_APPROVAL' && (
                  <Button
                    size="sm"
                    onClick={() =>
                      action(`/finance/treasury/fx-runs/${r.id}/approve`)
                    }
                  >
                    Approve & post
                  </Button>
                )}
                {isAccountsHead && r.status === 'POSTED' && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      action(`/finance/treasury/fx-runs/${r.id}/reverse`, {
                        reversalDate: new Date().toISOString().slice(0, 10),
                      })
                    }
                  >
                    Reverse
                  </Button>
                )}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
      <Card className="mt-6">
        <CardContent className="p-5">
          <h2 className="mb-3 font-semibold">
            Unapplied Customer & Vendor Advances
          </h2>
          {(data?.advances ?? []).map((a) => (
            <div
              className="flex items-center justify-between border-b py-3 text-sm"
              key={`${a.side}:${a.sourceId}`}
            >
              <span>
                <b>{a.number}</b> · {a.party} · {a.available} {a.currencyCode}
              </span>
              {isAccountsHead && (
                <Button size="sm" onClick={() => apply(a)}>
                  Apply
                </Button>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
      <p className="mt-4 text-xs text-muted-foreground">
        Provision schedules are maintained under Schedules & Analytics using the
        PROVISION schedule type.
      </p>
    </PageContainer>
  );
}
