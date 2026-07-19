'use client';

import { FormEvent, useEffect, useState } from 'react';
import { apiFetch, ApiError } from '../../../lib/api';
import { Button } from '../../../components/ui/button';
import { Card, CardContent } from '../../../components/ui/card';
import { Input } from '../../../components/ui/input';
import { PageContainer } from '../../../components/ui/page-container';
import { PageHeader } from '../../../components/ui/page-header';
import { Select } from '../../../components/ui/select';
import { useToast } from '../../../components/ui/toaster';

type AccountType = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'COST_OF_GOODS_SOLD' | 'EXPENSE' | 'OTHER_INCOME' | 'OTHER_EXPENSE';
interface Account { id: string; code: string; name: string; accountType: AccountType; normalBalance: 'DEBIT' | 'CREDIT'; isActive: boolean; }
interface FiscalYear { id: string; name: string; startsOn: string; endsOn: string; status: string; }

export default function FinanceAccountsPage() {
  const toast = useToast();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [years, setYears] = useState<FiscalYear[]>([]);
  const [code, setCode] = useState(''); const [name, setName] = useState('');
  const [accountType, setAccountType] = useState<AccountType>('ASSET');
  const [normalBalance, setNormalBalance] = useState<'DEBIT' | 'CREDIT'>('DEBIT');
  const [startYear, setStartYear] = useState(new Date().getMonth() >= 3 ? new Date().getFullYear() : new Date().getFullYear() - 1);
  const load = () => Promise.all([apiFetch<Account[]>('/finance/accounts'), apiFetch<FiscalYear[]>('/finance/fiscal-years')]).then(([a, y]) => { setAccounts(a); setYears(y); });
  useEffect(() => { load().catch((e) => toast.error(e instanceof ApiError ? e.message : 'Failed to load finance setup')); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function addAccount(event: FormEvent) {
    event.preventDefault();
    try {
      await apiFetch('/finance/accounts', { method: 'POST', body: JSON.stringify({ code, name, accountType, normalBalance }) });
      setCode(''); setName(''); toast.success('Ledger account created'); await load();
    } catch (e) { toast.error(e instanceof ApiError ? e.message : 'Failed to create account'); }
  }

  async function addFiscalYear() {
    try {
      await apiFetch('/finance/fiscal-years', { method: 'POST', body: JSON.stringify({ name: `FY ${startYear}-${String(startYear + 1).slice(-2)}`, startYear }) });
      toast.success('Fiscal year and 12 periods created'); await load();
    } catch (e) { toast.error(e instanceof ApiError ? e.message : 'Failed to create fiscal year'); }
  }

  return <PageContainer>
    <PageHeader title="Finance setup" description="India April–March fiscal periods and Chart of Accounts" />
    <Card className="mb-6"><CardContent className="p-5">
      <h2 className="mb-3 font-semibold">Fiscal years</h2>
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">Starting year<Input type="number" value={startYear} onChange={(e) => setStartYear(Number(e.target.value))} /></label>
        <Button onClick={addFiscalYear}>Create April–March year</Button>
      </div>
      <div className="mt-3 text-sm text-muted-foreground">{years.length ? years.map((y) => `${y.name} (${y.status})`).join(' · ') : 'No fiscal year configured.'}</div>
    </CardContent></Card>
    <Card className="mb-6"><CardContent className="p-5">
      <h2 className="mb-3 font-semibold">Add ledger account</h2>
      <form onSubmit={addAccount} className="grid gap-3 md:grid-cols-5">
        <Input required placeholder="Code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} />
        <Input required placeholder="Account name" value={name} onChange={(e) => setName(e.target.value)} />
        <Select value={accountType} onChange={(e) => setAccountType(e.target.value as AccountType)}>{['ASSET','LIABILITY','EQUITY','REVENUE','COST_OF_GOODS_SOLD','EXPENSE','OTHER_INCOME','OTHER_EXPENSE'].map((t) => <option key={t}>{t}</option>)}</Select>
        <Select value={normalBalance} onChange={(e) => setNormalBalance(e.target.value as 'DEBIT'|'CREDIT')}><option>DEBIT</option><option>CREDIT</option></Select>
        <Button type="submit">Add account</Button>
      </form>
    </CardContent></Card>
    <Card><CardContent className="overflow-x-auto p-0"><table className="w-full text-sm"><thead><tr className="border-b text-left"><th className="p-3">Code</th><th>Name</th><th>Type</th><th>Normal balance</th><th>Status</th></tr></thead><tbody>{accounts.map((a) => <tr key={a.id} className="border-b"><td className="p-3 font-mono">{a.code}</td><td>{a.name}</td><td>{a.accountType.replaceAll('_',' ')}</td><td>{a.normalBalance}</td><td>{a.isActive ? 'Active' : 'Inactive'}</td></tr>)}</tbody></table></CardContent></Card>
  </PageContainer>;
}
