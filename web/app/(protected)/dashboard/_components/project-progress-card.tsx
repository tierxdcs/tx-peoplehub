import Link from 'next/link';
import {
  AlertTriangle,
  Check,
  Circle,
  Clock3,
  ExternalLink,
} from 'lucide-react';
import type {
  ProjectProgress,
  ProjectStageState,
} from '../../../lib/project-kickoff';
import { Card, CardContent } from '../../../components/ui/card';
import { cn } from '../../../lib/utils';

const STATE_LABEL: Record<ProjectStageState, string> = {
  COMPLETE: 'Complete',
  IN_PROGRESS: 'In progress',
  ATTENTION: 'Needs attention',
  UPCOMING: 'Upcoming',
};

export function ProjectProgressCard({ project }: { project: ProjectProgress }) {
  const healthClass = {
    ON_TRACK: 'bg-success/10 text-success',
    AT_RISK: 'bg-warning/15 text-warning-foreground',
    BLOCKED: 'bg-destructive/10 text-destructive',
  }[project.health];
  const healthLabel = {
    ON_TRACK: 'On track',
    AT_RISK: 'At risk',
    BLOCKED: 'Blocked',
  }[project.health];

  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <Link
              href={`/project-kickoff/${project.kickoffId}`}
              className="inline-flex items-center gap-1 font-semibold hover:text-primary"
            >
              <span className="truncate">{project.projectName}</span>
              <ExternalLink className="size-3.5 shrink-0" />
            </Link>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Order {project.orderNumber} · Updated{' '}
              {new Date(project.updatedAt).toLocaleDateString()}
            </p>
          </div>
          <div className="w-full text-left sm:w-auto sm:text-right">
            <span
              className={cn(
                'inline-flex rounded-full px-2.5 py-1 text-xs font-medium',
                healthClass,
              )}
            >
              {healthLabel}
            </span>
            <p className="mt-1 max-w-72 text-xs text-muted-foreground">
              {project.healthReason}
            </p>
          </div>
        </div>

        <div className="overflow-x-auto pb-2">
          <ol className="flex min-w-[760px] items-start">
            {project.stages.map((stage, index) => (
              <li
                key={stage.key}
                className="flex flex-1 items-start last:flex-none"
              >
                <Link
                  href={stage.href}
                  title={`${stage.label}: ${STATE_LABEL[stage.state]}. ${stage.detail}`}
                  className="group flex w-24 flex-col items-center text-center"
                >
                  <StageLamp state={stage.state} />
                  <span className="mt-1.5 text-xs font-medium group-hover:text-primary">
                    {stage.label}
                  </span>
                  <span className="mt-0.5 line-clamp-2 text-[10px] leading-tight text-muted-foreground">
                    {stage.detail}
                  </span>
                  <span className="sr-only">{STATE_LABEL[stage.state]}</span>
                </Link>
                {index < project.stages.length - 1 && (
                  <div
                    className={cn(
                      'mx-1 mt-4 h-0.5 min-w-5 flex-1 rounded',
                      stage.state === 'COMPLETE'
                        ? 'bg-success'
                        : 'bg-muted-foreground/20',
                    )}
                  />
                )}
              </li>
            ))}
          </ol>
        </div>
      </CardContent>
    </Card>
  );
}

function StageLamp({ state }: { state: ProjectStageState }) {
  const Icon = {
    COMPLETE: Check,
    IN_PROGRESS: Clock3,
    ATTENTION: AlertTriangle,
    UPCOMING: Circle,
  }[state];
  return (
    <span
      className={cn(
        'flex size-9 items-center justify-center rounded-full border-2 shadow-sm',
        state === 'COMPLETE' &&
          'border-success bg-success text-success-foreground',
        state === 'IN_PROGRESS' &&
          'border-warning bg-warning/15 text-warning-foreground',
        state === 'ATTENTION' &&
          'border-destructive bg-destructive/10 text-destructive',
        state === 'UPCOMING' &&
          'border-muted-foreground/30 bg-background text-muted-foreground',
      )}
    >
      <Icon className="size-4" />
    </span>
  );
}
