'use client';
import { useState } from 'react';
import { apiFetch, ApiError } from '../../../lib/api';
import { Button } from '../../../components/ui/button';
import { Card, CardContent } from '../../../components/ui/card';
import { Input } from '../../../components/ui/input';
import { PageContainer } from '../../../components/ui/page-container';
import { PageHeader } from '../../../components/ui/page-header';
import { useToast } from '../../../components/ui/toaster';
function scalar(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}
function csv(rows: Record<string, unknown>[]) {
  if (!rows.length) return '';
  const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const quote = (v: unknown) => `"${scalar(v).replaceAll('"', '""')}"`;
  return [
    keys.map(quote).join(','),
    ...rows.map((r) => keys.map((k) => quote(r[k])).join(',')),
  ].join('\n');
}
function download(name: string, content: string, type: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}
export default function FinanceExportsPage() {
  const toast = useToast(),
    now = new Date(),
    fy = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  const [from, setFrom] = useState(`${fy}-04-01`),
    [to, setTo] = useState(now.toISOString().slice(0, 10)),
    [busy, setBusy] = useState('');
  async function exportCsv(kind: string) {
    setBusy(kind);
    try {
      const data = await apiFetch<Record<string, unknown>[]>(
        `/finance/operations/exports/${kind}?from=${from}&to=${to}`,
      );
      download(
        `${kind}-${from}-${to}.csv`,
        csv(data),
        'text/csv;charset=utf-8',
      );
      toast.success('CSV export generated');
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Export failed');
    } finally {
      setBusy('');
    }
  }
  async function audit() {
    setBusy('audit');
    try {
      const data = await apiFetch<unknown>(
        `/finance/operations/audit-pack?from=${from}&to=${to}`,
      );
      download(
        `finance-audit-pack-${from}-${to}.json`,
        JSON.stringify(data, null, 2),
        'application/json',
      );
      toast.success('Audit pack generated');
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Export failed');
    } finally {
      setBusy('');
    }
  }
  return (
    <PageContainer>
      <PageHeader
        title="Finance Exports & Audit Pack"
        description="Download period data without external integrations; exports reflect approved and posted ERP records"
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
        </CardContent>
      </Card>
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardContent className="p-5">
            <h2 className="font-semibold">General Ledger</h2>
            <p className="my-3 text-sm text-muted-foreground">
              Posted journal lines with ledger accounts, cost centers and
              references.
            </p>
            <Button
              disabled={!!busy}
              onClick={() => exportCsv('general-ledger')}
            >
              Download CSV
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <h2 className="font-semibold">Accounts Receivable</h2>
            <p className="my-3 text-sm text-muted-foreground">
              Customer invoice register and balances for the selected period.
            </p>
            <Button disabled={!!busy} onClick={() => exportCsv('ar-aging')}>
              Download CSV
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <h2 className="font-semibold">Accounts Payable</h2>
            <p className="my-3 text-sm text-muted-foreground">
              Supplier invoice register, ITC state, holds and outstanding
              balances.
            </p>
            <Button disabled={!!busy} onClick={() => exportCsv('ap-aging')}>
              Download CSV
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <h2 className="font-semibold">Bank Reconciliation</h2>
            <p className="my-3 text-sm text-muted-foreground">
              Statements, lines, matches, exceptions and approval evidence.
            </p>
            <Button
              disabled={!!busy}
              onClick={() => exportCsv('bank-reconciliation')}
            >
              Download CSV
            </Button>
          </CardContent>
        </Card>
        <Card className="md:col-span-2">
          <CardContent className="p-5">
            <h2 className="font-semibold">Consolidated Audit Pack</h2>
            <p className="my-3 text-sm text-muted-foreground">
              Machine-readable JSON evidence pack containing ledger, AR, AP,
              bank reconciliations and adjustment notes.
            </p>
            <Button disabled={!!busy} onClick={audit}>
              Download audit pack
            </Button>
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  );
}
