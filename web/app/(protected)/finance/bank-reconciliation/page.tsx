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
type Account = {
  id: string;
  accountName: string;
  bankName: string;
  accountNumberLast4: string;
};
type Ledger = { id: string; code: string; name: string; accountType: string };
type Match = {
  matchType: string;
  confidenceScore: string;
  matchReason: string;
  confirmedAt?: string;
  customerReceipt?: { receiptNumber: string; customer: { name: string } };
  apPayment?: {
    paymentNumber: string;
    supplier?: { companyName: string };
    vendor?: { companyName: string };
  };
  journalEntry?: { journalNumber: string };
};
type Line = {
  id: string;
  transactionDate: string;
  description: string;
  bankReference?: string;
  debitAmount: string;
  creditAmount: string;
  runningBalance?: string;
  resolution: string;
  exceptionReason?: string;
  match?: Match;
};
type Statement = {
  id: string;
  statementNumber: string;
  periodFrom: string;
  periodTo: string;
  openingBalance: string;
  closingBalance: string;
  status: string;
  bankAccount: Account;
  lines?: Line[];
  _count?: { lines: number };
};
type Page<T> = { items: T[] };
type Candidate = {
  id: string;
  receiptNumber?: string;
  paymentNumber?: string;
  journalNumber?: string;
  amount?: string;
  customer?: { name: string };
  supplier?: { companyName: string };
  vendor?: { companyName: string };
};
export default function BankReconciliationPage() {
  const toast = useToast(),
    { isAccountsHead } = useFinanceAccess();
  const [accounts, setAccounts] = useState<Account[]>([]),
    [ledgers, setLedgers] = useState<Ledger[]>([]),
    [statements, setStatements] = useState<Statement[]>([]),
    [selected, setSelected] = useState<Statement | null>(null),
    [bankName, setBankName] = useState(''),
    [accountName, setAccountName] = useState('Operating Account'),
    [last4, setLast4] = useState(''),
    [ledgerId, setLedgerId] = useState(''),
    [bankId, setBankId] = useState(''),
    [from, setFrom] = useState(''),
    [to, setTo] = useState(''),
    [opening, setOpening] = useState(''),
    [closing, setClosing] = useState(''),
    [file, setFile] = useState<File | null>(null),
    [candidates, setCandidates] = useState<
      Record<string, { type: string; rows: Candidate[] }>
    >({});
  const load = () =>
    Promise.all([
      apiFetch<Account[]>('/finance/operations/bank-accounts'),
      apiFetch<Ledger[]>('/finance/accounts'),
      apiFetch<Page<Statement>>('/finance/operations/statements?limit=100'),
    ]).then(([a, l, s]) => {
      setAccounts(a);
      setLedgers(l.filter((x) => x.accountType === 'ASSET'));
      setStatements(s.items);
      if (!bankId && a[0]) setBankId(a[0].id);
      if (!ledgerId && l[0]) setLedgerId(l[0].id);
    });
  useEffect(() => {
    load().catch((e) =>
      toast.error(
        e instanceof ApiError ? e.message : 'Failed to load reconciliation',
      ),
    );
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  async function createAccount(e: FormEvent) {
    e.preventDefault();
    try {
      await apiFetch('/finance/operations/bank-accounts', {
        method: 'POST',
        body: JSON.stringify({
          accountName,
          bankName,
          accountNumberLast4: last4,
          ledgerAccountId: ledgerId,
        }),
      });
      toast.success('Bank account created');
      await load();
    } catch (x) {
      toast.error(x instanceof ApiError ? x.message : 'Failed');
    }
  }
  async function importCsv(e: FormEvent) {
    e.preventDefault();
    if (!file) return;
    try {
      const csvText = await file.text();
      const s = await apiFetch<Statement>(
        '/finance/operations/statements/import',
        {
          method: 'POST',
          body: JSON.stringify({
            bankAccountId: bankId,
            periodFrom: from,
            periodTo: to,
            openingBalance: Number(opening),
            closingBalance: Number(closing),
            sourceFileName: file.name,
            csvText,
          }),
        },
      );
      setSelected(s);
      toast.success('Statement imported and match suggestions generated');
      await load();
    } catch (x) {
      toast.error(x instanceof ApiError ? x.message : 'Failed to import');
    }
  }
  async function open(id: string) {
    try {
      setSelected(
        await apiFetch<Statement>(`/finance/operations/statements/${id}`),
      );
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed');
    }
  }
  async function lineAction(lineId: string, path: string, body?: unknown) {
    try {
      await apiFetch(`/finance/operations/statement-lines/${lineId}/${path}`, {
        method: 'PATCH',
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      if (selected) await open(selected.id);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed');
    }
  }
  async function findCandidates(line: Line) {
    try {
      const c = await apiFetch<{
        receipts: Candidate[];
        payments: Candidate[];
        journals: Candidate[];
      }>(`/finance/operations/statement-lines/${line.id}/candidates`);
      const rows =
        line.creditAmount !== '0' && line.creditAmount !== '0.00'
          ? c.receipts
          : c.payments;
      setCandidates({
        ...candidates,
        [line.id]: {
          type:
            line.creditAmount !== '0' && line.creditAmount !== '0.00'
              ? 'CUSTOMER_RECEIPT'
              : 'VENDOR_PAYMENT',
          rows,
        },
      });
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed');
    }
  }
  async function statementAction(a: string, body?: unknown) {
    if (!selected) return;
    try {
      await apiFetch(`/finance/operations/statements/${selected.id}/${a}`, {
        method: 'POST',
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      await open(selected.id);
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed');
    }
  }
  return (
    <PageContainer>
      <PageHeader
        title="Bank Reconciliation"
        description="Import CSV statements, match posted ERP transactions, document exceptions and obtain Finance Head approval"
      />
      {isAccountsHead && (
        <Card className="mb-6">
          <CardContent className="p-5">
            <h2 className="mb-3 font-semibold">Bank account setup</h2>
            <form
              onSubmit={createAccount}
              className="grid gap-3 md:grid-cols-5"
            >
              <Input
                required
                placeholder="Bank name"
                value={bankName}
                onChange={(e) => setBankName(e.target.value)}
              />
              <Input
                required
                placeholder="Account label"
                value={accountName}
                onChange={(e) => setAccountName(e.target.value)}
              />
              <Input
                required
                pattern="\d{4}"
                maxLength={4}
                placeholder="Last 4 digits"
                value={last4}
                onChange={(e) => setLast4(e.target.value)}
              />
              <Select
                value={ledgerId}
                onChange={(e) => setLedgerId(e.target.value)}
              >
                {ledgers.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.code} · {l.name}
                  </option>
                ))}
              </Select>
              <Button type="submit">Add bank account</Button>
            </form>
          </CardContent>
        </Card>
      )}
      <Card className="mb-6">
        <CardContent className="p-5">
          <h2 className="mb-3 font-semibold">Import statement CSV</h2>
          <div className="mb-3 text-xs text-muted-foreground">
            Required headers: date, description, reference, debit, credit.
            Optional: value_date, balance. Dates: YYYY-MM-DD or DD/MM/YYYY.
          </div>
          <form onSubmit={importCsv} className="grid gap-3 md:grid-cols-4">
            <Select
              required
              value={bankId}
              onChange={(e) => setBankId(e.target.value)}
            >
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.bankName} · {a.accountName} · {a.accountNumberLast4}
                </option>
              ))}
            </Select>
            <Input
              required
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
            <Input
              required
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
            <Input
              required
              type="number"
              step="0.01"
              placeholder="Opening balance"
              value={opening}
              onChange={(e) => setOpening(e.target.value)}
            />
            <Input
              required
              type="number"
              step="0.01"
              placeholder="Closing balance"
              value={closing}
              onChange={(e) => setClosing(e.target.value)}
            />
            <Input
              required
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
            />
            <Button type="submit">Import and analyse</Button>
          </form>
        </CardContent>
      </Card>
      <Card className="mb-6">
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="p-3">Statement</th>
                <th>Account</th>
                <th>Period</th>
                <th>Balance</th>
                <th>Lines</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {statements.map((s) => (
                <tr
                  className="border-b cursor-pointer"
                  key={s.id}
                  onClick={() => open(s.id)}
                >
                  <td className="p-3 font-mono">{s.statementNumber}</td>
                  <td>{s.bankAccount.accountName}</td>
                  <td>
                    {s.periodFrom.slice(0, 10)} – {s.periodTo.slice(0, 10)}
                  </td>
                  <td>
                    {s.openingBalance} → {s.closingBalance}
                  </td>
                  <td>{s._count?.lines}</td>
                  <td>{s.status.replaceAll('_', ' ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
      {selected?.lines && (
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <div className="flex items-center justify-between p-4">
              <h2 className="font-semibold">
                {selected.statementNumber} reconciliation
              </h2>
              <div className="space-x-2">
                {['DRAFT', 'REJECTED'].includes(selected.status) && (
                  <Button onClick={() => statementAction('submit')}>
                    Submit reconciliation
                  </Button>
                )}
                {isAccountsHead && selected.status === 'PENDING_APPROVAL' && (
                  <>
                    <Button onClick={() => statementAction('approve')}>
                      Approve
                    </Button>
                    <Button
                      variant="destructive"
                      onClick={() =>
                        statementAction('reject', {
                          comment: window.prompt('Reason') || '',
                        })
                      }
                    >
                      Reject
                    </Button>
                  </>
                )}
              </div>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="p-3">Date</th>
                  <th>Description / Reference</th>
                  <th>Debit</th>
                  <th>Credit</th>
                  <th>Resolution</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {selected.lines.map((l) => (
                  <tr className="border-b" key={l.id}>
                    <td className="p-3">{l.transactionDate.slice(0, 10)}</td>
                    <td>
                      {l.description}
                      <br />
                      <span className="font-mono text-xs">
                        {l.bankReference}
                      </span>
                    </td>
                    <td>{l.debitAmount}</td>
                    <td>{l.creditAmount}</td>
                    <td>
                      {l.resolution.replaceAll('_', ' ')}
                      {l.match && (
                        <div className="text-xs">
                          {l.match.matchReason} · {l.match.confidenceScore}%
                        </div>
                      )}
                      {l.exceptionReason && (
                        <div className="text-xs">{l.exceptionReason}</div>
                      )}
                    </td>
                    <td className="space-x-1">
                      {l.resolution === 'PENDING' && l.match && (
                        <Button
                          size="sm"
                          onClick={() => lineAction(l.id, 'confirm-suggestion')}
                        >
                          Confirm suggestion
                        </Button>
                      )}
                      {l.resolution === 'PENDING' && !l.match && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => findCandidates(l)}
                        >
                          Find match
                        </Button>
                      )}
                      {l.resolution === 'PENDING' && (
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() =>
                            lineAction(l.id, 'accept-unmatched', {
                              reason:
                                window.prompt('Document unmatched reason') ||
                                '',
                            })
                          }
                        >
                          Accept unmatched
                        </Button>
                      )}
                      {candidates[l.id] && (
                        <Select
                          defaultValue=""
                          onChange={(e) =>
                            e.target.value &&
                            lineAction(l.id, 'match', {
                              matchType: candidates[l.id].type,
                              transactionId: e.target.value,
                            })
                          }
                        >
                          <option value="">Choose transaction</option>
                          {candidates[l.id].rows.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.receiptNumber ||
                                c.paymentNumber ||
                                c.journalNumber}{' '}
                              ·{' '}
                              {c.customer?.name ||
                                c.supplier?.companyName ||
                                c.vendor?.companyName}{' '}
                              · {c.amount}
                            </option>
                          ))}
                        </Select>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </PageContainer>
  );
}
