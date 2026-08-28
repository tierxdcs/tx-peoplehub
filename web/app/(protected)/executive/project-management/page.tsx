'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import {
  Callout,
  SCard,
  SCardTitle,
  SignalChip,
  SIGNAL_BTN_GHOST,
  SIGNAL_EYEBROW,
  SIGNAL_MUTED,
  SIGNAL_ROW_DIVIDER,
  StatStrip,
  StatTile,
  ToneChip,
} from '../../../components/ui/signal';
import { cn } from '../../../lib/utils';
import { fetchProjectManagementDashboard, type ProjectManagementDashboard } from '../../../lib/executive';
import { ExecutiveShell } from '../_components/executive-shell';

const date = (value: string | null) => value ? new Date(value).toLocaleDateString() : '—';
const healthTone = (health: string) => health === 'ON_TRACK' ? 'success' : health === 'BLOCKED' ? 'danger' : 'warning';
const healthLabel = (health: string) => health.replaceAll('_', ' ');

function Row({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('border-b py-3 last:border-b-0', SIGNAL_ROW_DIVIDER, className)}>{children}</div>;
}

export default function ProjectManagementExecutiveDashboardPage() {
  const [data, setData] = useState<ProjectManagementDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pmFilter, setPmFilter] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    fetchProjectManagementDashboard()
      .then((result) => { setData(result); setError(null); })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed to load dashboard'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  const matchesPm = (pm: string) => !pmFilter || pm === pmFilter;

  return (
    <ExecutiveShell
      active="project-management"
      title="Project Management Dashboard"
      chip={data ? <SignalChip>{data.projects.length} active projects</SignalChip> : undefined}
      description={data ? `PM-attributed delivery visibility · as of ${new Date(data.asOf).toLocaleString()}` : 'PM-attributed project health, blockers and delivery readiness'}
      actions={<button type="button" onClick={load} disabled={loading} className={cn(SIGNAL_BTN_GHOST, 'gap-1.5')}><RefreshCw className={cn('size-3.5', loading && 'animate-spin')} />Refresh</button>}
    >
      {error && <Callout variant="danger">{error}</Callout>}
      {!data ? <p className={cn('text-[13px]', SIGNAL_MUTED)}>{loading ? 'Loading…' : 'No dashboard data available.'}</p> : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn('text-[12px] font-semibold', SIGNAL_MUTED)}>Project manager</span>
            <select value={pmFilter} onChange={(event) => setPmFilter(event.target.value)} className="rounded-lg border border-black/15 bg-white px-3 py-2 text-[12px] dark:border-white/[.16] dark:bg-[#232323]">
              <option value="">All project managers</option>
              {data.workload.map((item) => <option key={item.pm} value={item.pm}>{item.pm}</option>)}
            </select>
          </div>
          <StatStrip>
            <StatTile label="Blocked projects" value={data.projects.filter((p) => matchesPm(p.pm) && p.health === 'BLOCKED').length} valueClass="text-[#E5484D]" />
            <StatTile label="At risk projects" value={data.projects.filter((p) => matchesPm(p.pm) && p.health === 'AT_RISK').length} valueClass="text-[#E08A2C]" />
            <StatTile label="Awaiting kickoff" value={data.awaitingKickoff.length} valueClass="text-[#E08A2C]" />
            <StatTile label="Orders awaiting delivery" value={data.ordersAwaitingDelivery.filter((p) => matchesPm(p.pm)).length} />
          </StatStrip>

          <div className="grid gap-4 xl:grid-cols-2">
            <SCard className="p-5">
              <SCardTitle title="Team workload" subtitle="Open Kanban tasks and active kickoffs per PM" />
              <div className="mt-3">
                {data.workload.filter((item) => matchesPm(item.pm)).length === 0 ? <p className={cn('text-[13px]', SIGNAL_MUTED)}>No active PM workload.</p> : data.workload.filter((item) => matchesPm(item.pm)).map((item) => (
                  <Row key={item.pm} className="flex items-center justify-between gap-4">
                    <span className="text-[13px] font-semibold">{item.pm}</span>
                    <span className="text-[12px] tabular-nums text-black/55 dark:text-white/50">{item.openTasks} open tasks · {item.activeProjects} projects</span>
                  </Row>
                ))}
              </div>
            </SCard>
            <SCard className="p-5">
              <SCardTitle title="Projects awaiting kickoff" subtitle="Qualifying orders with no kickoff created" />
              <div className="mt-3">
                {data.awaitingKickoff.length === 0 ? <p className={cn('text-[13px]', SIGNAL_MUTED)}>No orders waiting for kickoff.</p> : data.awaitingKickoff.map((order) => (
                  <Row key={order.id} className="flex items-center justify-between gap-4"><span className="text-[13px] font-semibold">{order.orderNumber}</span><span className={cn('text-[12px]', SIGNAL_MUTED)}>{order.orderType === 'INTERNAL' ? 'Internal order' : 'Executed OCS'} · created {date(order.createdAt)}</span></Row>
                ))}
              </div>
            </SCard>
          </div>

          <SCard className="p-5">
            <SCardTitle title="Project status" subtitle="Every project is attributed to its assigned PM" />
            <div className="mt-3 grid gap-x-6 md:grid-cols-2">
              {data.projects.filter((project) => matchesPm(project.pm)).map((project) => (
                <Row key={project.kickoffId}>
                  <div className="flex flex-wrap items-center gap-2"><span className="text-[13px] font-semibold">{project.projectName}</span><ToneChip tone={healthTone(project.health)}>{healthLabel(project.health)}</ToneChip></div>
                  <div className={cn('mt-1 text-[12px]', SIGNAL_MUTED)}>PM: {project.pm} · {project.orderNumber} · {project.currentStage}</div>
                  {project.healthReason && <div className={cn('mt-1 text-[12px]', SIGNAL_MUTED)}>{project.healthReason}</div>}
                </Row>
              ))}
            </div>
          </SCard>

          <div className="grid gap-4 xl:grid-cols-2">
            <SCard className="p-5">
              <SCardTitle title="Actionable blockers" subtitle="Project · reason · resolving owner" />
              <div className="mt-3">{data.blockers.filter((item) => matchesPm(item.pm)).length === 0 ? <p className={cn('text-[13px]', SIGNAL_MUTED)}>No active blockers.</p> : data.blockers.filter((item) => matchesPm(item.pm)).map((item, index) => <Row key={`${item.project}-${item.blocker}-${index}`}><div className="flex gap-2"><AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-[#E5484D]" /><div><div className="text-[13px] font-semibold">{item.blocker}</div><div className={cn('mt-1 text-[12px]', SIGNAL_MUTED)}>{item.project} · PM {item.pm} · owner {item.owner}</div></div></div></Row>)}</div>
            </SCard>
            <SCard className="p-5">
              <SCardTitle title="Delivery date progress" subtitle="Promised date and fulfilment state by PM" />
              <div className="mt-3">{data.delivery.filter((item) => matchesPm(item.pm)).map((item) => <Row key={item.kickoffId} className="flex items-center justify-between gap-3"><div><div className="text-[13px] font-semibold">{item.projectName}</div><div className={cn('mt-1 text-[12px]', SIGNAL_MUTED)}>PM {item.pm} · {item.orderNumber}</div></div><div className="text-right"><div className={cn('text-[12px] font-semibold', item.overdue ? 'text-[#E5484D]' : SIGNAL_MUTED)}>{item.overdue ? 'OVERDUE' : item.fulfilmentStatus.replaceAll('_', ' ')}</div><div className={cn('mt-1 text-[11px]', SIGNAL_MUTED)}>{date(item.deliveryDate)}</div></div></Row>)}</div>
            </SCard>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <SCard className="p-5"><SCardTitle title="Milestone health" subtitle="Overdue kickoff milestones" /><div className="mt-3">{data.milestoneHealth.filter((item) => matchesPm(item.pm)).length === 0 ? <p className={cn('text-[13px]', SIGNAL_MUTED)}>No overdue milestones.</p> : data.milestoneHealth.filter((item) => matchesPm(item.pm)).map((item) => <Row key={`${item.project}-${item.name}`}><div className="text-[13px] font-semibold">{item.name}</div><div className={cn('mt-1 text-[12px]', SIGNAL_MUTED)}>{item.project} · PM {item.pm} · owner {item.owner} · due {date(item.targetDate)}</div></Row>)}</div></SCard>
            <SCard className="p-5"><SCardTitle title="Action item health" subtitle="Incomplete kickoff action items" /><div className="mt-3">{data.actionItemHealth.filter((item) => matchesPm(item.pm)).length === 0 ? <p className={cn('text-[13px]', SIGNAL_MUTED)}>No incomplete action items.</p> : data.actionItemHealth.filter((item) => matchesPm(item.pm)).map((item) => <Row key={`${item.project}-${item.description}`}><div className="text-[13px] font-semibold">{item.description}</div><div className={cn('mt-1 text-[12px]', SIGNAL_MUTED)}>{item.project} · PM {item.pm} · owner {item.owner} · due {date(item.dueDate)}</div></Row>)}</div></SCard>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <SCard className="p-5"><SCardTitle title="Open high-impact risks" subtitle="Unmitigated risk register entries" /><div className="mt-3">{data.risks.filter((item) => matchesPm(item.pm)).length === 0 ? <p className={cn('text-[13px]', SIGNAL_MUTED)}>No open high-impact risks.</p> : data.risks.filter((item) => matchesPm(item.pm)).map((item) => <Row key={`${item.project}-${item.description}`}><div className="text-[13px] font-semibold">{item.description}</div><div className={cn('mt-1 text-[12px]', SIGNAL_MUTED)}>{item.project} · PM {item.pm} · owner {item.owner}</div></Row>)}</div></SCard>
            <SCard className="p-5"><SCardTitle title="Unresolved project pings" subtitle="Linked to Project Kickoffs" /><div className="mt-3">{data.pings.filter((item) => data.projects.some((project) => project.projectName === item.project && matchesPm(project.pm))).length === 0 ? <p className={cn('text-[13px]', SIGNAL_MUTED)}>No unresolved project-linked pings.</p> : data.pings.filter((item) => data.projects.some((project) => project.projectName === item.project && matchesPm(project.pm))).map((item) => <Row key={item.id}><div className="text-[13px] font-semibold">{item.project}</div><div className={cn('mt-1 text-[12px]')}>{item.message}</div><div className={cn('mt-1 text-[12px]', SIGNAL_MUTED)}>From {item.from} · unresolved with {item.owners.join(', ') || 'no recipient'}</div></Row>)}</div></SCard>
          </div>

          <SCard className="p-5"><SCardTitle title="Orders awaiting delivery" subtitle="Project-linked orders not fully dispatched" /><div className="mt-3 grid gap-x-6 md:grid-cols-2">{data.ordersAwaitingDelivery.filter((item) => matchesPm(item.pm)).map((item) => <Row key={item.orderId} className="flex items-center justify-between gap-3"><span className="text-[13px] font-semibold">{item.orderNumber}</span><span className={cn('text-[12px]', SIGNAL_MUTED)}>{item.projectName} · PM {item.pm}</span></Row>)}</div></SCard>
        </>
      )}
    </ExecutiveShell>
  );
}
