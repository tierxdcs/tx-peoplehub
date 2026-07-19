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
type Dashboard = {
  kpis: Record<string, string>;
  pnl: Record<string, string>;
  balanceSheet: {
    assets: string;
    liabilities: string;
    equity: string;
    difference: string;
  };
  cashFlow: {
    openingCash: string;
    operating: string;
    investing: string;
    financing: string;
    unclassified: string;
    netChange: string;
    closingCash: string;
  };
};
type Pack = {
  id: string;
  packNumber: string;
  title: string;
  status: string;
  periodFrom: string;
  periodTo: string;
};
type Fy = {
  id: string;
  name: string;
  status: string;
  periods: { status: string }[];
};
type Account = {
  id: string;
  code: string;
  name: string;
  accountType: string;
  cashFlowCategory?: string;
};
type Rollover = {
  id: string;
  status: string;
  sourceFiscalYearId: string;
  targetFiscalYearId: string;
  openingBalances: unknown[];
};
export default function ExecutivePage() {
  const toast = useToast(),
    { isAccountsHead, isFinanceAuditor, loading: financeLoading } = useFinanceAccess(),
    now = new Date(),
    start = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  const [from, setFrom] = useState(`${start}-04-01`),
    [to, setTo] = useState(now.toISOString().slice(0, 10)),
    [data, setData] = useState<Dashboard>(),
    [packs, setPacks] = useState<Pack[]>([]),
    [years, setYears] = useState<Fy[]>([]),
    [accounts, setAccounts] = useState<Account[]>([]),
    [rollovers, setRollovers] = useState<Rollover[]>([]),
    [title, setTitle] = useState('Monthly Management Pack'),
    [source, setSource] = useState(''),
    [target, setTarget] = useState(''),
    [retained, setRetained] = useState(''),
    [mapAccount, setMapAccount] = useState(''),
    [category, setCategory] = useState('OPERATING');
  const fail = (e: unknown) =>
    toast.error(e instanceof ApiError ? e.message : 'Operation failed');
  async function load() {
    try {
      const q = `from=${from}&to=${to}`;
      if (isFinanceAuditor) {
        const [d, p, r] = await Promise.all([
          apiFetch<Dashboard>(`/finance/reporting/dashboard?${q}`),
          apiFetch<Pack[]>('/finance/reporting/packs'),
          apiFetch<Rollover[]>('/finance/reporting/rollovers'),
        ]);
        setData(d); setPacks(p); setRollovers(r); return;
      }
      const [d, p, y, a, r] = await Promise.all([
        apiFetch<Dashboard>(`/finance/reporting/dashboard?${q}`),
        apiFetch<Pack[]>('/finance/reporting/packs'),
        apiFetch<Fy[]>('/finance/fiscal-years'),
        apiFetch<Account[]>('/finance/accounts'),
        apiFetch<Rollover[]>('/finance/reporting/rollovers'),
      ]);
      setData(d);
      setPacks(p);
      setYears(y);
      setAccounts(a);
      setRollovers(r);
    } catch (e) {
      fail(e);
    }
  }
  useEffect(() => {
    if (!financeLoading) load();
  }, [financeLoading]); // eslint-disable-line react-hooks/exhaustive-deps
  async function action(path: string, body?: object, method = 'POST') {
    try {
      await apiFetch(path, { method, body: JSON.stringify(body ?? {}) });
      toast.success('Executive reporting updated');
      await load();
    } catch (e) {
      fail(e);
    }
  }
  async function pack(e: FormEvent) {
    e.preventDefault();
    await action('/finance/reporting/packs', { title, from, to });
  }
  async function rollover(e: FormEvent) {
    e.preventDefault();
    await action('/finance/reporting/rollovers', {
      sourceFiscalYearId: source,
      targetFiscalYearId: target,
      retainedEarningsAccountId: retained,
    });
  }
  async function downloadPack(p: Pack) {
    try {
      const file = await apiFetch<{ fileName: string; contentType: string; content: string }>(
        `/finance/operations/management-packs/${p.id}/export.csv`,
      );
      const url = URL.createObjectURL(new Blob([file.content], { type: file.contentType }));
      const a = document.createElement('a'); a.href = url; a.download = file.fileName; a.click(); URL.revokeObjectURL(url);
    } catch (e) { fail(e); }
  }
  return (
    <PageContainer>
      <PageHeader
        title="Executive Finance & Year End"
        description="Approved management packs, cash flow, balance-sheet schedules, auditor access, and controlled rollover"
      />
      <Card className="mb-6">
        <CardContent className="flex flex-wrap gap-3 p-5">
          <Input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
          <Input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
          <Button onClick={load}>Refresh dashboard</Button>
        </CardContent>
      </Card>
      {data && (
        <>
          <div className="mb-6 grid gap-3 md:grid-cols-4">
            {Object.entries(data.kpis).map(([k, v]) => (
              <Card key={k}>
                <CardContent className="p-4">
                  <div className="text-xs text-muted-foreground">
                    {k.replace(/([A-Z])/g, ' $1')}
                  </div>
                  <div className="text-xl font-semibold">
                    {k === 'dso' ? `${v} days` : `₹${v}`}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
          <div className="mb-6 grid gap-6 lg:grid-cols-2">
            <Card>
              <CardContent className="p-5">
                <h2 className="font-semibold">Cash Flow</h2>
                {Object.entries(data.cashFlow).map(([k, v]) => (
                  <div
                    className="flex justify-between border-b py-2 text-sm"
                    key={k}
                  >
                    <span>{k.replace(/([A-Z])/g, ' $1')}</span>
                    <b>₹{v}</b>
                  </div>
                ))}
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <h2 className="font-semibold">Balance Sheet</h2>
                {Object.entries(data.balanceSheet).map(([k, v]) => (
                  <div
                    className="flex justify-between border-b py-2 text-sm"
                    key={k}
                  >
                    <span>{k}</span>
                    <b>₹{v}</b>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </>
      )}
      <Card className="mb-6">
        <CardContent className="p-5">
          <h2 className="mb-3 font-semibold">Management Reporting Packs</h2>
          {!isFinanceAuditor && <form className="mb-4 flex gap-2" onSubmit={pack}>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
            <Button type="submit">Create snapshot pack</Button>
          </form>}
          {packs.map((p) => (
            <div
              className="flex flex-wrap items-center justify-between border-b py-3 text-sm"
              key={p.id}
            >
              <span>
                <b>{p.packNumber}</b> · {p.title} · {p.status}
              </span>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => downloadPack(p)}>CSV</Button>
                {p.status === 'DRAFT' && (
                  <Button
                    size="sm"
                    onClick={() =>
                      action(`/finance/reporting/packs/${p.id}/submit`)
                    }
                  >
                    Submit
                  </Button>
                )}
                {isAccountsHead && p.status === 'PENDING_APPROVAL' && (
                  <Button
                    size="sm"
                    onClick={() =>
                      action(`/finance/reporting/packs/${p.id}/approve`)
                    }
                  >
                    Approve
                  </Button>
                )}
                {isAccountsHead && p.status === 'APPROVED' && (
                  <Button
                    size="sm"
                    onClick={() =>
                      action(`/finance/reporting/packs/${p.id}/publish`)
                    }
                  >
                    Publish
                  </Button>
                )}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
      {isAccountsHead && (
        <div className="mb-6">
          <Card>
            <CardContent className="p-5">
              <h2 className="mb-3 font-semibold">Cash-flow Mapping</h2>
              <Select
                value={mapAccount}
                onChange={(e) => setMapAccount(e.target.value)}
              >
                <option value="">Select account</option>
                {accounts.map((a) => (
                  <option value={a.id} key={a.id}>
                    {a.code} · {a.name}{' '}
                    {a.cashFlowCategory ? `(${a.cashFlowCategory})` : ''}
                  </option>
                ))}
              </Select>
              <Select
                className="mt-2"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                <option>OPERATING</option>
                <option>INVESTING</option>
                <option>FINANCING</option>
                <option>NON_CASH</option>
              </Select>
              <Button
                className="mt-2"
                onClick={() =>
                  action(
                    `/finance/reporting/accounts/${mapAccount}/cash-flow/${category}`,
                    {},
                    'PATCH',
                  )
                }
              >
                Save mapping
              </Button>
            </CardContent>
          </Card>
        </div>
      )}
      <Card>
        <CardContent className="p-5">
          <h2 className="mb-3 font-semibold">Financial-year Rollover</h2>
          {!isFinanceAuditor && <form className="grid gap-3 md:grid-cols-4" onSubmit={rollover}>
            <Select
              required
              value={source}
              onChange={(e) => setSource(e.target.value)}
            >
              <option value="">Closed source year</option>
              {years.map((y) => (
                <option value={y.id} key={y.id}>
                  {y.name}
                </option>
              ))}
            </Select>
            <Select
              required
              value={target}
              onChange={(e) => setTarget(e.target.value)}
            >
              <option value="">Target year</option>
              {years.map((y) => (
                <option value={y.id} key={y.id}>
                  {y.name}
                </option>
              ))}
            </Select>
            <Select
              required
              value={retained}
              onChange={(e) => setRetained(e.target.value)}
            >
              <option value="">Retained earnings account</option>
              {accounts
                .filter((a) => a.accountType === 'EQUITY')
                .map((a) => (
                  <option value={a.id} key={a.id}>
                    {a.code} · {a.name}
                  </option>
                ))}
            </Select>
            <Button type="submit">Prepare rollover</Button>
          </form>}
          <div className="mt-4">
            {rollovers.map((r) => (
              <div
                className="flex justify-between border-b py-3 text-sm"
                key={r.id}
              >
                <span>
                  {r.status} · {r.openingBalances.length} opening balances
                </span>
                <div>
                  {r.status === 'DRAFT' && (
                    <Button
                      size="sm"
                      onClick={() =>
                        action(`/finance/reporting/rollovers/${r.id}/submit`)
                      }
                    >
                      Submit
                    </Button>
                  )}
                  {isAccountsHead && r.status === 'PENDING_APPROVAL' && (
                    <Button
                      size="sm"
                      onClick={() =>
                        action(`/finance/reporting/rollovers/${r.id}/approve`)
                      }
                    >
                      Approve rollover
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </PageContainer>
  );
}
