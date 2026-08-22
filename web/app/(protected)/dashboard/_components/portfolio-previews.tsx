import Link from 'next/link';
import { AlertTriangle, ArrowRight, Check, Circle, Clock3 } from 'lucide-react';
import type { PlmDashboardItem } from '../../../lib/plm';
import { plmTrackerHref } from '../../../lib/plm';
import type { ProjectProgress, ProjectStageState } from '../../../lib/project-kickoff';
import { prettyEnum } from '../../../lib/sales';
import { Card, CardContent } from '../../../components/ui/card';
import { cn } from '../../../lib/utils';

export function PortfolioPreviews({
  projects,
  lifecycle,
}: {
  projects: ProjectProgress[];
  lifecycle: PlmDashboardItem[];
}) {
  return (
    <section className="grid items-start gap-4 xl:grid-cols-2">
      <PreviewPanel
        title="Project progress"
        description="Highest-priority projects"
        href="/project-kickoff"
      >
        {projects.map((project) => (
          <ProjectRow key={project.kickoffId} project={project} />
        ))}
      </PreviewPanel>
      <PreviewPanel
        title="Product lifecycle work"
        description="Most urgent active order lines"
        href="/plm"
      >
        {lifecycle.map((item) => (
          <LifecycleRow key={item.trackerId} item={item} />
        ))}
      </PreviewPanel>
    </section>
  );
}

function PreviewPanel({
  title,
  description,
  href,
  children,
}: {
  title: string;
  description: string;
  href: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{title}</h2>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        <Link href={href} className="inline-flex shrink-0 items-center gap-1 text-sm text-primary hover:underline">
          View more <ArrowRight className="size-3.5" />
        </Link>
      </div>
      <Card>
        <CardContent className="divide-y p-0">{children}</CardContent>
      </Card>
    </div>
  );
}

function ProjectRow({ project }: { project: ProjectProgress }) {
  const completed = project.stages.filter((stage) => stage.state === 'COMPLETE').length;
  return (
    <article className="space-y-2.5 px-4 py-3">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href={`/project-kickoff/${project.kickoffId}`} className="block truncate text-sm font-semibold hover:text-primary">
            {project.projectName}
          </Link>
          <p className="truncate text-xs text-muted-foreground">
            {project.orderNumber} · {prettyEnum(project.currentStage)}
            {project.nextDueDate ? ` · Due ${new Date(project.nextDueDate).toLocaleDateString()}` : ''}
          </p>
        </div>
        <HealthBadge health={project.health} />
      </div>
      <div className="flex items-center gap-1.5" aria-label={`${completed} of ${project.stages.length} stages complete`}>
        {project.stages.map((stage) => (
          <Link
            key={stage.key}
            href={stage.href}
            title={`${stage.label}: ${stage.detail}`}
            aria-label={`${stage.label}: ${stage.detail}`}
            className="group flex min-w-0 flex-1 items-center gap-1"
          >
            <StageDot state={stage.state} />
            <span className={cn('h-1 min-w-1 flex-1 rounded-full', stage.state === 'COMPLETE' ? 'bg-success' : stage.state === 'ATTENTION' ? 'bg-destructive' : stage.state === 'IN_PROGRESS' ? 'bg-warning' : 'bg-muted')} />
          </Link>
        ))}
        <span className="ml-1 shrink-0 text-[11px] tabular-nums text-muted-foreground">{completed}/{project.stages.length}</span>
      </div>
      {project.healthReason !== 'No active blockers' && (
        <p className="truncate text-xs text-muted-foreground" title={project.healthReason}>{project.healthReason}</p>
      )}
    </article>
  );
}

function LifecycleRow({ item }: { item: PlmDashboardItem }) {
  return (
    <Link href={plmTrackerHref(item.trackerId)} className="block px-4 py-3 transition-colors hover:bg-accent/30">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{item.orderNumber} · {item.productName}</p>
          <p className="truncate text-xs text-muted-foreground">
            {prettyEnum(item.currentStage)} · {item.ownerName} · {urgencyText(item)}
          </p>
        </div>
        <HealthBadge health={item.health} />
      </div>
      {item.blocker && (
        <p className="mt-2 flex min-w-0 items-center gap-1.5 text-xs text-destructive">
          <AlertTriangle className="size-3.5 shrink-0" /><span className="truncate">{item.blocker}</span>
        </p>
      )}
    </Link>
  );
}

function urgencyText(item: PlmDashboardItem) {
  if (item.daysUntilDue == null) return `${item.ageDays}d in stage`;
  if (item.daysUntilDue < 0) return `${Math.abs(item.daysUntilDue)}d overdue`;
  if (item.daysUntilDue === 0) return 'Due today';
  return `${item.daysUntilDue}d to delivery`;
}

function HealthBadge({ health }: { health: ProjectProgress['health'] }) {
  return (
    <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium', health === 'ON_TRACK' && 'bg-success/10 text-success', health === 'AT_RISK' && 'bg-warning/15 text-warning-foreground', health === 'BLOCKED' && 'bg-destructive/10 text-destructive')}>
      {health === 'ON_TRACK' ? 'On track' : health === 'AT_RISK' ? 'At risk' : 'Blocked'}
    </span>
  );
}

function StageDot({ state }: { state: ProjectStageState }) {
  const Icon = state === 'COMPLETE' ? Check : state === 'IN_PROGRESS' ? Clock3 : state === 'ATTENTION' ? AlertTriangle : Circle;
  return (
    <span className={cn('flex size-5 shrink-0 items-center justify-center rounded-full border', state === 'COMPLETE' && 'border-success bg-success text-success-foreground', state === 'IN_PROGRESS' && 'border-warning text-warning', state === 'ATTENTION' && 'border-destructive text-destructive', state === 'UPCOMING' && 'border-muted-foreground/30 text-muted-foreground')}>
      <Icon className="size-3" />
    </span>
  );
}
