import Link from 'next/link';
import { AlertTriangle, ExternalLink, Factory } from 'lucide-react';
import { PlmDashboardItem } from '../../../lib/plm';
import { prettyEnum } from '../../../lib/sales';
import { Card, CardContent } from '../../../components/ui/card';
import { cn } from '../../../lib/utils';

export function PlmWorkCard({ item }: { item: PlmDashboardItem }) {
  const healthClass = {
    ON_TRACK: 'bg-success/10 text-success',
    AT_RISK: 'bg-warning/15 text-warning-foreground',
    BLOCKED: 'bg-destructive/10 text-destructive',
  }[item.health];
  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <Link href={`/sales/orders/${item.orderId}#plm`} className="inline-flex items-center gap-1 font-semibold hover:text-primary">
              <span>{item.orderNumber} · {item.productName}</span><ExternalLink className="size-3.5" />
            </Link>
            <p className="text-xs text-muted-foreground">{item.productSku} · {prettyEnum(item.flowType)} · Owner: {item.ownerName}</p>
          </div>
          <span className={cn('rounded-full px-2.5 py-1 text-xs font-medium', healthClass)}>{item.health === 'ON_TRACK' ? 'On track' : item.health === 'AT_RISK' ? 'At risk' : 'Blocked'}</span>
        </div>
        <div className="flex flex-wrap items-center gap-4 rounded-md bg-muted/40 px-3 py-2 text-sm">
          <span className="inline-flex items-center gap-1.5"><Factory className="size-4 text-muted-foreground" />{prettyEnum(item.currentStage)}</span>
          <span className="text-muted-foreground">In stage {item.ageDays} day{item.ageDays === 1 ? '' : 's'}</span>
          {item.currentStage === 'PRODUCTION' && <span>{item.production.done}/{item.production.total} production cards done</span>}
        </div>
        {item.blocker && <p className="flex items-center gap-2 text-sm text-destructive"><AlertTriangle className="size-4 shrink-0" />{item.blocker}</p>}
      </CardContent>
    </Card>
  );
}
