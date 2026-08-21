'use client';

import Link from 'next/link';
import { Check, CheckCheck, Radio } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import { Card, CardContent } from '../../../components/ui/card';
import { cn } from '../../../lib/utils';
import { linkedPingHref, orderReceivedForDashboard, pingAgeHours, respondToPing, type ReceivedPing, type SentPing } from '../../../lib/pings';

export function PingPanel({ received, sent, onChanged }: { received: ReceivedPing[]; sent: SentPing[]; onChanged: () => void }) {
  const act = async (id: string, status: 'ACKNOWLEDGED' | 'RESOLVED') => { await respondToPing(id, status); onChanged(); };
  // Pending → acknowledged → resolved; resolved pings drop off after 24 hours.
  const visible = orderReceivedForDashboard(received);
  return (
    <aside className="space-y-3 xl:sticky xl:top-4">
      <div className="flex items-center justify-between"><h2 className="text-lg font-semibold">Pings</h2><Link href="/my-pings" className="text-sm text-primary hover:underline">View all</Link></div>
      <Card><CardContent className="p-0">
        <div className="border-b px-4 py-3 text-sm font-medium">Received</div>
        {visible.length === 0 ? <p className="p-4 text-sm text-muted-foreground">No pings waiting.</p> : (
          <ul className="divide-y">{visible.slice(0, 6).map((row) => {
            const hours = pingAgeHours(row.ping.createdAt); const overdue = row.status === 'PENDING' && hours >= 24; const href = linkedPingHref(row.ping.linkedRecordType, row.ping.linkedRecordId);
            return <li key={row.id} className={cn('space-y-2 p-4', row.status === 'PENDING' && (overdue ? 'ping-overdue bg-destructive/10' : 'ping-new bg-destructive/5'))}>
              <div className="flex gap-2"><Radio className={cn('mt-0.5 size-4 shrink-0', row.status === 'PENDING' ? 'text-destructive' : 'text-success')} /><div className="min-w-0"><p className="text-sm">{row.ping.message}</p><p className="mt-1 text-xs text-muted-foreground">{row.ping.fromEmployee.fullName} · {hours}h ago{overdue ? ` · ${hours - 24}h overdue` : ''}</p></div></div>
              {href && <Link href={href} className="block text-xs text-primary hover:underline">Open linked record</Link>}
              {row.status === 'PENDING' && <div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => act(row.id, 'ACKNOWLEDGED')}><Check className="mr-1 size-3" />Acknowledge</Button><Button size="sm" onClick={() => act(row.id, 'RESOLVED')}><CheckCheck className="mr-1 size-3" />Resolve</Button></div>}
              {row.status !== 'PENDING' && <span className="text-xs font-medium text-success">{row.status === 'RESOLVED' ? 'Resolved' : 'Acknowledged'}</span>}
            </li>;
          })}</ul>
        )}
        <div className="border-y px-4 py-3 text-sm font-medium">Sent</div>
        {sent.length === 0 ? <p className="p-4 text-sm text-muted-foreground">No sent pings.</p> : <ul className="divide-y">{sent.slice(0, 3).map((ping) => <li key={ping.id} className="p-4"><p className="text-sm">{ping.message}</p><div className="mt-2 flex flex-wrap gap-1">{ping.recipients.map((r) => <span key={r.id} className={cn('rounded-full px-2 py-0.5 text-xs', r.status === 'PENDING' ? 'bg-destructive/10 text-destructive' : 'bg-success/10 text-success')}>{r.employee.fullName}: {r.status === 'PENDING' ? 'Pending' : r.status === 'RESOLVED' ? 'Resolved' : 'Acknowledged'}</span>)}</div></li>)}</ul>}
      </CardContent></Card>
    </aside>
  );
}
