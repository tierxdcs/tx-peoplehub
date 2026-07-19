'use client';
import { useEffect, useState } from 'react';
import { apiFetch, ApiError } from '../../../lib/api';
import { useFinanceAccess } from '../../../lib/use-finance-access';
import { Button } from '../../../components/ui/button';
import { Card, CardContent } from '../../../components/ui/card';
import { Select } from '../../../components/ui/select';
import { PageContainer } from '../../../components/ui/page-container';
import { PageHeader } from '../../../components/ui/page-header';
import { useToast } from '../../../components/ui/toaster';
type Period = { id: string; name: string; status: string };
type Fy = { id: string; name: string; periods: Period[] };
type Close = {
  status: string;
  checklist: Record<string, unknown>;
  preparedById: string;
} | null;
type Result = { close: Close; blockers: Record<string, number | boolean> };
type CloseTask = { id: string; title: string; category: string; status: string; isRequired: boolean };
type Exception = { id: string; title: string; controlType: string; severity: string; status: string; ledgerAmount?: string; sourceAmount?: string; variance?: string; resolutionNote?: string };
type Controls = { tasks: CloseTask[]; reconciliation: { status: string; summary: Record<string, unknown>; generatedAt: string; exceptions: Exception[] } | null };
const checks = [
  'bankReconciled',
  'gstReviewed',
  'tdsReviewed',
  'accrualsReviewed',
  'managementReviewReady',
];
export default function PeriodClosePage() {
  const toast = useToast(),
    { isAccountsHead } = useFinanceAccess();
  const [years, setYears] = useState<Fy[]>([]),
    [periodId, setPeriodId] = useState(''),
    [result, setResult] = useState<Result | null>(null),
    [confirmed, setConfirmed] = useState<Record<string, boolean>>({}),
    [controls, setControls] = useState<Controls | null>(null);
  useEffect(() => {
    apiFetch<Fy[]>('/finance/fiscal-years').then((y) => {
      setYears(y);
      const p = y.flatMap((x) => x.periods).find((x) => x.status !== 'CLOSED');
      if (p) setPeriodId(p.id);
    });
  }, []);
  async function load(id = periodId) {
    if (!id) return;
    try {
      const r = await apiFetch<Result>(
        `/finance/compliance/period-close/${id}`,
      );
      setResult(r);
      const c = (r.close?.checklist || {}) as Record<string, boolean>;
      setConfirmed(Object.fromEntries(checks.map((k) => [k, c[k] === true])));
      if (r.close) setControls(await apiFetch<Controls>(`/finance/close-controls/${id}`)); else setControls(null);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed');
    }
  }
  useEffect(() => {
    if (periodId) load(periodId);
  }, [periodId]); // eslint-disable-line react-hooks/exhaustive-deps
  async function action(a: string, body?: unknown) {
    try {
      await apiFetch(`/finance/compliance/period-close/${periodId}/${a}`, {
        method: 'POST',
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      toast.success(`Period close ${a} complete`);
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed');
    }
  }
  async function controlAction(path: string, method: 'POST' | 'PATCH' = 'POST', body?: unknown) {
    try { await apiFetch(path, { method, ...(body ? { body: JSON.stringify(body) } : {}) }); toast.success('Close controls updated'); await load(); }
    catch (e) { toast.error(e instanceof ApiError ? e.message : 'Failed'); }
  }
  const periods = years.flatMap((y) =>
    y.periods.map((p) => ({ ...p, fy: y.name })),
  );
  return (
    <PageContainer>
      <PageHeader
        title="Period Close"
        description="Maker-checker close workflow with open-transaction blockers and statutory review checklist"
      />
      <Card className="mb-6">
        <CardContent className="flex gap-3 p-5">
          <Select
            value={periodId}
            onChange={(e) => setPeriodId(e.target.value)}
          >
            {periods.map((p) => (
              <option key={p.id} value={p.id}>
                {p.fy} · {p.name} · {p.status}
              </option>
            ))}
          </Select>
          <Button variant="outline" onClick={() => load()}>
            Refresh
          </Button>
        </CardContent>
      </Card>
      {result && (
        <>
          <Card className="mb-6">
            <CardContent className="p-5">
              <h2 className="mb-3 font-semibold">System blockers</h2>
              <div className="grid gap-3 md:grid-cols-4">
                {Object.entries(result.blockers)
                  .filter(([, v]) => typeof v === 'number')
                  .map(([k, v]) => (
                    <div
                      key={k}
                      className={`rounded border p-3 ${Number(v) > 0 ? 'border-red-400' : 'border-green-400'}`}
                    >
                      <div className="text-xs text-muted-foreground">
                        {k.replace(/([A-Z])/g, ' $1')}
                      </div>
                      <div className="text-xl font-semibold">{String(v)}</div>
                    </div>
                  ))}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-5">
              <h2 className="mb-3 font-semibold">Close confirmations</h2>
              <div className="grid gap-3 md:grid-cols-2">
                {checks.map((k) => (
                  <label
                    key={k}
                    className="flex items-center gap-2 rounded border p-3"
                  >
                    <input
                      type="checkbox"
                      checked={!!confirmed[k]}
                      onChange={(e) =>
                        setConfirmed({ ...confirmed, [k]: e.target.checked })
                      }
                    />
                    {k.replace(/([A-Z])/g, ' $1')}
                  </label>
                ))}
              </div>
              <div className="mt-4 flex gap-2">
                <Button
                  onClick={async () => { await action('prepare', { checklist: confirmed }); }}
                >
                  Save checklist
                </Button>
                {result.close?.status === 'PREPARING' && (
                  <Button onClick={() => action('submit')}>Submit close</Button>
                )}
                {isAccountsHead &&
                  result.close?.status === 'PENDING_APPROVAL' && (
                    <>
                      <Button onClick={() => action('approve')}>
                        Approve & lock period
                      </Button>
                      <Button
                        variant="destructive"
                        onClick={() =>
                          action('reject', {
                            comment: window.prompt('Rejection reason') || '',
                          })
                        }
                      >
                        Reject & reopen
                      </Button>
                    </>
                  )}
              </div>
              <div className="mt-3 text-sm">
                Close status: {result.close?.status || 'Not prepared'}
              </div>
            </CardContent>
          </Card>
          {result.close && <Card className="mt-6"><CardContent className="p-5"><div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold">Automated Close Controls</h2><p className="text-sm text-muted-foreground">Required close tasks and ledger-to-subledger reconciliation exceptions</p></div><Button onClick={() => controlAction(`/finance/close-controls/${periodId}/run`)}>Run reconciliations</Button></div><div className="grid gap-2 md:grid-cols-2">{(controls?.tasks ?? []).map((t) => <label key={t.id} className="flex items-center gap-2 rounded border p-3 text-sm"><input type="checkbox" checked={t.status === 'COMPLETED'} onChange={(e) => controlAction(`/finance/close-controls/${periodId}/tasks/${t.id}`, 'PATCH', { status: e.target.checked ? 'COMPLETED' : 'PENDING' })}/><span><b>{t.category}</b> · {t.title}{t.isRequired ? ' *' : ''}</span></label>)}</div>{controls?.reconciliation && <div className="mt-6"><div className="mb-2 text-sm">Run status: <b>{controls.reconciliation.status}</b></div><div className="space-y-2">{controls.reconciliation.exceptions.map((x) => <div key={x.id} className={`rounded border p-3 text-sm ${x.status === 'OPEN' && x.severity === 'BLOCKING' ? 'border-red-400' : ''}`}><div className="flex flex-wrap items-center justify-between gap-2"><span><b>{x.title}</b> · {x.severity} · {x.status}</span>{x.status === 'OPEN' && <div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => { const note = window.prompt('Resolution note'); if (note) controlAction(`/finance/close-controls/exceptions/${x.id}/resolve`, 'PATCH', { status: 'RESOLVED', resolutionNote: note }); }}>Resolve</Button>{isAccountsHead && <Button size="sm" variant="destructive" onClick={() => { const note = window.prompt('Finance Head waiver justification'); if (note) controlAction(`/finance/close-controls/exceptions/${x.id}/resolve`, 'PATCH', { status: 'WAIVED', resolutionNote: note }); }}>Waive</Button>}</div>}</div>{x.variance != null && <div className="mt-1 text-xs text-muted-foreground">Ledger ₹{x.ledgerAmount ?? '0'} · Source ₹{x.sourceAmount ?? '0'} · Variance ₹{x.variance}</div>}</div>)}</div></div>}</CardContent></Card>}
        </>
      )}
    </PageContainer>
  );
}
