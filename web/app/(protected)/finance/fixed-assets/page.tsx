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
type Asset = {
  id: string;
  assetNumber: string;
  name: string;
  status: string;
  originalCost: string;
  residualValue: string;
  usefulLifeMonths: number;
  accumulatedDepreciation: string;
  capitalizationDate: string;
  location?: string;
};
export default function FixedAssetsPage() {
  const toast = useToast(),
    { isAccountsHead } = useFinanceAccess();
  const [accounts, setAccounts] = useState<Account[]>([]),
    [assets, setAssets] = useState<Asset[]>([]),
    [name, setName] = useState(''),
    [cost, setCost] = useState(''),
    [residual, setResidual] = useState('0'),
    [life, setLife] = useState('60'),
    [date, setDate] = useState(new Date().toISOString().slice(0, 10)),
    [location, setLocation] = useState(''),
    [assetAccount, setAssetAccount] = useState(''),
    [accum, setAccum] = useState(''),
    [expense, setExpense] = useState(''),
    [credit, setCredit] = useState('');
  const load = () =>
    Promise.all([
      apiFetch<Account[]>('/finance/accounts'),
      apiFetch<Asset[]>('/finance/management/assets'),
    ]).then(([a, x]) => {
      setAccounts(a);
      setAssets(x);
      if (a[0]) {
        setAssetAccount((v) => v || a[0].id);
        setAccum((v) => v || a[0].id);
        setExpense((v) => v || a[0].id);
        setCredit((v) => v || a[0].id);
      }
    });
  useEffect(() => {
    load().catch((e) =>
      toast.error(e instanceof ApiError ? e.message : 'Failed'),
    );
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const options = accounts.map((a) => (
    <option key={a.id} value={a.id}>
      {a.code} · {a.name}
    </option>
  ));
  async function create(e: FormEvent) {
    e.preventDefault();
    try {
      await apiFetch('/finance/management/assets', {
        method: 'POST',
        body: JSON.stringify({
          name,
          purchaseDate: date,
          capitalizationDate: date,
          originalCost: Number(cost),
          residualValue: Number(residual),
          usefulLifeMonths: Number(life),
          location,
          assetAccountId: assetAccount,
          accumulatedDepreciationAccountId: accum,
          depreciationExpenseAccountId: expense,
          acquisitionCreditAccountId: credit,
        }),
      });
      setName('');
      setCost('');
      await load();
    } catch (x) {
      toast.error(x instanceof ApiError ? x.message : 'Failed');
    }
  }
  async function action(id: string, a: string, body?: unknown) {
    try {
      await apiFetch(`/finance/management/assets/${id}/${a}`, {
        method: 'POST',
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      await load();
    } catch (x) {
      toast.error(x instanceof ApiError ? x.message : 'Failed');
    }
  }
  async function depreciate() {
    try {
      const r = await apiFetch<{ entriesCreated: number; total: string }>(
        '/finance/management/assets/run-depreciation',
        {
          method: 'POST',
          body: JSON.stringify({ asOf: new Date().toISOString().slice(0, 10) }),
        },
      );
      toast.success(`${r.entriesCreated} depreciation entries · ₹${r.total}`);
      await load();
    } catch (x) {
      toast.error(x instanceof ApiError ? x.message : 'Failed');
    }
  }
  return (
    <PageContainer>
      <PageHeader
        title="Fixed Assets"
        description="Capitalisation approval, straight-line depreciation and automatic ledger postings"
      />
      <Card className="mb-6">
        <CardContent className="p-5">
          <form onSubmit={create} className="grid gap-3 md:grid-cols-4">
            <Input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Asset name"
            />
            <Input
              required
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
            <Input
              required
              type="number"
              step="0.01"
              value={cost}
              onChange={(e) => setCost(e.target.value)}
              placeholder="Original cost"
            />
            <Input
              type="number"
              step="0.01"
              value={residual}
              onChange={(e) => setResidual(e.target.value)}
              placeholder="Residual value"
            />
            <Input
              required
              type="number"
              value={life}
              onChange={(e) => setLife(e.target.value)}
              placeholder="Useful life months"
            />
            <Input
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Location"
            />
            <Select
              value={assetAccount}
              onChange={(e) => setAssetAccount(e.target.value)}
            >
              {options}
            </Select>
            <Select value={accum} onChange={(e) => setAccum(e.target.value)}>
              {options}
            </Select>
            <Select
              value={expense}
              onChange={(e) => setExpense(e.target.value)}
            >
              {options}
            </Select>
            <Select value={credit} onChange={(e) => setCredit(e.target.value)}>
              {options}
            </Select>
            <Button type="submit">Create asset</Button>
            {isAccountsHead && (
              <Button type="button" variant="outline" onClick={depreciate}>
                Run current depreciation
              </Button>
            )}
          </form>
          <div className="mt-2 text-xs text-muted-foreground">
            Account order: asset cost, accumulated depreciation, depreciation
            expense, acquisition credit/clearing.
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="p-3">Asset</th>
                <th>Capitalised</th>
                <th>Cost</th>
                <th>Accumulated depreciation</th>
                <th>Net book value</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {assets.map((a) => (
                <tr className="border-b" key={a.id}>
                  <td className="p-3">
                    <span className="font-mono">{a.assetNumber}</span>
                    <br />
                    {a.name}
                  </td>
                  <td>{a.capitalizationDate.slice(0, 10)}</td>
                  <td>₹ {a.originalCost}</td>
                  <td>₹ {a.accumulatedDepreciation}</td>
                  <td>
                    ₹{' '}
                    {(
                      Number(a.originalCost) - Number(a.accumulatedDepreciation)
                    ).toFixed(2)}
                  </td>
                  <td>{a.status}</td>
                  <td className="space-x-1">
                    {['DRAFT', 'REJECTED'].includes(a.status) && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => action(a.id, 'submit')}
                      >
                        Submit
                      </Button>
                    )}
                    {isAccountsHead && a.status === 'PENDING_APPROVAL' && (
                      <>
                        <Button
                          size="sm"
                          onClick={() => action(a.id, 'approve')}
                        >
                          Capitalise
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() =>
                            action(a.id, 'reject', {
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
    </PageContainer>
  );
}
