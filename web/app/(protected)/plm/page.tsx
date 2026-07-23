'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, CheckCircle2, Factory, RefreshCw, Workflow } from 'lucide-react';
import { ApiError } from '../../lib/api';
import { getMyPlmWork, PlmDashboardItem } from '../../lib/plm';
import { prettyEnum } from '../../lib/sales';
import { PageContainer } from '../../components/ui/page-container';
import { PageHeader } from '../../components/ui/page-header';
import { Card, CardContent } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { EmptyState } from '../../components/ui/empty-state';
import { Skeleton } from '../../components/ui/skeleton';
import { StatusBadge } from '../../components/ui/status-badge';
import { cn } from '../../lib/utils';

export default function PlmWorkspacePage() {
  const [items, setItems] = useState<PlmDashboardItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setItems(await getMyPlmWork());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to load Product Lifecycle data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const summary = useMemo(() => ({
    active: items.length,
    production: items.filter((item) => item.currentStage === 'PRODUCTION').length,
    atRisk: items.filter((item) => item.health === 'AT_RISK').length,
    blocked: items.filter((item) => item.health === 'BLOCKED').length,
  }), [items]);

  return (
    <PageContainer>
      <PageHeader
        title="Product Lifecycle"
        description="Order-line progress from completed Project Kickoff through design, production, quality and dispatch."
        action={<Button variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw className={cn('size-4', loading && 'animate-spin')} />Refresh</Button>}
      />

      <section className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryCard label="Active lines" value={summary.active} icon={Workflow} />
        <SummaryCard label="In production" value={summary.production} icon={Factory} />
        <SummaryCard label="At risk" value={summary.atRisk} icon={AlertTriangle} tone="warning" />
        <SummaryCard label="Blocked" value={summary.blocked} icon={AlertTriangle} tone="danger" />
      </section>

      {error && <p className="mb-4 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}

      {loading ? (
        <div className="space-y-3">{Array.from({ length: 3 }).map((_, index) => <Skeleton key={index} className="h-28 w-full" />)}</div>
      ) : items.length === 0 ? (
        <Card><CardContent className="p-0"><EmptyState icon={Workflow} title="No active lifecycle trackers" description="A tracker appears automatically for each classified order line after its Project Kickoff is completed. Open Project Kickoff to complete delivery classification and finish the kickoff." /></CardContent></Card>
      ) : (
        <div className="space-y-3">
          {items.map((item) => <LifecycleRow key={item.trackerId} item={item} />)}
        </div>
      )}
    </PageContainer>
  );
}

function SummaryCard({ label, value, icon: Icon, tone = 'default' }: { label: string; value: number; icon: React.ComponentType<{className?:string}>; tone?: 'default'|'warning'|'danger' }) {
  return <Card><CardContent className="flex items-center gap-3 p-4"><span className={cn('flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground', tone === 'warning' && 'bg-warning/15 text-warning-foreground', tone === 'danger' && 'bg-destructive/10 text-destructive')}><Icon className="size-5" /></span><div><p className="text-2xl font-semibold">{value}</p><p className="text-xs text-muted-foreground">{label}</p></div></CardContent></Card>;
}

function LifecycleRow({ item }: { item: PlmDashboardItem }) {
  const health = {
    ON_TRACK: { label: 'On track', className: 'bg-success/10 text-success' },
    AT_RISK: { label: 'At risk', className: 'bg-warning/15 text-warning-foreground' },
    BLOCKED: { label: 'Blocked', className: 'bg-destructive/10 text-destructive' },
  }[item.health];
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Link href={`/sales/orders/${item.orderId}#plm`} className="font-semibold text-primary hover:underline">{item.orderNumber}</Link>
              <span className="font-medium">{item.productName}</span>
              <span className="text-xs text-muted-foreground">{item.productSku}</span>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{prettyEnum(item.flowType)} · Owner: {item.ownerName} · {item.ageDays} day{item.ageDays === 1 ? '' : 's'} in stage</p>
            {item.blocker && <p className="mt-2 flex items-center gap-1.5 text-sm text-destructive"><AlertTriangle className="size-4" />{item.blocker}</p>}
          </div>
          <div className="flex flex-wrap items-center gap-2 md:justify-end">
            <StatusBadge value={item.currentStage} />
            <span className={cn('rounded-full px-2.5 py-1 text-xs font-medium', health.className)}>{health.label}</span>
            {item.currentStage === 'PRODUCTION' && <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs"><CheckCircle2 className="size-3.5" />{item.production.done}/{item.production.total} cards</span>}
            <Link href={`/sales/orders/${item.orderId}#plm`}><Button size="sm" variant="outline">Open tracker</Button></Link>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
